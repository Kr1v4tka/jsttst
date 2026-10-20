/**
 * demo.js — генерация синтетической стереопары для демонстрации.
 *
 * Сцена: несколько фигур на разной глубине. Левое и правое изображения
 * отличаются горизонтальным сдвигом, пропорциональным глубине объекта.
 * Модуль не зависит от DOM: работает с ImageData-подобными объектами.
 */

/**
 * @typedef {object} SceneObject
 * @property {'rect'|'circle'} type
 * @property {number} depth 0..1 — 1 = ближе к камере
 * @property {string} color
 */

/** Сцена по умолчанию: фигуры на пяти уровнях глубины. */
export const DEFAULT_SCENE = [
  { type: 'rect', x: 60, y: 70, w: 190, h: 140, depth: 0.28, color: [233, 69, 96] },
  { type: 'circle', cx: 450, cy: 170, r: 78, depth: 0.58, color: [0, 229, 160] },
  { type: 'rect', x: 250, y: 250, w: 210, h: 130, depth: 0.78, color: [245, 158, 11] },
  { type: 'circle', cx: 150, cy: 360, r: 58, depth: 0.95, color: [59, 130, 246] },
  { type: 'rect', x: 410, y: 320, w: 170, h: 115, depth: 0.46, color: [139, 92, 246] },
];

/** Детерминированный ГПСЧ, чтобы демо было воспроизводимым. */
function createRng(seed = 0x1a2b3c) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Рисует левый кадр в переданный ImageData (RGBA).
 * @param {Uint8ClampedArray} data
 */
function paintLeftFrame(data, width, height, scene, rng) {
  // Фон — вертикальный градиент.
  for (let y = 0; y < height; y += 1) {
    const t = y / height;
    const r = 26 + t * 4;
    const g = 26 + t * 30;
    const b = 46 + t * 60;
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }

  // Фигуры.
  for (const obj of scene) {
    const [cr, cg, cb] = obj.color;

    const paintPixel = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const p = (y * width + x) * 4;
      // Лёгкая «текстура» внутри фигуры — нужна для корректного сопоставления.
      const shade = 0.82 + 0.18 * Math.sin(x * 0.55 + y * 0.37);
      data[p] = Math.min(255, cr * shade);
      data[p + 1] = Math.min(255, cg * shade);
      data[p + 2] = Math.min(255, cb * shade);
      data[p + 3] = 255;
    };

    if (obj.type === 'rect') {
      for (let y = obj.y; y < obj.y + obj.h; y += 1) {
        for (let x = obj.x; x < obj.x + obj.w; x += 1) paintPixel(x, y);
      }
    } else {
      const r2 = obj.r * obj.r;
      for (let y = obj.cy - obj.r; y <= obj.cy + obj.r; y += 1) {
        for (let x = obj.cx - obj.r; x <= obj.cx + obj.r; x += 1) {
          const dx = x - obj.cx;
          const dy = y - obj.cy;
          if (dx * dx + dy * dy <= r2) paintPixel(x, y);
        }
      }
    }
  }

  // Мелкий шум сенсора — делает карту глубины реалистичнее.
  for (let i = 0; i < data.length; i += 4) {
    const n = (rng() - 0.5) * 8;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
}

/**
 * Строит карту «истинной» глубины сцены (0..1).
 * @returns {Float32Array}
 */
export function buildGroundTruth(scene, width, height) {
  const depth = new Float32Array(width * height).fill(0.08);

  for (const obj of scene) {
    if (obj.type === 'rect') {
      for (let y = Math.max(0, obj.y); y < Math.min(height, obj.y + obj.h); y += 1) {
        for (let x = Math.max(0, obj.x); x < Math.min(width, obj.x + obj.w); x += 1) {
          depth[y * width + x] = obj.depth;
        }
      }
    } else {
      const r2 = obj.r * obj.r;
      for (let y = Math.max(0, obj.cy - obj.r); y < Math.min(height, obj.cy + obj.r); y += 1) {
        for (let x = Math.max(0, obj.cx - obj.r); x < Math.min(width, obj.cx + obj.r); x += 1) {
          const dx = x - obj.cx;
          const dy = y - obj.cy;
          if (dx * dx + dy * dy <= r2) depth[y * width + x] = obj.depth;
        }
      }
    }
  }

  return depth;
}

/**
 * Генерирует стереопару.
 *
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 * @param {Array} [options.scene] список фигур
 * @param {number} [options.maxShift] максимальный сдвиг в пикселях
 * @param {number} [options.seed] зерно ГПСЧ
 * @returns {{left: Uint8ClampedArray, right: Uint8ClampedArray, width: number, height: number, depth: Float32Array}}
 */
export function generateStereoPair(width = 640, height = 480, options = {}) {
  const {
    scene = DEFAULT_SCENE,
    maxShift = 40,
    seed = 0x1a2b3c,
  } = options;

  const rng = createRng(seed);
  const left = new Uint8ClampedArray(width * height * 4);
  paintLeftFrame(left, width, height, scene, rng);

  const depth = buildGroundTruth(scene, width, height);

  // Правое изображение: точка левого кадра x видна в правом по адресу x - shift,
  // то есть right[x] = left[x + shift]. Это стандартная конвенция диспаратности.
  const right = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shift = Math.round(depth[y * width + x] * maxShift);
      const srcX = Math.min(width - 1, x + shift);
      const dst = (y * width + x) * 4;
      const src = (y * width + srcX) * 4;
      right[dst] = left[src];
      right[dst + 1] = left[src + 1];
      right[dst + 2] = left[src + 2];
      right[dst + 3] = 255;
    }
  }

  return { left, right, width, height, depth };
}