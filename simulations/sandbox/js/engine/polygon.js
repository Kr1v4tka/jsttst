/**
 * PolygonBody — выпуклый многоугольник (в том числе прямоугольник).
 *
 * Вершины хранятся в локальных координатах, в порядке обхода против часовой
 * стрелки (CCW), нормали — внешние.
 */

import { RigidBody, BODY_KIND } from './body.js';
import { Vec2 } from './vec2.js';

export class PolygonBody extends RigidBody {
  /**
   * @param {number} x
   * @param {number} y
   * @param {Vec2[]} vertices локальные вершины (CCW), центр масс будет вычислен
   */
  constructor(x, y, vertices) {
    super({ position: new Vec2(x, y), kind: BODY_KIND.POLYGON });

    const local = PolygonBody.recenter(vertices);
    this.localVertices = local.vertices;
    this.localNormals = PolygonBody.computeNormals(this.localVertices);
    this.worldVertices = this.localVertices.map(() => new Vec2());
    this.worldNormals = this.localNormals.map(() => new Vec2());
    this._area = local.area;
    this._inertiaFactor = local.inertiaFactor;
    this.radius = local.radius;
    this.syncTransform();
  }

  /**
   * Смещает вершины так, чтобы начало координат совпадало с центром масс.
   * @param {Vec2[]} vertices
   */
  static recenter(vertices) {
    const count = vertices.length;
    let area = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < count; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % count];
      const cross = a.x * b.y - a.y * b.x;
      area += cross;
      cx += (a.x + b.x) * cross;
      cy += (a.y + b.y) * cross;
    }

    area *= 0.5;
    if (Math.abs(area) < 1e-9) {
      // Вырожденный полигон — отдаём как есть, но с минимальной площадью.
      return {
        vertices: vertices.map((v) => v.clone()),
        area: 1e-6,
        inertiaFactor: 1e-6,
        radius: 1,
      };
    }

    cx /= 6 * area;
    cy /= 6 * area;

    // Момент инерции относительно начала координат.
    let inertia = 0;
    for (let i = 0; i < count; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % count];
      const cross = Math.abs(a.x * b.y - a.y * b.x);
      const sum = a.lengthSq() + a.dot(b) + b.lengthSq();
      inertia += cross * sum;
    }
    inertia /= 12;

    const shifted = vertices.map((v) => new Vec2(v.x - cx, v.y - cy));
    // Теорема Гюйгенса — Штейнера: переносим момент в центр масс.
    const inertiaFactor = Math.abs(inertia) - Math.abs(area) * (cx * cx + cy * cy);
    let radius = 0;
    for (const v of shifted) radius = Math.max(radius, v.length());

    return {
      vertices: shifted,
      area: Math.abs(area),
      inertiaFactor: Math.max(inertiaFactor, 1e-6),
      radius,
    };
  }

  /** Внешние нормали рёбер для CCW-обхода. */
  static computeNormals(vertices) {
    const normals = [];
    const count = vertices.length;
    for (let i = 0; i < count; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % count];
      const edge = b.minus(a);
      // Для CCW внешняя нормаль — это (dy, -dx), нормированная.
      normals.push(new Vec2(edge.y, -edge.x).normalize());
    }
    return normals;
  }

  area() {
    return this._area;
  }

  applyDensity(density) {
    const mass = this._area * density;
    this.setMass(mass, this._inertiaFactor * density);
    return this;
  }

  /** Прямоугольник по центру. */
  static box(x, y, width, height) {
    const hw = width / 2;
    const hh = height / 2;
    return new PolygonBody(x, y, [
      new Vec2(-hw, -hh),
      new Vec2(hw, -hh),
      new Vec2(hw, hh),
      new Vec2(-hw, hh),
    ]);
  }

  /** Правильный N-угольник. */
  static regular(x, y, radius, sides = 5, rotation = 0) {
    const vertices = [];
    for (let i = 0; i < sides; i += 1) {
      const angle = rotation + (i / sides) * Math.PI * 2;
      vertices.push(new Vec2(Math.cos(angle) * radius, Math.sin(angle) * radius));
    }
    return new PolygonBody(x, y, vertices);
  }

  syncTransform() {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const px = this.position.x;
    const py = this.position.y;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < this.localVertices.length; i += 1) {
      const v = this.localVertices[i];
      const wx = px + v.x * c - v.y * s;
      const wy = py + v.x * s + v.y * c;
      this.worldVertices[i].set(wx, wy);
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }

    for (let i = 0; i < this.localNormals.length; i += 1) {
      const n = this.localNormals[i];
      this.worldNormals[i].set(n.x * c - n.y * s, n.x * s + n.y * c);
    }

    this.aabb.minX = minX;
    this.aabb.minY = minY;
    this.aabb.maxX = maxX;
    this.aabb.maxY = maxY;
  }

  updateBounds() {
    this.syncTransform();
    return this.aabb;
  }

  containsPoint(point) {
    const local = this.toLocal(point);
    // Для выпуклого CCW-полигона точка внутри, если она слева от всех рёбер.
    for (let i = 0; i < this.localVertices.length; i += 1) {
      const a = this.localVertices[i];
      const b = this.localVertices[(i + 1) % this.localVertices.length];
      const edge = b.minus(a);
      if (edge.cross(local.minus(a)) < 0) return false;
    }
    return true;
  }

  /** Самая удалённая точка в направлении (dirX, dirY) — для SAT. */
  support(dirX, dirY) {
    let best = this.worldVertices[0];
    let bestDot = best.x * dirX + best.y * dirY;
    for (let i = 1; i < this.worldVertices.length; i += 1) {
      const v = this.worldVertices[i];
      const dot = v.x * dirX + v.y * dirY;
      if (dot > bestDot) {
        bestDot = dot;
        best = v;
      }
    }
    return best;
  }
}