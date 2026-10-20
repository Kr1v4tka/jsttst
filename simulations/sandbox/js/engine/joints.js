/**
 * joints.js — соединения между телами.
 *
 * DistanceJoint — связь «верёвка/пружина» между двумя локальными якорями.
 * При stiffness = 1 ведёт себя как жёсткий стержень, при меньших значениях —
 * как пружина с демпфированием.
 */

import { Vec2 } from './vec2.js';

let nextJointId = 1;

export class Joint {
  constructor(a, b) {
    this.id = nextJointId++;
    this.a = a;
    this.b = b;
    this.enabled = true;
    this.broken = false;
    this.color = 'rgba(250, 204, 21, 0.85)';
  }

  // eslint-disable-next-line class-methods-use-this
  prepare() {}

  // eslint-disable-next-line class-methods-use-this
  solveVelocity() {}

  // eslint-disable-next-line class-methods-use-this
  solvePosition() {}
}

export class DistanceJoint extends Joint {
  /**
   * @param {import('./body.js').RigidBody} a
   * @param {import('./body.js').RigidBody} b
   * @param {Vec2} localAnchorA локальный якорь на теле A
   * @param {Vec2} localAnchorB локальный якорь на теле B
   * @param {number|null} restLength null → взять текущее расстояние
   * @param {number} stiffness 0..1
   */
  constructor(a, b, localAnchorA, localAnchorB, restLength = null, stiffness = 1) {
    super(a, b);
    this.localAnchorA = localAnchorA.clone();
    this.localAnchorB = localAnchorB.clone();
    this.stiffness = Math.max(0.02, Math.min(1, stiffness));
    this.damping = 0.35;

    const pa = a.toWorld(this.localAnchorA);
    const pb = b.toWorld(this.localAnchorB);
    this.restLength = restLength ?? pa.distanceTo(pb);

    this.impulse = 0;
    this.rAx = 0;
    this.rAy = 0;
    this.rBx = 0;
    this.rBy = 0;
    this.mass = 0;
    this.bias = 0;
  }

  get worldAnchorA() {
    return this.a.toWorld(this.localAnchorA);
  }

  get worldAnchorB() {
    return this.b.toWorld(this.localAnchorB);
  }

  currentLength() {
    return this.worldAnchorA.distanceTo(this.worldAnchorB);
  }

  prepare(dt) {
    const { a, b } = this;
    const pa = a.toWorld(this.localAnchorA);
    const pb = b.toWorld(this.localAnchorB);

    this.rAx = pa.x - a.position.x;
    this.rAy = pa.y - a.position.y;
    this.rBx = pb.x - b.position.x;
    this.rBy = pb.y - b.position.y;

    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    this.nx = len > 1e-6 ? dx / len : 0;
    this.ny = len > 1e-6 ? dy / len : 0;

    const crA = this.rAx * this.ny - this.rAy * this.nx;
    const crB = this.rBx * this.ny - this.rBy * this.nx;

    const invMass = a.invMass + b.invMass
      + a.invInertia * crA * crA
      + b.invInertia * crB * crB;

    // Жёсткость < 1 → мягкая связь: уменьшаем эффективную массу.
    this.mass = invMass > 0 ? this.stiffness / invMass : 0;

    const c = len - this.restLength;
    this.bias = dt > 0 ? (c * 0.2) / dt : 0;

    // Демпфирование гасит колебания пружины.
    this.gamma = this.stiffness >= 1 ? 0 : (this.damping * this.damping) / (dt * dt * this.stiffness);
    if (this.gamma > 0) {
      this.mass = 1 / (invMass + this.gamma);
    }
  }

  solveVelocity() {
    const { a, b, nx, ny } = this;
    if (!nx && !ny) return;

    const vax = a.velocity.x - a.angularVelocity * this.rAy;
    const vay = a.velocity.y + a.angularVelocity * this.rAx;
    const vbx = b.velocity.x - b.angularVelocity * this.rBy;
    const vby = b.velocity.y + b.angularVelocity * this.rBx;

    const vn = (vbx - vax) * nx + (vby - vay) * ny;
    let lambda = -this.mass * (vn + this.bias + this.gamma * this.impulse);
    this.impulse += lambda;

    const ix = nx * lambda;
    const iy = ny * lambda;

    if (!a.isStatic) {
      a.velocity.x -= ix * a.invMass;
      a.velocity.y -= iy * a.invMass;
      a.angularVelocity -= a.invInertia * (this.rAx * iy - this.rAy * ix);
      a.wake();
    }
    if (!b.isStatic) {
      b.velocity.x += ix * b.invMass;
      b.velocity.y += iy * b.invMass;
      b.angularVelocity += b.invInertia * (this.rBx * iy - this.rBy * ix);
      b.wake();
    }
  }

  solvePosition() {
    const { a, b } = this;
    const pa = a.toWorld(this.localAnchorA);
    const pb = b.toWorld(this.localAnchorB);

    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;

    const nx = dx / len;
    const ny = dy / len;
    const error = (len - this.restLength) * this.stiffness * 0.5;
    if (Math.abs(error) < 0.01) return;

    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) return;

    const cx = nx * error;
    const cy = ny * error;

    if (!a.isStatic) {
      a.position.x += cx * (a.invMass / invSum);
      a.position.y += cy * (a.invMass / invSum);
    }
    if (!b.isStatic) {
      b.position.x -= cx * (b.invMass / invSum);
      b.position.y -= cy * (b.invMass / invSum);
    }
  }
}

/**
 * MouseJoint — «резинка» от точки захвата к курсору.
 * Не является соединением двух тел, но живёт в том же списке.
 */
export class MouseJoint extends Joint {
  /**
   * @param {import('./body.js').RigidBody} body
   * @param {Vec2} worldPoint
   */
  constructor(body, worldPoint) {
    super(body, body);
    this.body = body;
    this.localAnchor = body.toLocal(worldPoint);
    this.target = worldPoint.clone();
    this.maxForce = 8000 * Math.max(body.mass, 0.05);
    this.frequency = 8;
    this.dampingRatio = 0.7;
    this.color = 'rgba(56, 189, 248, 0.9)';
    this.impulse = new Vec2(0, 0);
  }

  prepare(dt) {
    const body = this.body;
    const worldAnchor = body.toWorld(this.localAnchor);
    this.rAx = worldAnchor.x - body.position.x;
    this.rAy = worldAnchor.y - body.position.y;

    const omega = 2 * Math.PI * this.frequency;
    const d = 2 * body.mass * this.dampingRatio * omega;
    const k = body.mass * omega * omega;
    const h = dt || 1 / 60;

    this.gamma = h * (d + h * k);
    this.gamma = this.gamma !== 0 ? 1 / this.gamma : 0;
    this.beta = h * k * this.gamma;

    const cr = this.rAx * this.rAy;
    const invMass = body.invMass + body.invInertia * cr * cr;
    this.massMatrix = invMass !== 0 ? 1 / (invMass + this.gamma) : 0;

    // Учитываем смещение цели, чтобы не «тянуть» рывком.
    const dx = body.position.x + this.rAx - this.target.x;
    const dy = body.position.y + this.rAy - this.target.y;
    const c = this.massMatrix * this.beta;
    this.impulse.x += dx * c * body.mass;
    this.impulse.y += dy * c * body.mass;
  }

  solveVelocity() {
    const body = this.body;
    if (body.isStatic) return;

    const wx = body.velocity.x - body.angularVelocity * this.rAy;
    const wy = body.velocity.y + body.angularVelocity * this.rAx;

    const dx = this.target.x - (body.position.x + this.rAx);
    const dy = this.target.y - (body.position.y + this.rAy);

    let ix = this.massMatrix * (dx * this.beta - (wx + this.gamma * this.impulse.x));
    let iy = this.massMatrix * (dy * this.beta - (wy + this.gamma * this.impulse.y));

    this.impulse.x += ix;
    this.impulse.y += iy;

    // Ограничение силы — иначе тело телепортируется.
    const maxImpulse = this.maxForce * (1 / 60);
    const len = Math.hypot(this.impulse.x, this.impulse.y);
    if (len > maxImpulse) {
      const s = maxImpulse / len;
      this.impulse.x *= s;
      this.impulse.y *= s;
    }

    ix = this.impulse.x;
    iy = this.impulse.y;

    body.velocity.x += ix * body.invMass;
    body.velocity.y += iy * body.invMass;
    body.angularVelocity += body.invInertia * (this.rAx * iy - this.rAy * ix);
    body.wake();
  }

  // eslint-disable-next-line class-methods-use-this
  solvePosition() {}
}