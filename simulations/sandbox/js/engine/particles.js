/**
 * particles.js — лёгкая система частиц для визуальных эффектов.
 *
 * Частицы живут в плоском массиве структур и переиспользуются через пул,
 * чтобы не нагружать GC при сотнях одновременных эффектов.
 */

import { Vec2 } from './vec2.js';

const MAX_PARTICLES = 2400;

export class Particle {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.life = 0;
    this.maxLife = 1;
    this.size = 2;
    this.color = '#fff';
    this.gravity = 0;
    this.drag = 0.98;
    this.alive = false;
  }
}

export class ParticleSystem {
  constructor(limit = MAX_PARTICLES) {
    this.limit = limit;
    this.pool = [];
    this.active = [];
    this.enabled = true;
    this._next = 0;
  }

  _acquire() {
    // Ищем свободный слот в пуле.
    for (let i = 0; i < this.pool.length; i += 1) {
      const index = (this._next + i) % this.pool.length;
      const p = this.pool[index];
      if (!p.alive) {
        this._next = (index + 1) % this.pool.length;
        return p;
      }
    }
    if (this.pool.length >= this.limit) return null;
    const p = new Particle();
    this.pool.push(p);
    return p;
  }

  /**
   * Взрыв частиц в точке.
   * @param {number} x
   * @param {number} y
   * @param {number} count
   * @param {object} [options]
   */
  burst(x, y, count, options = {}) {
    if (!this.enabled) return;
    const {
      color = '#7dd3fc',
      speed = 220,
      spread = Math.PI * 2,
      direction = 0,
      life = 0.55,
      size = 3,
      gravity = 520,
      drag = 0.96,
    } = options;

    for (let i = 0; i < count; i += 1) {
      const p = this._acquire();
      if (!p) break;

      const angle = direction + (Math.random() - 0.5) * spread;
      const magnitude = speed * (0.35 + Math.random() * 0.85);

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * magnitude;
      p.vy = Math.sin(angle) * magnitude;
      p.maxLife = life * (0.6 + Math.random() * 0.8);
      p.life = p.maxLife;
      p.size = size * (0.6 + Math.random() * 0.9);
      p.color = color;
      p.gravity = gravity;
      p.drag = drag;
      p.alive = true;
    }
  }

  /** Кольцевой «искры» вдоль нормали удара. */
  impact(x, y, nx, ny, strength, color) {
    if (!this.enabled) return;
    const count = Math.min(14, Math.round(strength / 90));
    if (count <= 0) return;
    this.burst(x, y, count, {
      color,
      speed: 90 + strength * 0.35,
      spread: Math.PI * 0.9,
      direction: Math.atan2(ny, nx),
      life: 0.4,
      size: 2.4,
      gravity: 380,
    });
  }

  update(dt) {
    const active = [];
    for (let i = 0; i < this.pool.length; i += 1) {
      const p = this.pool[i];
      if (!p.alive) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }

      p.vy += p.gravity * dt;
      const drag = Math.pow(p.drag, dt * 60);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      active.push(p);
    }
    this.active = active;
  }

  clear() {
    for (const p of this.pool) p.alive = false;
    this.active = [];
  }

  get count() {
    return this.active.length;
  }
}