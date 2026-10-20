/**
 * app.js — контроллер стерео-демо.
 *
 * Отвечает за: загрузку изображений, запуск вычислений с прогрессом,
 * отрисовку карт, 3D-визуализацию на Three.js и экспорт.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
  toGrayscale,
  censusTransform,
  computeDisparity,
  computeDisparityRightToLeft,
  leftRightCheck,
  medianFilter,
  removeSpeckles,
  fillHoles,
  disparityToDepth,
  buildPointCloud as buildCloudData,
  colorizeDisparity,
  toPLY,
  toOBJ,
  disparityStats,
  INVALID,
  METRIC,
} from './stereo.js';

import { generateStereoPair } from './demo-scene.js';

/* ============================================================
 * DOM
 * ========================================================== */

const $ = (id) => document.getElementById(id);

const el = {
  dropLeft: $('dropLeft'),
  dropRight: $('dropRight'),
  placeholderLeft: $('placeholderLeft'),
  placeholderRight: $('placeholderRight'),
  fileLeft: $('fileLeft'),
  fileRight: $('fileRight'),
  btnDemo: $('btnDemo'),
  btnCompute: $('btnCompute'),
  btnReset: $('btnReset'),
  btnHelp: $('btnHelp'),
  btnHelpBar: $('btnHelpBar'),

  method: $('method'),
  maxDisp: $('maxDisp'),
  maxDispVal: $('maxDispVal'),
  blockSize: $('blockSize'),
  blockSizeVal: $('blockSizeVal'),
  scale: $('scale'),
  scaleVal: $('scaleVal'),
  uniqueRatio: $('uniqueRatio'),
  uniqueVal: $('uniqueVal'),

  filterSubpixel: $('filterSubpixel'),
  filterConsistency: $('filterConsistency'),
  filterMedian: $('filterMedian'),
  filterSpeckle: $('filterSpeckle'),
  filterFill: $('filterFill'),

  colormap: $('colormap'),
  invertColors: $('invertColors'),
  pointSize: $('pointSize'),
  pointSizeVal: $('pointSizeVal'),
  showWireframe: $('showWireframe'),
  showAxes: $('showAxes'),
  showGrid: $('showGrid'),

  progressFill: $('progressFill'),
  progressBar: $('progressBar'),
  computeStatus: $('computeStatus'),
  taskbarStatus: $('taskbarStatus'),
  clock: $('clock'),

  btnPly: $('btnPly'),
  btnObj: $('btnObj'),
  btnDepth: $('btnDepth'),
  btnDisp: $('btnDisp'),

  statResolution: $('statResolution'),
  statCoverage: $('statCoverage'),
  statRange: $('statRange'),
  statTime: $('statTime'),

  stereoEmpty: $('stereoEmpty'),
  stereoContent: $('stereoContent'),
  stereoCanvas: $('stereoCanvas'),

  depthEmpty: $('depthEmpty'),
  depthContent: $('depthContent'),
  depthCanvas: $('depthCanvas'),
  depthStats: $('depthStats'),

  pcEmpty: $('pcEmpty'),
  pcContent: $('pcContent'),
  modelEmpty: $('modelEmpty'),
  modelContent: $('modelContent'),

  helpModal: $('helpModal'),
  toastModal: $('toastModal'),
  toastText: $('toastText'),
};

/* ============================================================
 * Состояние
 * ========================================================== */

const state = {
  leftImg: null,
  rightImg: null,
  leftRGBA: null,
  width: 0,
  height: 0,

  disparity: null,
  depth: null,
  dispWidth: 0,
  dispHeight: 0,
  stats: null,

  stereoMode: 'side',
  computing: false,
  lastElapsed: 0,

  three: {
    pc: null,
    model: null,
  },
};

/* ============================================================
 * Утилиты UI
 * ========================================================== */

function setProgress(value) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  el.progressFill.style.width = `${pct}%`;
  el.progressBar.setAttribute('aria-valuenow', String(pct));
  el.taskbarStatus.textContent = pct >= 100 ? 'Готово' : `Вычисление: ${pct}%`;
}

function setStatus(text) {
  el.computeStatus.textContent = text;
}

/** Отдаёт управление браузеру, чтобы UI успел перерисоваться. */
function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

let toastTimer = null;
function showToast(message, autoClose = 2600) {
  el.toastText.textContent = message;
  el.toastModal.hidden = false;
  clearTimeout(toastTimer);
  if (autoClose > 0) {
    toastTimer = setTimeout(() => { el.toastModal.hidden = true; }, autoClose);
  }
}

function updateClock() {
  const now = new Date();
  el.clock.textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/* ============================================================
 * Модальные окна
 * ========================================================== */

function openModal(modal) {
  modal.hidden = false;
  const focusable = modal.querySelector('button, a');
  focusable?.focus();
}

function closeModal(modal) {
  modal.hidden = true;
}

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-close]')) {
      closeModal(modal);
    }
  });
});

el.btnHelp.addEventListener('click', () => openModal(el.helpModal));
el.btnHelpBar.addEventListener('click', () => openModal(el.helpModal));

/* ============================================================
 * Вкладки
 * ========================================================== */

const TABS = ['stereo', 'depth', 'pointcloud', 'model3d'];

function activateTab(name) {
  if (!TABS.includes(name)) return;

  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  TABS.forEach((tabName) => {
    const view = $(`tab-${tabName}`);
    view?.classList.toggle('is-active', tabName === name);
  });

  // 3D-сцены нужно пересчитать под новый размер контейнера.
  if (name === 'pointcloud') resizeThree('pc');
  if (name === 'model3d') resizeThree('model');
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
});

/* ============================================================
 * Загрузка изображений
 * ========================================================== */

function setupDropzone(drop, input, side) {
  drop.addEventListener('click', () => input.click());

  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });

  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));

  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) loadImageFile(file, side);
  });

  input.addEventListener('change', () => {
    if (input.files?.[0]) loadImageFile(input.files[0], side);
  });
}

function loadImageFile(file, side) {
  if (!file.type.startsWith('image/')) {
    showToast('Нужен файл изображения (PNG, JPEG, WebP).');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      if (side === 'left') state.leftImg = img;
      else state.rightImg = img;

      updateDropPreview(side, img);
      renderStereo();
      setStatus('Изображения загружены');
    };
    img.onerror = () => showToast('Не удалось прочитать изображение.');
    img.src = event.target.result;
  };
  reader.onerror = () => showToast('Ошибка чтения файла.');
  reader.readAsDataURL(file);
}

function updateDropPreview(side, img) {
  const drop = side === 'left' ? el.dropLeft : el.dropRight;
  const placeholder = side === 'left' ? el.placeholderLeft : el.placeholderRight;

  // Удаляем старый превью, если он был.
  drop.querySelectorAll('img').forEach((node) => node.remove());
  placeholder.hidden = true;

  const preview = document.createElement('img');
  preview.src = img.src;
  preview.alt = side === 'left' ? 'Левое изображение' : 'Правое изображение';
  drop.appendChild(preview);
}

setupDropzone(el.dropLeft, el.fileLeft, 'left');
setupDropzone(el.dropRight, el.fileRight, 'right');

/* ============================================================
 * Демо-пара
 * ========================================================== */

el.btnDemo.addEventListener('click', async () => {
  setStatus('Генерация демо…');
  await nextFrame();

  const { left, right, width, height } = generateStereoPair(640, 480);

  const leftCanvas = document.createElement('canvas');
  leftCanvas.width = width;
  leftCanvas.height = height;
  leftCanvas.getContext('2d').putImageData(new ImageData(left, width, height), 0, 0);

  const rightCanvas = document.createElement('canvas');
  rightCanvas.width = width;
  rightCanvas.height = height;
  rightCanvas.getContext('2d').putImageData(new ImageData(right, width, height), 0, 0);

  const [leftImg, rightImg] = await Promise.all([
    loadImageFromCanvas(leftCanvas),
    loadImageFromCanvas(rightCanvas),
  ]);

  state.leftImg = leftImg;
  state.rightImg = rightImg;

  updateDropPreview('left', leftImg);
  updateDropPreview('right', rightImg);
  renderStereo();

  setStatus('Демо готово — нажмите «Вычислить»');
  activateTab('stereo');
});

function loadImageFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL('image/png');
  });
}

/* ============================================================
 * Стерео-просмотр
 * ========================================================== */

document.querySelectorAll('[data-stereo-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.stereoMode = button.dataset.stereoMode;
    renderStereo();
  });
});

function renderStereo() {
  const { leftImg, rightImg } = state;
  if (!leftImg || !rightImg) return;

  el.stereoEmpty.hidden = true;
  el.stereoContent.hidden = false;

  const canvas = el.stereoCanvas;
  const ctx = canvas.getContext('2d');

  const lw = leftImg.naturalWidth || leftImg.width;
  const lh = leftImg.naturalHeight || leftImg.height;
  const rw = rightImg.naturalWidth || rightImg.width;
  const rh = rightImg.naturalHeight || rightImg.height;

  if (state.stereoMode === 'side') {
    canvas.width = lw + rw;
    canvas.height = Math.max(lh, rh);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(leftImg, 0, 0, lw, lh);
    ctx.drawImage(rightImg, lw, 0, rw, rh);
    return;
  }

  if (state.stereoMode === 'left') {
    canvas.width = lw;
    canvas.height = lh;
    ctx.drawImage(leftImg, 0, 0, lw, lh);
    return;
  }

  if (state.stereoMode === 'right') {
    canvas.width = rw;
    canvas.height = rh;
    ctx.drawImage(rightImg, 0, 0, rw, rh);
    return;
  }

  // Анаглиф: красный канал — левый кадр, зелёный и синий — правый.
  const width = Math.min(lw, rw);
  const height = Math.min(lh, rh);
  canvas.width = width;
  canvas.height = height;

  ctx.drawImage(leftImg, 0, 0, lw, lh, 0, 0, width, height);
  const leftData = ctx.getImageData(0, 0, width, height);

  ctx.drawImage(rightImg, 0, 0, rw, rh, 0, 0, width, height);
  const rightData = ctx.getImageData(0, 0, width, height);

  const out = ctx.createImageData(width, height);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = leftData.data[i];
    out.data[i + 1] = rightData.data[i + 1];
    out.data[i + 2] = rightData.data[i + 2];
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

/* ============================================================
 * Извлечение пикселей
 * ========================================================== */

/**
 * Масштабирует изображение и возвращает RGBA-данные.
 * @returns {{rgba: Uint8ClampedArray, width: number, height: number}}
 */
function extractPixels(img, targetWidth, targetHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  return ctx.getImageData(0, 0, targetWidth, targetHeight).data;
}

/* ============================================================
 * Вычисление
 * ========================================================== */

el.btnCompute.addEventListener('click', () => computeDisparityMap());

async function computeDisparityMap() {
  if (state.computing) return;

  if (!state.leftImg || !state.rightImg) {
    showToast('Сначала загрузите оба изображения или сгенерируйте демо.');
    return;
  }

  state.computing = true;
  const started = performance.now();
  el.btnCompute.disabled = true;
  setProgress(0);
  setStatus('Подготовка…');
  await nextFrame();

  try {
    const scaleFactor = parseInt(el.scale.value, 10);
    const maxDisparity = parseInt(el.maxDisp.value, 10);
    const blockSize = parseInt(el.blockSize.value, 10);
    const metric = el.method.value;
    const uniquenessRatio = parseFloat(el.uniqueRatio.value);

    const lw = state.leftImg.naturalWidth || state.leftImg.width;
    const lh = state.leftImg.naturalHeight || state.leftImg.height;
    const rw = state.rightImg.naturalWidth || state.rightImg.width;
    const rh = state.rightImg.naturalHeight || state.rightImg.height;

    const width = Math.max(16, Math.round(Math.min(lw, rw) / scaleFactor));
    const height = Math.max(16, Math.round(Math.min(lh, rh) / scaleFactor));

    setStatus(`Извлечение пикселей (${width}×${height})…`);
    await nextFrame();

    const leftRGBA = extractPixels(state.leftImg, width, height);
    const rightRGBA = extractPixels(state.rightImg, width, height);

    state.leftRGBA = leftRGBA;
    state.width = width;
    state.height = height;

    setProgress(0.08);
    setStatus('Подготовка данных…');
    await nextFrame();

    const leftGrey = toGrayscale(leftRGBA, width, height);
    const rightGrey = toGrayscale(rightRGBA, width, height);

    const useCensus = metric === METRIC.CENSUS;
    const leftInput = useCensus ? censusTransform(leftGrey, width, height) : leftGrey;
    const rightInput = useCensus ? censusTransform(rightGrey, width, height) : rightGrey;

    const options = {
      metric,
      maxDisparity,
      blockSize,
      subpixel: el.filterSubpixel.checked,
      uniquenessRatio,
    };

    setProgress(0.15);
    setStatus('Сопоставление блоков…');
    await nextFrame();

    let disparity = computeDisparity(leftInput, rightInput, width, height, options);
    setProgress(0.6);
    await nextFrame();

    if (el.filterConsistency.checked) {
      setStatus('LR-консистентность…');
      await nextFrame();

      const rightInput2 = useCensus ? censusTransform(rightGrey, width, height) : rightGrey;
      const leftInput2 = useCensus ? censusTransform(leftGrey, width, height) : leftGrey;
      const reverse = computeDisparityRightToLeft(leftInput2, rightInput2, width, height, options);
      disparity = leftRightCheck(disparity, reverse, width, height, 1.5);
      setProgress(0.72);
      await nextFrame();
    }

    if (el.filterMedian.checked) {
      setStatus('Медианный фильтр…');
      await nextFrame();
      disparity = medianFilter(disparity, width, height);
      setProgress(0.8);
    }

    if (el.filterSpeckle.checked) {
      setStatus('Удаление спеклов…');
      await nextFrame();
      const minSize = Math.max(30, Math.round((width * height) / 4000));
      removeSpeckles(disparity, width, height, minSize, 2);
      setProgress(0.86);
    }

    if (el.filterFill.checked) {
      setStatus('Заполнение дыр…');
      await nextFrame();
      disparity = fillHoles(disparity, width, height, 2);
      setProgress(0.9);
    }

    state.disparity = disparity;
    state.dispWidth = width;
    state.dispHeight = height;
    state.depth = disparityToDepth(disparity, 1, 1);
    state.stats = disparityStats(disparity, width, height);

    setStatus('Визуализация…');
    setProgress(0.94);
    await nextFrame();

    renderDepthMap();
    buildPointCloudView();
    build3DModelView();

    state.lastElapsed = performance.now() - started;
    updateStatsPanel();

    setProgress(1);
    setStatus('Готово');
    enableExports(true);
    activateTab('depth');
    showToast(`Вычислено за ${(state.lastElapsed / 1000).toFixed(2)} с`);
  } catch (error) {
    console.error(error);
    setStatus('Ошибка вычисления');
    showToast(`Ошибка: ${error.message}`);
  } finally {
    state.computing = false;
    el.btnCompute.disabled = false;
    setTimeout(() => {
      if (!state.computing) setProgress(0);
    }, 2500);
  }
}

function updateStatsPanel() {
  if (!state.stats) return;
  const { width, height } = state;
  const { coverage, min, max, valid } = state.stats;

  el.statResolution.textContent = `${width}×${height}`;
  el.statCoverage.textContent = `${(coverage * 100).toFixed(1)}% (${valid})`;
  el.statRange.textContent = `${min.toFixed(1)}–${max.toFixed(1)}`;
  el.statTime.textContent = `${(state.lastElapsed / 1000).toFixed(2)} с`;
}

function enableExports(enabled) {
  el.btnPly.disabled = !enabled;
  el.btnObj.disabled = !enabled;
  el.btnDepth.disabled = !enabled;
  el.btnDisp.disabled = !enabled;
}

/* ============================================================
 * Карта глубины
 * ========================================================== */

function renderDepthMap() {
  if (!state.disparity) return;

  el.depthEmpty.hidden = true;
  el.depthContent.hidden = false;

  const { dispWidth: width, dispHeight: height } = state;
  const canvas = el.depthCanvas;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  const { rgba } = colorizeDisparity(
    state.disparity,
    width,
    height,
    el.colormap.value,
    el.invertColors.checked,
  );

  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);

  const stats = state.stats ?? disparityStats(state.disparity, width, height);
  el.depthStats.textContent =
    `Заполнено: ${(stats.coverage * 100).toFixed(1)}% · `
    + `диспаратность ${stats.min.toFixed(1)}–${stats.max.toFixed(1)}`;
}

el.colormap.addEventListener('change', () => {
  if (state.disparity) renderDepthMap();
});
el.invertColors.addEventListener('change', () => {
  if (state.disparity) renderDepthMap();
});

/* ============================================================
 * Three.js: облако точек и модель
 * ========================================================== */

function disposeThree(kind) {
  const scene = state.three[kind];
  if (!scene) return;

  cancelAnimationFrame(scene.animId);
  scene.controls?.dispose();

  scene.scene.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });

  if (scene.renderer) {
    scene.renderer.dispose();
    scene.renderer.forceContextLoss();
    scene.renderer.domElement.remove();
  }

  state.three[kind] = null;
}

function createThreeContext(container, background = 0x0b1020) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  const camera = new THREE.PerspectiveCamera(55, width / height, 0.01, 2000);
  camera.position.set(0, 0, 6);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.set(0, 0, 0);

  return { scene, camera, renderer, controls, animId: null, container };
}

function addHelpers(context) {
  if (el.showAxes.checked) {
    const axes = new THREE.AxesHelper(2);
    context.scene.add(axes);
  }
  if (el.showGrid.checked) {
    const grid = new THREE.GridHelper(12, 24, 0x64748b, 0x334155);
    grid.position.y = -3;
    context.scene.add(grid);
  }
}

function startAnimation(kind) {
  const context = state.three[kind];
  if (!context) return;

  const animate = () => {
    const current = state.three[kind];
    if (!current) return;
    current.animId = requestAnimationFrame(animate);
    current.controls.update();
    current.renderer.render(current.scene, current.camera);
  };
  animate();
}

function buildPointCloudView() {
  if (!state.disparity) return;

  disposeThree('pc');

  el.pcEmpty.hidden = true;
  el.pcContent.hidden = false;

  const container = el.pcContent;
  const context = createThreeContext(container, 0x0b1020);
  addHelpers(context);
  context.scene.add(new THREE.AmbientLight(0xffffff, 0.9));

  const { positions, colors, count } = buildCloudData(
    state.disparity,
    state.leftRGBA,
    state.dispWidth,
    state.dispHeight,
    { maxPoints: 150000 },
  );

  if (count > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    if (colors.length === positions.length) {
      const normalized = new Float32Array(colors.length);
      for (let i = 0; i < colors.length; i += 1) normalized[i] = colors[i] / 255;
      geometry.setAttribute('color', new THREE.BufferAttribute(normalized, 3));
    }

    geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere?.radius ?? 1;

    const size = parseFloat(el.pointSize.value);
    const material = new THREE.PointsMaterial({
      size: (size * radius) / 220,
      vertexColors: colors.length === positions.length,
      sizeAttenuation: true,
      color: 0xffffff,
    });

    context.scene.add(new THREE.Points(geometry, material));

    // Ставим камеру так, чтобы объект целиком помещался в кадр.
    context.camera.position.set(0, 0, radius * 2.2);
    context.controls.target.set(0, 0, radius * 0.4);
  }

  state.three.pc = context;
  startAnimation('pc');
}

function build3DModelView() {
  if (!state.disparity) return;

  disposeThree('model');

  el.modelEmpty.hidden = true;
  el.modelContent.hidden = false;

  const container = el.modelContent;
  const context = createThreeContext(container, 0x0b1020);
  addHelpers(context);

  context.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(4, 6, 6);
  context.scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
  fill.position.set(-5, -2, -4);
  context.scene.add(fill);

  const { dispWidth: width, dispHeight: height } = state;
  const segmentsX = Math.min(width - 1, 240);
  const segmentsY = Math.min(height - 1, 240);
  const geoW = 8;
  const geoH = (8 * height) / width;

  const geometry = new THREE.PlaneGeometry(geoW, geoH, segmentsX, segmentsY);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;

  let maxDisparity = 0;
  for (let i = 0; i < state.disparity.length; i += 1) {
    if (state.disparity[i] > maxDisparity) maxDisparity = state.disparity[i];
  }
  if (maxDisparity <= 0) maxDisparity = 1;

  for (let i = 0; i < position.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height)));
    const d = state.disparity[py * width + px];
    const z = d >= 0 ? (d / maxDisparity) * 3 : 0;
    position.setZ(i, z);
  }

  geometry.computeVertexNormals();

  // Текстура — левый кадр.
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = width;
  textureCanvas.height = height;
  const textureCtx = textureCanvas.getContext('2d');
  textureCtx.putImageData(new ImageData(new Uint8ClampedArray(state.leftRGBA), width, height), 0, 0);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    wireframe: el.showWireframe.checked,
    roughness: 0.7,
    metalness: 0.05,
  });

  context.scene.add(new THREE.Mesh(geometry, material));
  context.camera.position.set(0, 0, geoW * 0.9);

  state.three.model = context;
  state.three.model.material = material;
  startAnimation('model');
}

function resizeThree(kind) {
  const context = state.three[kind];
  if (!context) return;

  const container = context.container;
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  context.renderer.setSize(width, height);
  context.camera.aspect = width / height;
  context.camera.updateProjectionMatrix();
}

/* ============================================================
 * Привязка настроек визуализации
 * ========================================================== */

el.pointSize.addEventListener('input', () => {
  el.pointSizeVal.textContent = parseFloat(el.pointSize.value).toFixed(1);
  const context = state.three.pc;
  if (!context) return;
  const points = context.scene.children.find((child) => child.isPoints);
  if (points) {
    const radius = points.geometry.boundingSphere?.radius ?? 1;
    points.material.size = (parseFloat(el.pointSize.value) * radius) / 220;
    points.material.needsUpdate = true;
  }
});

el.showWireframe.addEventListener('change', () => {
  const material = state.three.model?.material;
  if (material) {
    material.wireframe = el.showWireframe.checked;
    material.needsUpdate = true;
  }
});

el.showAxes.addEventListener('change', () => {
  if (state.disparity) {
    buildPointCloudView();
    build3DModelView();
  }
});

el.showGrid.addEventListener('change', () => {
  if (state.disparity) {
    buildPointCloudView();
    build3DModelView();
  }
});

/* ============================================================
 * Ползунки — отображение значений
 * ========================================================== */

function bindOutput(input, output, format) {
  const update = () => { output.textContent = format(input.value); };
  input.addEventListener('input', update);
  update();
}

bindOutput(el.maxDisp, el.maxDispVal, (v) => v);
bindOutput(el.blockSize, el.blockSizeVal, (v) => v);
bindOutput(el.scale, el.scaleVal, (v) => `1/${v}`);
bindOutput(el.uniqueRatio, el.uniqueVal, (v) => parseFloat(v).toFixed(2));
bindOutput(el.pointSize, el.pointSizeVal, (v) => parseFloat(v).toFixed(1));

/* ============================================================
 * Экспорт
 * ========================================================== */

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

el.btnPly.addEventListener('click', () => {
  if (!state.disparity) return;
  const cloud = buildCloudData(
    state.disparity,
    state.leftRGBA,
    state.dispWidth,
    state.dispHeight,
    { maxPoints: 400000 },
  );
  const ply = toPLY(cloud.positions, cloud.colors);
  download(ply, 'pointcloud.ply', 'text/plain');
  showToast(`Экспорт PLY: ${cloud.count} точек`);
});

el.btnObj.addEventListener('click', () => {
  if (!state.disparity) return;
  const obj = toOBJ(state.disparity, state.dispWidth, state.dispHeight, { maxGrid: 200 });
  download(obj, 'model.obj', 'text/plain');
  showToast('3D-модель экспортирована в OBJ');
});

el.btnDepth.addEventListener('click', () => {
  if (!state.disparity) return;
  el.depthCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'depth-map.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
  showToast('Карта глубины сохранена');
});

el.btnDisp.addEventListener('click', () => {
  if (!state.disparity) return;

  // Сохраняем «сырую» карту диспаратности, а не текущий цветной рендер.
  const { dispWidth: width, dispHeight: height } = state;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  let maxD = 0;
  for (let i = 0; i < state.disparity.length; i += 1) {
    if (state.disparity[i] > maxD) maxD = state.disparity[i];
  }
  if (maxD <= 0) maxD = 1;

  const image = ctx.createImageData(width, height);
  for (let i = 0; i < state.disparity.length; i += 1) {
    const d = state.disparity[i];
    const p = i * 4;
    const value = d === INVALID ? 0 : Math.round((d / maxD) * 255);
    image.data[p] = value;
    image.data[p + 1] = value;
    image.data[p + 2] = value;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'disparity.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');

  showToast('Карта диспаратности сохранена');
});

/* ============================================================
 * Сброс
 * ========================================================== */

el.btnReset.addEventListener('click', () => {
  disposeThree('pc');
  disposeThree('model');

  state.leftImg = null;
  state.rightImg = null;
  state.leftRGBA = null;
  state.disparity = null;
  state.depth = null;
  state.stats = null;

  el.fileLeft.value = '';
  el.fileRight.value = '';

  for (const [drop, placeholder] of [
    [el.dropLeft, el.placeholderLeft],
    [el.dropRight, el.placeholderRight],
  ]) {
    drop.querySelectorAll('img').forEach((node) => node.remove());
    placeholder.hidden = false;
  }

  el.stereoEmpty.hidden = false;
  el.stereoContent.hidden = true;
  el.depthEmpty.hidden = false;
  el.depthContent.hidden = true;
  el.pcEmpty.hidden = false;
  el.pcContent.hidden = true;
  el.modelEmpty.hidden = false;
  el.modelContent.hidden = true;

  el.statResolution.textContent = '—';
  el.statCoverage.textContent = '—';
  el.statRange.textContent = '—';
  el.statTime.textContent = '—';

  enableExports(false);
  setProgress(0);
  setStatus('Ожидание…');
  el.taskbarStatus.textContent = 'Готово';
  activateTab('stereo');
});

/* ============================================================
 * Горячие клавиши и ресайз
 * ========================================================== */

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.modal:not([hidden])').forEach((modal) => closeModal(modal));
    return;
  }

  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    computeDisparityMap();
    return;
  }

  const tabIndex = ['1', '2', '3', '4'].indexOf(event.key);
  if (tabIndex !== -1) activateTab(TABS[tabIndex]);
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeThree('pc');
    resizeThree('model');
  }, 120);
});

/* ============================================================
 * Старт
 * ========================================================== */

updateClock();
setInterval(updateClock, 10000);
activateTab('stereo');

// Демо-пара загружается сразу, чтобы страница не была пустой.
setTimeout(() => {
  el.btnDemo.click();
}, 60);

// Отладочный доступ из консоли.
window.__stereo = { state, computeDisparityMap, generateStereoPair };