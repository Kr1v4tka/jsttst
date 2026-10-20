/**
 * app.js — точка входа песочницы: связывает движок, рендерер, ввод и UI.
 */

import { World } from './engine/world.js';
import { Renderer, THEMES } from './renderer.js';
import { InputController, TOOL } from './input.js';
import { PRESETS, pickColor } from './presets.js';

const canvas = document.getElementById('canvas');
const stage = document.getElementById('stage');

const world = new World(stage.clientWidth, stage.clientHeight);
const renderer = new Renderer(canvas, world);

const ui = {
  fps: document.getElementById('statFps'),
  bodies: document.getElementById('statBodies'),
  contacts: document.getElementById('statContacts'),
  particles: document.getElementById('statParticles'),
  sleeping: document.getElementById('statSleeping'),
  stepMs: document.getElementById('statStep'),
  toolHint: document.getElementById('toolHint'),
  toast: document.getElementById('toast'),
  pauseBtn: document.getElementById('btnPause'),
  gravity: document.getElementById('gravity'),
  gravityValue: document.getElementById('gravityValue'),
  restitution: document.getElementById('restitution'),
  restitutionValue: document.getElementById('restitutionValue'),
  friction: document.getElementById('friction'),
  frictionValue: document.getElementById('frictionValue'),
  timeScale: document.getElementById('timeScale'),
  timeScaleValue: document.getElementById('timeScaleValue'),
  preset: document.getElementById('preset'),
  theme: document.getElementById('theme'),
  spawnShape: document.getElementById('spawnShape'),
  showGrid: document.getElementById('showGrid'),
  showVectors: document.getElementById('showVectors'),
  showContacts: document.getElementById('showContacts'),
  showShadows: document.getElementById('showShadows'),
  particlesEnabled: document.getElementById('particlesEnabled'),
  sleepEnabled: document.getElementById('sleepEnabled'),
};

const state = {
  paused: false,
  timeScale: 1,
  spawnShape: 'circle',
};

/* ============================================================
 * Инициализация мира
 * ========================================================== */

function applyMaterialSettings() {
  const restitution = parseFloat(ui.restitution.value);
  const friction = parseFloat(ui.friction.value);
  for (const body of world.bodies) {
    if (body.isStatic) continue;
    body.restitution = restitution;
    body.friction = friction;
  }
}

function spawnShapeAt(point, kind) {
  const color = pickColor(world.bodies.length + Math.floor(Math.random() * 3));
  const options = {
    color,
    restitution: parseFloat(ui.restitution.value),
    friction: parseFloat(ui.friction.value),
    angularVelocity: (Math.random() - 0.5) * 3,
  };

  if (kind === 'circle') {
    world.createCircle(point.x, point.y, 14 + Math.random() * 10, options);
  } else if (kind === 'box') {
    const size = 24 + Math.random() * 18;
    world.createBox(point.x, point.y, size, size, options);
  } else {
    const sides = 3 + Math.floor(Math.random() * 5);
    world.createPolygon(point.x, point.y, 18 + Math.random() * 14, sides, options);
  }

  world.particles.burst(point.x, point.y, 8, {
    color,
    speed: 120,
    life: 0.35,
    size: 2.2,
    gravity: 200,
  });
}

const input = new InputController(canvas, world, {
  onSpawn: spawnShapeAt,
  onRemove: (body) => {
    toast(`Удалено тело #${body.id}`);
  },
  onJointPick: (body) => {
    if (body) toast('Выберите второе тело для соединения');
  },
  onJointCreated: () => toast('Соединение создано'),
  onFreeze: (body) => toast(body.isStatic ? 'Тело заморожено' : 'Тело разморожено'),
  onToolChange: updateHint,
  thawColor: () => pickColor(Math.floor(Math.random() * 8)),
});

function updateHint(tool) {
  const hints = {
    [TOOL.SELECT]: 'ЛКМ — перетащить тело · ПКМ — удалить',
    [TOOL.SPAWN]: 'Клик — создать тело выбранной формы',
    [TOOL.ERASE]: 'Клик по телу — удалить его',
    [TOOL.FREEZE]: 'Клик по телу — заморозить/разморозить',
    [TOOL.JOINT]: 'Клик по двум телам — соединить их',
  };
  ui.toolHint.textContent = hints[tool] ?? '';
}

/* ============================================================
 * Загрузка сцены
 * ========================================================== */

function loadPreset(name) {
  world.clear();
  const preset = PRESETS[name];
  if (!preset) return;

  preset.build(world);

  // Применяем текущие настройки материала к новым телам.
  applyMaterialSettings();
  toast(`Сцена: ${preset.label}`);
}

/* ============================================================
 * Цикл рендера
 * ========================================================== */

let lastTime = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fpsValue = 60;

function loop(now) {
  const dtRaw = (now - lastTime) / 1000;
  lastTime = now;
  // Ограничиваем dt, чтобы после сворачивания вкладки не было «прыжка».
  const dt = Math.min(dtRaw, 1 / 20);

  if (!state.paused) {
    world.advance(dt * state.timeScale);
  }

  renderer.render();

  // FPS.
  fpsFrames += 1;
  fpsTime += dtRaw;
  if (fpsTime >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }

  // Статистика обновляется реже, чтобы не дёргать layout каждый кадр.
  updateStats();
  requestAnimationFrame(loop);
}

let statsAccumulator = 0;
function updateStats() {
  statsAccumulator += 1;
  if (statsAccumulator % 15 !== 0) return;

  ui.fps.textContent = String(fpsValue);
  ui.bodies.textContent = String(world.stats.bodies);
  ui.contacts.textContent = String(world.stats.contacts);
  ui.particles.textContent = String(world.stats.particles);
  ui.sleeping.textContent = String(world.stats.sleeping);
  ui.stepMs.textContent = `${world.stats.stepMs.toFixed(2)} ms`;
}

/* ============================================================
 * Toast
 * ========================================================== */

let toastTimer = null;
function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), 1800);
}

/* ============================================================
 * Привязка UI
 * ========================================================== */

function bindRange(element, output, formatter, onChange) {
  const update = () => {
    const value = parseFloat(element.value);
    output.textContent = formatter(value);
    onChange(value);
  };
  element.addEventListener('input', update);
  update();
}

bindRange(ui.gravity, ui.gravityValue, (v) => `${v.toFixed(0)} px/с²`, (v) => {
  world.setGravity(v);
});
bindRange(ui.restitution, ui.restitutionValue, (v) => v.toFixed(2), () => applyMaterialSettings());
bindRange(ui.friction, ui.frictionValue, (v) => v.toFixed(2), () => applyMaterialSettings());
bindRange(ui.timeScale, ui.timeScaleValue, (v) => `${v.toFixed(2)}×`, (v) => {
  state.timeScale = v;
});

ui.preset.addEventListener('change', () => loadPreset(ui.preset.value));

ui.theme.addEventListener('change', () => {
  renderer.setTheme(ui.theme.value);
  document.documentElement.dataset.theme = ui.theme.value;
});

ui.spawnShape.addEventListener('change', () => {
  state.spawnShape = ui.spawnShape.value;
  input.setSpawnKind(state.spawnShape);
});

ui.showGrid.addEventListener('change', () => {
  renderer.options.showGrid = ui.showGrid.checked;
  renderer.refreshBackground();
});
ui.showVectors.addEventListener('change', () => {
  renderer.options.showVectors = ui.showVectors.checked;
});
ui.showContacts.addEventListener('change', () => {
  renderer.options.showContacts = ui.showContacts.checked;
});
ui.showShadows.addEventListener('change', () => {
  renderer.options.showShadows = ui.showShadows.checked;
});
ui.particlesEnabled.addEventListener('change', () => {
  world.particles.enabled = ui.particlesEnabled.checked;
  if (!ui.particlesEnabled.checked) world.particles.clear();
});
ui.sleepEnabled.addEventListener('change', () => {
  world.settings.sleepTime = ui.sleepEnabled.checked ? 0.7 : Infinity;
  if (!ui.sleepEnabled.checked) {
    for (const body of world.bodies) body.wake();
  }
});

document.querySelectorAll('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    const tool = button.dataset.tool;
    input.setTool(tool);
    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.classList.toggle('is-active', b === button);
      b.setAttribute('aria-pressed', b === button ? 'true' : 'false');
    });
  });
});

document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => {
    const name = button.dataset.preset;
    ui.preset.value = name;
    loadPreset(name);
  });
});

ui.pauseBtn.addEventListener('click', () => {
  state.paused = !state.paused;
  ui.pauseBtn.textContent = state.paused ? 'Продолжить' : 'Пауза';
  ui.pauseBtn.classList.toggle('is-active', state.paused);
});

document.getElementById('btnClear').addEventListener('click', () => {
  world.clear();
  toast('Сцена очищена');
});

document.getElementById('btnScreenshot').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `sandbox-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast('Скриншот сохранён');
});

const panel = document.getElementById('panel');
document.getElementById('panelToggle').addEventListener('click', () => {
  panel.classList.toggle('is-collapsed');
  // После смены размера сцены нужно пересобрать буферы канваса.
  requestAnimationFrame(() => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width > 0 && height > 0) {
      renderer.resize(width, height);
      world.resize(width, height);
    }
  });
});

// Горячие клавиши.
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

  const shortcuts = {
    KeyV: TOOL.SELECT,
    KeyB: TOOL.SPAWN,
    KeyE: TOOL.ERASE,
    KeyF: TOOL.FREEZE,
    KeyJ: TOOL.JOINT,
  };

  if (shortcuts[event.code]) {
    const tool = shortcuts[event.code];
    input.setTool(tool);
    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tool === tool);
    });
  }

  if (event.code === 'Space') {
    event.preventDefault();
    ui.pauseBtn.click();
  }
  if (event.code === 'Escape') input.cancel();
});

/* ============================================================
 * Ресайз
 * ========================================================== */

const resizeObserver = new ResizeObserver(() => {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width <= 0 || height <= 0) return;
  renderer.resize(width, height);
  world.resize(width, height);
});

resizeObserver.observe(stage);

/* ============================================================
 * Старт
 * ========================================================== */

renderer.resize(stage.clientWidth, stage.clientHeight);
world.resize(stage.clientWidth, stage.clientHeight);
loadPreset('showcase');
updateHint(TOOL.SELECT);
requestAnimationFrame(loop);

// Экспорт для отладки из консоли.
window.__sandbox = { world, renderer, input, THEMES, loadPreset };