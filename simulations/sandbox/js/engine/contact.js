/**
 * contact.js — манифолд контакта и подготовка данных для решателя.
 *
 * Контакт создаётся один раз за шаг и хранит:
 *  • мировую нормаль (от A к B);
 *  • точки контакта с локальными якорями (для позиционной коррекции);
 *  • эффективные массы, скорость отскока и накопленные импульсы.
 */

import { Vec2 } from './vec2.js';

/** Скорость ниже этого порога не даёт отскока — иначе стопки «дрожат». */
const RESTITUTION_THRESHOLD = 30;

export class ContactPoint {
  constructor(x, y, penetration, featureId) {
    this.x = x;
    this.y = y;
    this.penetration = penetration;
    this.featureId = featureId;

    /** Локальные якоря — чтобы пересчитывать проникновение после интегрирования. */
    this.localAx = 0;
    this.localAy = 0;
    this.localBx = 0;
    this.localBy = 0;

    /** Плечи относительно центров масс (мировые). */
    this.rAx = 0;
    this.rAy = 0;
    this.rBx = 0;
    this.rBy = 0;

    this.normalMass = 0;
    this.tangentMass = 0;
    this.velocityBias = 0;

    this.normalImpulse = 0;
    this.tangentImpulse = 0;
  }
}

export class Contact {
  /**
   * @param {import('./body.js').RigidBody} a
   * @param {import('./body.js').RigidBody} b
   * @param {Vec2} normal нормаль от A к B
   * @param {Array} rawPoints точки из коллайдера
   */
  constructor(a, b, normal, rawPoints) {
    this.a = a;
    this.b = b;
    this.normal = normal;
    this.points = rawPoints.map((p) => new ContactPoint(p.x, p.y, p.penetration, p.featureId));

    this.restitution = Math.max(a.restitution, b.restitution);
    this.friction = Math.sqrt(a.friction * b.friction);
    this.approachSpeed = 0;
    this.solved = false;

    this.tangent = new Vec2(normal.y, -normal.x);
    this._prepare();
  }

  /** Считает локальные якоря, плечи и эффективные массы. */
  _prepare() {
    const { a, b, normal, tangent } = this;

    for (const p of this.points) {
      p.rAx = p.x - a.position.x;
      p.rAy = p.y - a.position.y;
      p.rBx = p.x - b.position.x;
      p.rBy = p.y - b.position.y;

      const localA = a.toLocal(new Vec2(p.x, p.y));
      p.localAx = localA.x;
      p.localAy = localA.y;

      const localB = b.toLocal(new Vec2(p.x, p.y));
      p.localBx = localB.x;
      p.localBy = localB.y;

      // Эффективная масса по нормали: 1 / (Σ invMass + (r×n)²·invI).
      const rnA = p.rAx * normal.y - p.rAy * normal.x;
      const rnB = p.rBx * normal.y - p.rBy * normal.x;
      const kn = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
      p.normalMass = kn > 0 ? 1 / kn : 0;

      // Эффективная масса по касательной.
      const rtA = p.rAx * tangent.y - p.rAy * tangent.x;
      const rtB = p.rBx * tangent.y - p.rBy * tangent.x;
      const kt = a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;
      p.tangentMass = kt > 0 ? 1 / kt : 0;
    }
  }

  /**
   * Вычисляет скорость сближения и настраивает отскок.
   * Вызывается после интегрирования скоростей — на актуальных скоростях.
   */
  prepareBias() {
    const { a, b, normal } = this;
    let maxApproach = 0;

    for (const p of this.points) {
      const vax = a.velocity.x - a.angularVelocity * p.rAy;
      const vay = a.velocity.y + a.angularVelocity * p.rAx;
      const vbx = b.velocity.x - b.angularVelocity * p.rBy;
      const vby = b.velocity.y + b.angularVelocity * p.rBx;

      const vn = (vbx - vax) * normal.x + (vby - vay) * normal.y;
      if (-vn > maxApproach) maxApproach = -vn;

      // Целевая скорость расхождения: e·|v_подхода|, но только для быстрых ударов.
      p.velocityBias = vn < -RESTITUTION_THRESHOLD ? -this.restitution * vn : 0;
    }

    this.approachSpeed = maxApproach;
  }

  /** Текущее проникновение по сохранённым якорям (для позиционной коррекции). */
  currentSeparation(point) {
    const { a, b, normal } = this;
    const c = Math.cos(a.angle);
    const s = Math.sin(a.angle);
    const pax = a.position.x + point.localAx * c - point.localAy * s;
    const pay = a.position.y + point.localAx * s + point.localAy * c;

    const cb = Math.cos(b.angle);
    const sb = Math.sin(b.angle);
    const pbx = b.position.x + point.localBx * cb - point.localBy * sb;
    const pby = b.position.y + point.localBx * sb + point.localBy * cb;

    // Отрицательное значение — тела перекрываются.
    return (pbx - pax) * normal.x + (pby - pay) * normal.y;
  }

  /** Ключ для кэша импульсов (warm starting). */
  cacheKey(index) {
    return `${this.a.id}:${this.b.id}:${this.points[index].featureId}`;
  }
}