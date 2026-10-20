/**
 * CircleBody — круг.
 */

import { RigidBody, BODY_KIND } from './body.js';
import { Vec2 } from './vec2.js';

export class CircleBody extends RigidBody {
  constructor(x, y, radius) {
    super({ position: new Vec2(x, y), kind: BODY_KIND.CIRCLE });
    this.radius = radius;
    this.localCenter = new Vec2(0, 0);
  }

  area() {
    return Math.PI * this.radius * this.radius;
  }

  /** Масса пропорциональна площади при заданной плотности. */
  applyDensity(density) {
    const mass = this.area() * density;
    const inertia = 0.5 * mass * this.radius * this.radius;
    this.setMass(mass, inertia);
    return this;
  }

  updateBounds() {
    const r = this.radius;
    this.aabb.minX = this.position.x - r;
    this.aabb.minY = this.position.y - r;
    this.aabb.maxX = this.position.x + r;
    this.aabb.maxY = this.position.y + r;
    return this.aabb;
  }

  containsPoint(point) {
    return this.position.distanceSqTo(point) <= this.radius * this.radius;
  }
}