/**
 * input.js — обработка указателя (мышь + тач + перо) через Pointer Events.
 *
 * Все инструменты работают через один набор событий, поэтому тач и мышь ведут
 * себя одинаково. Координаты переводятся из CSS-пикселей в мировые с учётом
 * масштабирования канваса.
 */

export const TOOL = Object.freeze({
  SELECT: 'select',
  SPAWN: 'spawn',
  ERASE: 'erase',
  FREEZE: 'freeze',
  JOINT: 'joint',
});

export class InputController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./engine/world.js').World} world
   * @param {object} callbacks
   */
  constructor(canvas, world, callbacks = {}) {
    this.canvas = canvas;
    this.world = world;
    this.cb = callbacks;

    this.tool = TOOL.SELECT;
    this.spawnKind = 'circle';

    this.dragJoint = null;
    this.draggedBody = null;
    this.pendingJointBody = null;
    this.hoveredBody = null;
    this.pointerId = null;

    this._bind();
  }

  _toWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.world.width,
      y: ((event.clientY - rect.top) / rect.height) * this.world.height,
    };
  }

  _bind() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    canvas.addEventListener('pointerup', (e) => this._onUp(e));
    canvas.addEventListener('pointercancel', (e) => this._onUp(e));
    canvas.addEventListener('pointerleave', (e) => this._onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Колесо — масштаб силы броска подсказки не нужно, но пусть будет «толчок».
    canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  setTool(tool) {
    if (this.tool === tool) return;
    this._cancelJointSelection();
    this.tool = tool;
    this._updateCursor();
    this.cb.onToolChange?.(tool);
  }

  setSpawnKind(kind) {
    this.spawnKind = kind;
  }

  _updateCursor() {
    const cursors = {
      [TOOL.SELECT]: 'grab',
      [TOOL.SPAWN]: 'crosshair',
      [TOOL.ERASE]: 'not-allowed',
      [TOOL.FREEZE]: 'pointer',
      [TOOL.JOINT]: 'cell',
    };
    this.canvas.style.cursor = cursors[this.tool] ?? 'default';
  }

  _onDown(event) {
    const point = this._toWorld(event);
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointerId = event.pointerId;

    // Правая кнопка = удаление, независимо от инструмента.
    if (event.button === 2) {
      this._eraseAt(point);
      return;
    }
    if (event.button !== 0) return;

    switch (this.tool) {
      case TOOL.SELECT:
        this._beginDrag(point);
        break;
      case TOOL.SPAWN:
        this.cb.onSpawn?.(point, this.spawnKind);
        break;
      case TOOL.ERASE:
        this._eraseAt(point);
        break;
      case TOOL.FREEZE:
        this._toggleFreeze(point);
        break;
      case TOOL.JOINT:
        this._pickJoint(point);
        break;
      default:
        break;
    }
  }

  _onMove(event) {
    const point = this._toWorld(event);

    if (this.dragJoint) {
      this.dragJoint.target.set(point.x, point.y);
      return;
    }

    // Подсветка под курсором.
    const body = this.world.bodyAt(point.x, point.y);
    if (body !== this.hoveredBody) {
      if (this.hoveredBody) this.hoveredBody.selected = false;
      if (body && this.tool === TOOL.SELECT) body.selected = true;
      this.hoveredBody = body;
    }
  }

  _onUp(event) {
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    this.canvas.releasePointerCapture?.(event.pointerId);

    if (this.dragJoint) {
      this.world.removeJoint(this.dragJoint);
      this.dragJoint = null;
      if (this.draggedBody) {
        this.draggedBody.selected = false;
        this.draggedBody = null;
      }
    }
    this.pointerId = null;
    this._updateCursor();
  }

  _beginDrag(point) {
    const body = this.world.bodyAt(point.x, point.y);
    if (!body) return;

    if (body.isStatic) {
      // Статичные тела не двигаем, но подсвечиваем.
      body.selected = true;
      setTimeout(() => { body.selected = false; }, 180);
      return;
    }

    this.draggedBody = body;
    body.selected = true;
    body.wake();
    this.dragJoint = this.world.createMouseJoint(body, point);
    this.canvas.style.cursor = 'grabbing';
  }

  _eraseAt(point) {
    const body = this.world.bodyAt(point.x, point.y);
    if (!body) return;
    this.world.particles.burst(body.position.x, body.position.y, 16, {
      color: body.color,
      speed: 260,
      life: 0.6,
      size: 3,
    });
    this.world.remove(body);
    this.cb.onRemove?.(body);
  }

  _toggleFreeze(point) {
    const body = this.world.bodyAt(point.x, point.y);
    if (!body) return;

    if (body.isStatic) {
      // Размораживаем: возвращаем массу по площади.
      body.applyDensity?.(this.world.settings.density);
      body.canSleep = true;
      body.wake();
      body.color = this.cb.thawColor?.(body) ?? body.color;
    } else {
      body.setMass(0, 0);
      body.sleep();
      body.color = '#64748b';
    }
    this.cb.onFreeze?.(body);
  }

  _pickJoint(point) {
    const body = this.world.bodyAt(point.x, point.y);
    if (!body) {
      this._cancelJointSelection();
      return;
    }

    if (!this.pendingJointBody) {
      this.pendingJointBody = body;
      body.selected = true;
      this.cb.onJointPick?.(body, false);
      return;
    }

    if (this.pendingJointBody === body) {
      this._cancelJointSelection();
      return;
    }

    const joint = this.world.createDistanceJoint(this.pendingJointBody, body, 0.9);
    this.cb.onJointCreated?.(joint);
    this._cancelJointSelection();
  }

  _cancelJointSelection() {
    if (this.pendingJointBody) {
      this.pendingJointBody.selected = false;
      this.pendingJointBody = null;
      this.cb.onJointPick?.(null, false);
    }
  }

  cancel() {
    this._cancelJointSelection();
    if (this.dragJoint) {
      this.world.removeJoint(this.dragJoint);
      this.dragJoint = null;
    }
  }
}