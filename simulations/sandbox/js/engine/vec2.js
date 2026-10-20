/**
 * Vec2 — минимальный 2D-вектор для физического движка.
 *
 * Все методы, кроме явно помеченных `new`/`clone`, изменяют вектор на месте.
 * Такой стиль выбран ради горячих циклов решателя: меньше мусора для GC.
 */

export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /* ---------- мутирующие операции ---------- */

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  zero() {
    this.x = 0;
    this.y = 0;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  scale(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }

  addScaled(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  negate() {
    this.x = -this.x;
    this.y = -this.y;
    return this;
  }

  /** Поворот на угол (радианы) вокруг начала координат. */
  rotate(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = this.x * c - this.y * s;
    this.y = this.x * s + this.y * c;
    this.x = x;
    return this;
  }

  normalize() {
    const len = Math.hypot(this.x, this.y);
    if (len > 1e-12) {
      this.x /= len;
      this.y /= len;
    } else {
      this.x = 0;
      this.y = 0;
    }
    return this;
  }

  /** Перпендикуляр (поворот на +90°). */
  perp() {
    const x = this.x;
    this.x = -this.y;
    this.y = x;
    return this;
  }

  clampLength(max) {
    const len = Math.hypot(this.x, this.y);
    if (len > max && len > 1e-12) {
      const s = max / len;
      this.x *= s;
      this.y *= s;
    }
    return this;
  }

  /* ---------- скалярные операции ---------- */

  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  /** Псевдоскалярное произведение (z-компонента векторного). */
  cross(v) {
    return this.x * v.y - this.y * v.x;
  }

  length() {
    return Math.hypot(this.x, this.y);
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y;
  }

  distanceTo(v) {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  distanceSqTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  angle() {
    return Math.atan2(this.y, this.x);
  }

  /* ---------- создание новых векторов ---------- */

  clone() {
    return new Vec2(this.x, this.y);
  }

  plus(v) {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  minus(v) {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  times(s) {
    return new Vec2(this.x * s, this.y * s);
  }

  normalized() {
    return this.clone().normalize();
  }

  /* ---------- статические помощники ---------- */

  static zero() {
    return new Vec2(0, 0);
  }

  static from(x, y) {
    return new Vec2(x, y);
  }

  static fromAngle(angle, length = 1) {
    return new Vec2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  /** ω × r для 2D: (-ω·r.y, ω·r.x). */
  static crossSV(omega, r) {
    return new Vec2(-omega * r.y, omega * r.x);
  }

  /** r × ω для 2D: (r.y·ω, -r.x·ω). */
  static crossVS(r, omega) {
    return new Vec2(r.y * omega, -r.x * omega);
  }

  static add(a, b) {
    return new Vec2(a.x + b.x, a.y + b.y);
  }

  static sub(a, b) {
    return new Vec2(a.x - b.x, a.y - b.y);
  }

  static dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  static cross(a, b) {
    return a.x * b.y - a.y * b.x;
  }

  static distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}

/** Линейная интерполяция скаляров. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Ограничение значения отрезком. */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Детерминированный ГПСЧ (mulberry32) — нужен для воспроизводимых тестов. */
export function createRng(seed = 0x2f6e2b1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
