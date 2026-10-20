/**
 * renderer.js — отрисовка мира на Canvas 2D.
 *
 * Рендерер не знает о физике: он получает World и рисует его текущее состояние.
 * Вся геометрия переводится в device pixels с учётом devicePixelRatio.
 */

import { BODY_KIND } from './engine/body.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./engine/world.js').World} world
   */
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.ctx = canvas.getContext('2d', { alpha: false });

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = 0;
    this.height = 0;

    this.options = {
      showGrid: true,
      showBounds: true,
      showVectors: false,
      showContacts: false,
      showShadows: true,
      theme: 'midnight',
    };

    this._theme = THEMES[this.options.theme];
    this._offscreen = document.createElement('canvas');
    this._offCtx = this._offscreen.getContext('2d');
  }

  resize(cssWidth, cssHeight) {
    this.width = Math.max(1, Math.floor(cssWidth));
    this.height = Math.max(1, Math.floor(cssHeight));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._buildGrid();
  }

  setTheme(name) {
    if (!THEMES[name]) return;
    this.options.theme = name;
    this._theme = THEMES[name];
    this._buildGrid();
  }

  /** Перерисовывает фон и сетку (после смены настроек вида). */
  refreshBackground() {
    this._buildGrid();
  }

  /** Сетка рисуется один раз в offscreen-канвас и потом блитится. */
  _buildGrid() {
    const { width, height, dpr } = this;
    if (width <= 0 || height <= 0) return;

    this._offscreen.width = Math.floor(width * dpr);
    this._offscreen.height = Math.floor(height * dpr);
    const ctx = this._offCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const theme = this._theme;

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, theme.bgTop);
    grad.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Мягкое свечение по центру.
    const glow = ctx.createRadialGradient(
      width * 0.5, height * 0.15, 0,
      width * 0.5, height * 0.15, Math.max(width, height) * 0.75,
    );
    glow.addColorStop(0, theme.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    if (!this.options.showGrid) return;

    const size = 48;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = size; x < width; x += size) {
      ctx.moveTo(Math.floor(x) + 0.5, 0);
      ctx.lineTo(Math.floor(x) + 0.5, height);
    }
    for (let y = size; y < height; y += size) {
      ctx.moveTo(0, Math.floor(y) + 0.5);
      ctx.lineTo(width, Math.floor(y) + 0.5);
    }
    ctx.stroke();

    // Крупная сетка.
    const major = size * 4;
    ctx.strokeStyle = theme.gridMajor;
    ctx.beginPath();
    for (let x = major; x < width; x += major) {
      ctx.moveTo(Math.floor(x) + 0.5, 0);
      ctx.lineTo(Math.floor(x) + 0.5, height);
    }
    for (let y = major; y < height; y += major) {
      ctx.moveTo(0, Math.floor(y) + 0.5);
      ctx.lineTo(width, Math.floor(y) + 0.5);
    }
    ctx.stroke();
  }

  render() {
    const ctx = this.ctx;
    const { width, height } = this;

    ctx.clearRect(0, 0, width, height);

    if (this._offscreen.width > 0) {
      ctx.drawImage(this._offscreen, 0, 0, width, height);
    }

    if (this.options.showBounds) this._drawBounds();
    this._drawParticles();
    this._drawJoints();
    this._drawBodies();
    if (this.options.showVectors) this._drawVectors();
    if (this.options.showContacts) this._drawContacts();
  }

  _drawBounds() {
    const ctx = this.ctx;
    const theme = this._theme;
    ctx.save();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 3;
    ctx.shadowColor = theme.borderGlow;
    ctx.shadowBlur = 18;
    ctx.strokeRect(1.5, 1.5, this.width - 3, this.height - 3);
    ctx.restore();
  }

  _drawParticles() {
    const particles = this.world.particles.active;
    if (particles.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawJoints() {
    const ctx = this.ctx;
    for (const joint of this.world.joints) {
      if (!joint.enabled || joint.broken) continue;
      const a = joint.worldAnchorA;
      const b = joint.worldAnchorB;

      ctx.save();
      ctx.strokeStyle = joint.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = joint.color;
      for (const p of [a, b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawBodies() {
    const ctx = this.ctx;

    for (const body of this.world.bodies) {
      const isCircle = body.kind === BODY_KIND.CIRCLE;

      ctx.save();

      if (body.isSleeping) ctx.globalAlpha = 0.55;

      // Тень под телом — даёт ощущение объёма.
      if (this.options.showShadows && !body.isStatic) {
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#000';
        ctx.translate(body.position.x + 3, body.position.y + 4);
        ctx.rotate(body.angle);
        if (isCircle) {
          ctx.beginPath();
          ctx.arc(0, 0, body.radius, 0, Math.PI * 2);
          ctx.fill();
        } else {
          this._polygonPath(ctx, body.localVertices);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);

      // Заливка.
      ctx.beginPath();
      if (isCircle) {
        ctx.arc(0, 0, body.radius, 0, Math.PI * 2);
      } else {
        this._polygonPath(ctx, body.localVertices);
      }
      ctx.fillStyle = body.color;
      ctx.fill();

      // Контур.
      ctx.strokeStyle = body.stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Блик для кругов и метка вращения для полигонов.
      if (isCircle) {
        const hl = ctx.createRadialGradient(
          -body.radius * 0.35, -body.radius * 0.35, body.radius * 0.05,
          -body.radius * 0.35, -body.radius * 0.35, body.radius * 1.1,
        );
        hl.addColorStop(0, 'rgba(255,255,255,0.45)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl;
        ctx.beginPath();
        ctx.arc(0, 0, body.radius, 0, Math.PI * 2);
        ctx.fill();

        // Спица — видно вращение.
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(body.radius * 0.82, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(body.localVertices[0].x, body.localVertices[0].y);
        ctx.lineTo(0, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Статичные тела — «штриховка».
      if (body.isStatic) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = body.stroke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const w = body.aabb.maxX - body.aabb.minX;
        const h = body.aabb.maxY - body.aabb.minY;
        for (let i = -h; i < w; i += 10) {
          ctx.moveTo(i, h / 2);
          ctx.lineTo(i + h, -h / 2);
        }
        ctx.save();
        ctx.beginPath();
        if (isCircle) ctx.arc(0, 0, body.radius, 0, Math.PI * 2);
        else this._polygonPath(ctx, body.localVertices);
        ctx.clip();
        ctx.stroke();
        ctx.restore();
      }

      // Выделение.
      if (body.selected) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        if (isCircle) ctx.arc(0, 0, body.radius + 4, 0, Math.PI * 2);
        else this._polygonPath(ctx, body.localVertices.map((v) => ({ x: v.x * 1.06, y: v.y * 1.06 })));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }
  }

  _drawVectors() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.5;
    for (const body of this.world.bodies) {
      if (body.isStatic || body.isSleeping) continue;
      const scale = 0.08;
      ctx.beginPath();
      ctx.moveTo(body.position.x, body.position.y);
      ctx.lineTo(
        body.position.x + body.velocity.x * scale,
        body.position.y + body.velocity.y * scale,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawContacts() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(248, 113, 113, 0.9)';
    for (const contact of this.world.contacts) {
      for (const p of contact.points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _polygonPath(ctx, vertices) {
    if (!vertices.length) return;
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i += 1) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
  }
}

export const THEMES = {
  midnight: {
    label: 'Полночь',
    bgTop: '#0b1020',
    bgBottom: '#151b30',
    glow: 'rgba(79, 70, 229, 0.22)',
    grid: 'rgba(148, 163, 184, 0.07)',
    gridMajor: 'rgba(148, 163, 184, 0.13)',
    border: 'rgba(129, 140, 248, 0.45)',
    borderGlow: 'rgba(99, 102, 241, 0.65)',
  },
  graphite: {
    label: 'Графит',
    bgTop: '#17181c',
    bgBottom: '#23252b',
    glow: 'rgba(250, 204, 21, 0.10)',
    grid: 'rgba(255, 255, 255, 0.05)',
    gridMajor: 'rgba(255, 255, 255, 0.1)',
    border: 'rgba(250, 204, 21, 0.35)',
    borderGlow: 'rgba(250, 204, 21, 0.45)',
  },
  paper: {
    label: 'Бумага',
    bgTop: '#f4f5f8',
    bgBottom: '#e6e8ef',
    glow: 'rgba(99, 102, 241, 0.10)',
    grid: 'rgba(15, 23, 42, 0.07)',
    gridMajor: 'rgba(15, 23, 42, 0.13)',
    border: 'rgba(15, 23, 42, 0.35)',
    borderGlow: 'rgba(99, 102, 241, 0.35)',
  },
};