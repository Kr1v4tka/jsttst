/**
 * world.js — сборка движка: тела, соединения, шаг симуляции.
 *
 * Шаг выполняется фиксированным подшагом (по умолчанию 1/120 с) и вызывается
 * из внешнего цикла аккумулятором времени. Это даёт детерминированную и
 * стабильную физику независимо от FPS.
 */

import { Vec2, clamp } from './vec2.js';
import { CircleBody } from './circle.js';
import { PolygonBody } from './polygon.js';
import { collide } from './collider.js';
import { Contact } from './contact.js';
import { SpatialHash } from './broadphase.js';
import { warmStart, solveVelocity, solvePosition, storeImpulses } from './solver.js';
import { DistanceJoint, MouseJoint } from './joints.js';
import { ParticleSystem } from './particles.js';
import { BODY_KIND } from './body.js';

export const DEFAULT_SETTINGS = Object.freeze({
  gravityY: 980,          // px/s² — вниз
  gravityX: 0,
  fixedStep: 1 / 120,
  velocityIterations: 8,
  positionIterations: 3,
  sleepLinearThreshold: 6,   // px/s
  sleepAngularThreshold: 0.15, // рад/с
  sleepTime: 0.7,            // с
  density: 0.0016,
  maxBodies: 900,
});

export class World {
  /**
   * @param {number} width
   * @param {number} height
   * @param {object} [settings]
   */
  constructor(width, height, settings = {}) {
    this.width = width;
    this.height = height;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };

    this.gravity = new Vec2(this.settings.gravityX, this.settings.gravityY);
    this.bodies = [];
    this.joints = [];
    this.contacts = [];
    this.particles = new ParticleSystem();

    this.broadphase = new SpatialHash(96);
    this._pairs = [];
    this._impulseCache = new Map();
    this._newCache = new Map();

    this.accumulator = 0;
    this.time = 0;
    this.steps = 0;

    this.stats = {
      bodies: 0,
      contacts: 0,
      pairs: 0,
      particles: 0,
      sleeping: 0,
      stepMs: 0,
    };

    this.onImpact = null;

    // Границы мира как статические «стены» (см. resolveBounds).
    this.boundsEnabled = true;
    this.boundsRestitution = 0.35;
    this.boundsFriction = 0.5;

    this._maxContactImpulse = 0;
  }

  /* =========================================================
   * Управление телами
   * ======================================================= */

  add(body) {
    if (this.bodies.length >= this.settings.maxBodies) {
      // Вытесняем самое старое нестатическое тело, чтобы не расти бесконечно.
      const victim = this.bodies.find((b) => !b.isStatic);
      if (victim) this.remove(victim);
      else return null;
    }
    body.updateBounds();
    this.bodies.push(body);
    return body;
  }

  remove(body) {
    const index = this.bodies.indexOf(body);
    if (index === -1) return false;
    this.bodies.splice(index, 1);
    // Убираем соединения, ссылающиеся на тело.
    this.joints = this.joints.filter((j) => j.a !== body && j.b !== body);
    for (const key of this._impulseCache.keys()) {
      if (key.startsWith(`${body.id}:`) || key.includes(`:${body.id}:`)) {
        this._impulseCache.delete(key);
      }
    }
    return true;
  }

  clear() {
    this.bodies.length = 0;
    this.joints.length = 0;
    this.contacts.length = 0;
    this.particles.clear();
    this._impulseCache.clear();
    this._newCache.clear();
    this.accumulator = 0;
    this.steps = 0;
  }

  addJoint(joint) {
    this.joints.push(joint);
    return joint;
  }

  removeJoint(joint) {
    const index = this.joints.indexOf(joint);
    if (index === -1) return false;
    this.joints.splice(index, 1);
    return true;
  }

  /* =========================================================
   * Фабрики тел
   * ======================================================= */

  createCircle(x, y, radius, options = {}) {
    const body = new CircleBody(x, y, radius);
    body.applyDensity(options.density ?? this.settings.density);
    this._applyOptions(body, options);
    return this.add(body);
  }

  createBox(x, y, width, height, options = {}) {
    const body = PolygonBody.box(x, y, width, height);
    body.applyDensity(options.density ?? this.settings.density);
    this._applyOptions(body, options);
    return this.add(body);
  }

  createPolygon(x, y, radius, sides, options = {}) {
    const body = PolygonBody.regular(x, y, radius, sides, options.rotation ?? -Math.PI / 2);
    body.applyDensity(options.density ?? this.settings.density);
    this._applyOptions(body, options);
    return this.add(body);
  }

  _applyOptions(body, options) {
    if (options.color) body.color = options.color;
    if (options.restitution !== undefined) body.restitution = options.restitution;
    if (options.friction !== undefined) body.friction = options.friction;
    if (options.static) body.setMass(0, 0);
    if (options.angle !== undefined) {
      body.angle = options.angle;
      body.updateBounds();
    }
    if (options.velocity) body.velocity.set(options.velocity.x, options.velocity.y);
    if (options.angularVelocity !== undefined) body.angularVelocity = options.angularVelocity;
    if (options.canSleep !== undefined) body.canSleep = options.canSleep;
    return body;
  }

  /* =========================================================
   * Поиск
   * ======================================================= */

  /** Верхнее тело под точкой (последнее добавленное — приоритетнее). */
  bodyAt(x, y) {
    for (let i = this.bodies.length - 1; i >= 0; i -= 1) {
      const body = this.bodies[i];
      const b = body.aabb;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (body.containsPoint(new Vec2(x, y))) return body;
    }
    return null;
  }

  /* =========================================================
   * Шаг симуляции
   * ======================================================= */

  /**
   * Продвигает симуляцию на dt секунд реального времени.
   * @param {number} dt
   */
  advance(dt) {
    const step = this.settings.fixedStep;
    // Защита от «спирали смерти» при просадке FPS.
    this.accumulator = Math.min(this.accumulator + dt, step * 8);

    while (this.accumulator >= step) {
      this.step(step);
      this.accumulator -= step;
    }
  }

  /** Один фиксированный подшаг. */
  step(dt) {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

    this._maxContactImpulse = 0;
    this.particles.update(dt);

    // 1. Интегрируем скорости.
    for (const body of this.bodies) {
      if (body.isSleeping) continue;
      body.integrateVelocity(dt, this.gravity);
    }

    // 2. Обновляем AABB и строим широкую фазу.
    for (const body of this.bodies) {
      if (!body.isStatic) body.updateBounds();
    }
    this.broadphase.rebuild(this.bodies);
    this.broadphase.queryPairs(this.bodies, this._pairs);

    // 3. Узкая фаза — манифолды контактов.
    this.contacts.length = 0;
    for (const [a, b] of this._pairs) {
      const result = collide(a, b);
      if (!result) continue;

      // Просыпаемся при столкновении с движущимся телом.
      if (a.isSleeping && !b.isSleeping) a.wake();
      if (b.isSleeping && !a.isSleeping) b.wake();

      const contact = new Contact(a, b, result.normal, result.points);
      contact.prepareBias();
      this.contacts.push(contact);
    }

    // 4. Подготовка соединений.
    for (const joint of this.joints) {
      if (joint.enabled && !joint.broken) joint.prepare(dt);
    }

    // 5. Решатель скоростей.
    warmStart(this.contacts, this._impulseCache);
    solveVelocity(this.contacts, this.settings.velocityIterations);
    for (const joint of this.joints) {
      if (joint.enabled && !joint.broken) joint.solveVelocity();
    }

    // 6. Интегрируем позиции.
    for (const body of this.bodies) {
      if (body.isSleeping) continue;
      body.integratePosition(dt);
    }

    // 7. Позиционная коррекция.
    solvePosition(this.contacts, this.settings.positionIterations);
    for (const joint of this.joints) {
      if (joint.enabled && !joint.broken) joint.solvePosition();
    }

    // 8. Границы мира.
    if (this.boundsEnabled) this.resolveBounds();

    // 9. Кэш импульсов для следующего шага.
    this._newCache.clear();
    storeImpulses(this.contacts, this._newCache);
    const swap = this._impulseCache;
    this._impulseCache = this._newCache;
    this._newCache = swap;

    // 10. Сон и статистика.
    this.updateSleep(dt);
    for (const body of this.bodies) body.updateBounds();

    this.time += dt;
    this.steps += 1;

    const finished = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.stats.stepMs = finished - started;
    this.stats.bodies = this.bodies.length;
    this.stats.contacts = this.contacts.length;
    this.stats.pairs = this._pairs.length;
    this.stats.particles = this.particles.count;
    this.stats.sleeping = this.bodies.filter((b) => b.isSleeping).length;
  }

  /** Обновляет состояние сна с учётом соседей. */
  updateSleep(dt) {
    const { sleepLinearThreshold, sleepAngularThreshold, sleepTime } = this.settings;

    for (const body of this.bodies) {
      if (body.isStatic) {
        body.isSleeping = true;
        continue;
      }
      if (!body.canSleep) {
        body.isSleeping = false;
        body.sleepTimer = 0;
        continue;
      }

      const slow = body.velocity.lengthSq() < sleepLinearThreshold * sleepLinearThreshold
        && Math.abs(body.angularVelocity) < sleepAngularThreshold;

      if (slow) {
        body.sleepTimer += dt;
        if (body.sleepTimer >= sleepTime) body.sleep();
      } else {
        body.sleepTimer = 0;
        body.isSleeping = false;
      }
    }
  }

  /** Отскок от границ окна. */
  resolveBounds() {
    const { boundsRestitution: e, boundsFriction: mu } = this;

    for (const body of this.bodies) {
      if (body.isStatic || body.isSleeping) continue;
      const b = body.aabb;

      if (b.minX < 0) {
        body.position.x += -b.minX;
        if (body.velocity.x < 0) {
          body.velocity.x = -body.velocity.x * e;
          body.velocity.y *= 1 - mu * 0.1;
          this._reportImpact(body, -body.velocity.x, 0, -1);
        }
      } else if (b.maxX > this.width) {
        body.position.x -= b.maxX - this.width;
        if (body.velocity.x > 0) {
          body.velocity.x = -body.velocity.x * e;
          body.velocity.y *= 1 - mu * 0.1;
          this._reportImpact(body, -body.velocity.x, 0, -1);
        }
      }

      if (b.minY < 0) {
        body.position.y += -b.minY;
        if (body.velocity.y < 0) {
          body.velocity.y = -body.velocity.y * e;
          body.velocity.x *= 1 - mu * 0.1;
          this._reportImpact(body, -body.velocity.y, 0, 1);
        }
      } else if (b.maxY > this.height) {
        body.position.y -= b.maxY - this.height;
        if (body.velocity.y > 0) {
          const speed = body.velocity.y;
          body.velocity.y = -body.velocity.y * e;
          body.velocity.x *= 1 - mu * 0.05;
          this._reportImpact(body, speed, 0, -1);
        }
      }

      body.updateBounds();
    }
  }

  _reportImpact(body, speed, nx, ny) {
    if (speed < 120) return;
    this._maxContactImpulse = Math.max(this._maxContactImpulse, speed);
    if (typeof this.onImpact === 'function') {
      this.onImpact({ body, speed, nx, ny });
    }
  }

  /** Импульс самого сильного удара за последний шаг. */
  get maxImpact() {
    return this._maxContactImpulse;
  }

  /* =========================================================
   * Соединения
   * ======================================================= */

  createDistanceJoint(a, b, stiffness = 0.85) {
    // Якоря — в центрах тел: визуально это «канат» между центрами.
    const joint = new DistanceJoint(a, b, new Vec2(0, 0), new Vec2(0, 0), null, stiffness);
    return this.addJoint(joint);
  }

  createMouseJoint(body, worldPoint) {
    const joint = new MouseJoint(body, worldPoint);
    body.wake();
    return this.addJoint(joint);
  }

  /* =========================================================
   * Служебное
   * ======================================================= */

  resize(width, height) {
    this.width = width;
    this.height = height;
    // Возвращаем тела, вылетевшие за пределы, обратно.
    for (const body of this.bodies) {
      body.position.x = clamp(body.position.x, 10, width - 10);
      body.position.y = clamp(body.position.y, 10, height - 10);
      body.updateBounds();
    }
  }

  setGravity(y) {
    this.gravity.y = y;
    for (const body of this.bodies) body.wake();
  }

  wakeAll() {
    for (const body of this.bodies) body.wake();
  }

  get bodyCount() {
    return this.bodies.length;
  }
}

export { BODY_KIND, Vec2, CircleBody, PolygonBody };