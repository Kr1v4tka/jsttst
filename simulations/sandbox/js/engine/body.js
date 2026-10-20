/**
 * RigidBody — базовое 2D-твёрдое тело.
 *
 * Модель: выпуклые формы, полунеявный интегратор Эйлера, импульсный решатель
 * с накоплением импульсов и warm starting (см. world.js).
 */

import { Vec2 } from './vec2.js';

export const BODY_KIND = Object.freeze({
  CIRCLE: 'circle',
  POLYGON: 'polygon',
});

let nextBodyId = 1;

export class RigidBody {
  constructor({ position, kind }) {
    this.id = nextBodyId++;
    this.kind = kind;

    /* ----- кинематика ----- */
    this.position = new Vec2(position.x, position.y);
    this.velocity = new Vec2(0, 0);
    this.angle = 0;
    this.angularVelocity = 0;

    /* ----- масса и инерция ----- */
    this.mass = 1;
    this.invMass = 1;
    this.inertia = 1;
    this.invInertia = 1;
    this.isStatic = false;
    this.isKinematic = false;

    /* ----- материал ----- */
    this.restitution = 0.35;
    this.friction = 0.45;
    this.linearDamping = 0.02;
    this.angularDamping = 0.05;

    /* ----- накопленные силы ----- */
    this.force = new Vec2(0, 0);
    this.torque = 0;

    /* ----- сон ----- */
    this.canSleep = true;
    this.isSleeping = false;
    this.sleepTimer = 0;

    /* ----- визуал ----- */
    this.color = '#7dd3fc';
    this.stroke = 'rgba(8, 15, 30, 0.55)';
    this.glow = 'rgba(125, 211, 252, 0.35)';

    /* ----- служебное ----- */
    this.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.gravityScale = 1;
    this.selected = false;
    this.tag = '';
  }

  /* =========================================================
   * Массовые характеристики
   * ======================================================= */

  setMass(mass, inertia) {
    if (!Number.isFinite(mass) || mass <= 0) {
      this.isStatic = true;
      this.mass = Infinity;
      this.invMass = 0;
      this.inertia = Infinity;
      this.invInertia = 0;
      return this;
    }
    this.isStatic = false;
    this.mass = mass;
    this.invMass = 1 / mass;
    this.inertia = inertia > 0 ? inertia : mass;
    this.invInertia = 1 / this.inertia;
    return this;
  }

  /* =========================================================
   * Силы и импульсы
   * ======================================================= */

  applyForce(force) {
    if (this.isStatic) return this;
    this.force.add(force);
    this.wake();
    return this;
  }

  applyForceAtPoint(force, worldPoint) {
    if (this.isStatic) return this;
    this.force.add(force);
    const rx = worldPoint.x - this.position.x;
    const ry = worldPoint.y - this.position.y;
    this.torque += rx * force.y - ry * force.x;
    this.wake();
    return this;
  }

  applyImpulse(impulse, contactVector = null) {
    if (this.isStatic) return this;
    this.velocity.addScaled(impulse, this.invMass);
    if (contactVector) this.angularVelocity += this.invInertia * contactVector.cross(impulse);
    this.wake();
    return this;
  }

  applyAngularImpulse(impulse) {
    if (this.isStatic) return this;
    this.angularVelocity += impulse * this.invInertia;
    this.wake();
    return this;
  }

  stopMotion() {
    this.velocity.zero();
    this.angularVelocity = 0;
    this.force.zero();
    this.torque = 0;
    return this;
  }

  /* =========================================================
   * Сон
   * ======================================================= */

  wake() {
    if (this.isStatic) return this;
    this.isSleeping = false;
    this.sleepTimer = 0;
    return this;
  }

  sleep() {
    this.isSleeping = true;
    this.velocity.zero();
    this.angularVelocity = 0;
    this.force.zero();
    this.torque = 0;
    return this;
  }

  /* =========================================================
   * Интеграция
   * ======================================================= */

  /** Обновляет скорость по накопленным силам и гравитации. */
  integrateVelocity(dt, gravity) {
    if (this.isStatic || this.isSleeping) {
      this.force.zero();
      this.torque = 0;
      return;
    }

    this.velocity.x += (gravity.x * this.gravityScale + this.force.x * this.invMass) * dt;
    this.velocity.y += (gravity.y * this.gravityScale + this.force.y * this.invMass) * dt;
    this.angularVelocity += this.torque * this.invInertia * dt;

    // Экспоненциальное демпфирование, не зависящее от шага.
    const lin = 1 / (1 + dt * this.linearDamping);
    const ang = 1 / (1 + dt * this.angularDamping);
    this.velocity.scale(lin);
    this.angularVelocity *= ang;

    // Страховка от «взрыва» симуляции.
    this.velocity.clampLength(8000);
    this.angularVelocity = Math.max(-150, Math.min(150, this.angularVelocity));

    this.force.zero();
    this.torque = 0;
  }

  /** Обновляет положение по текущей скорости. */
  integratePosition(dt) {
    if (this.isStatic || this.isSleeping) return;
    this.position.addScaled(this.velocity, dt);
    this.angle += this.angularVelocity * dt;
  }

  /* =========================================================
   * Трансформации
   * ======================================================= */

  toWorld(local) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return new Vec2(
      this.position.x + local.x * c - local.y * s,
      this.position.y + local.x * s + local.y * c,
    );
  }

  toLocal(world) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const dx = world.x - this.position.x;
    const dy = world.y - this.position.y;
    return new Vec2(dx * c + dy * s, -dx * s + dy * c);
  }

  rotateVector(local) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return new Vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  }

  /** Скорость материальной точки тела. */
  velocityAt(worldPoint) {
    const rx = worldPoint.x - this.position.x;
    const ry = worldPoint.y - this.position.y;
    return new Vec2(
      this.velocity.x - this.angularVelocity * ry,
      this.velocity.y + this.angularVelocity * rx,
    );
  }

  /* =========================================================
   * Абстрактные методы
   * ======================================================= */

  // eslint-disable-next-line class-methods-use-this
  updateBounds() {
    return this.aabb;
  }

  // eslint-disable-next-line class-methods-use-this
  area() {
    return 1;
  }

  // eslint-disable-next-line class-methods-use-this
  containsPoint() {
    return false;
  }
}