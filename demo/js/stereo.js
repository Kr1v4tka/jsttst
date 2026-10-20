/**
 * stereo.js — алгоритмы стереосопоставления.
 *
 * Чистый модуль без DOM: принимает типизированные массивы, возвращает
 * карту диспаратности. Благодаря этому тестируется в Node.js.
 *
 * Конвенция: диспаратность `d` для пикселя (x, y) левого изображения означает,
 * что соответствующая точка находится в правом изображении по адресу (x - d).
 * Значение INVALID (-1) зарезервировано под «нет данных»; d === 0 — валидная
 * нулевая диспаратность (бесконечная глубина).
 */

export const INVALID = -1;

/* ============================================================
 * Подготовка данных
 * ========================================================== */

/** RGB(A) → оттенки серого (8 бит). */
export function toGrayscale(rgba, width, height) {
  const grey = new Uint8Array(width * height);
  for (let i = 0; i < grey.length; i += 1) {
    const p = i * 4;
    grey[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) | 0;
  }
  return grey;
}

/**
 * Census-преобразование: для каждого пикселя 5×5 окрестность кодируется
 * 24-битным числом (сравнение с центральным пикселем).
 */
export function censusTransform(grey, width, height) {
  const census = new Uint32Array(width * height);
  const radius = 2;

  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      const center = grey[y * width + x];
      let bits = 0;
      let bit = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (grey[(y + dy) * width + (x + dx)] < center) bits |= (1 << bit);
          bit += 1;
        }
      }
      census[y * width + x] = bits >>> 0;
    }
  }
  return census;
}

/** Число установленных бит. */
export function popcount(value) {
  let n = value - ((value >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

/* ============================================================
 * Стоимость сопоставления
 * ========================================================== */

export const METRIC = Object.freeze({
  SAD: 'sad',
  CENSUS: 'census',
  ZNCC: 'zncc',
});

/**
 * @typedef {object} MatchOptions
 * @property {string} metric 'sad' | 'census' | 'zncc'
 * @property {number} maxDisparity максимальный сдвиг
 * @property {number} blockSize размер окна (нечётный)
 * @property {boolean} subpixel параболическое уточнение
 * @property {number} uniquenessRatio 0..1 — отбраковка неоднозначных
 */

const DEFAULT_OPTIONS = {
  metric: METRIC.SAD,
  maxDisparity: 64,
  blockSize: 7,
  subpixel: true,
  uniquenessRatio: 0.9,
};

function halfBlock(blockSize) {
  const half = (blockSize / 2) | 0;
  return half < 1 ? 1 : half;
}

/**
 * Стоимость SAD в окне.
 * @param {Uint8Array} left
 * @param {Uint8Array} right
 */
function costSAD(left, right, width, x, y, d, half) {
  let cost = 0;
  for (let dy = -half; dy <= half; dy += 1) {
    const row = (y + dy) * width;
    for (let dx = -half; dx <= half; dx += 1) {
      cost += Math.abs(left[row + x + dx] - right[row + x + dx - d]);
    }
  }
  return cost;
}

function costCensus(leftCensus, rightCensus, width, x, y, d, half) {
  let cost = 0;
  for (let dy = -half; dy <= half; dy += 1) {
    const row = (y + dy) * width;
    for (let dx = -half; dx <= half; dx += 1) {
      cost += popcount((leftCensus[row + x + dx] ^ rightCensus[row + x + dx - d]) >>> 0);
    }
  }
  return cost;
}

/**
 * ZNCC (zero-mean normalized cross correlation). Возвращает стоимость
 * в диапазоне [0, 2]: 0 — идеальное совпадение, 2 — полная антикорреляция.
 */
function costZNCC(left, right, width, x, y, d, half) {
  let sumL = 0;
  let sumR = 0;
  let sumLL = 0;
  let sumRR = 0;
  let sumLR = 0;
  const count = (half * 2 + 1) * (half * 2 + 1);

  for (let dy = -half; dy <= half; dy += 1) {
    const row = (y + dy) * width;
    for (let dx = -half; dx <= half; dx += 1) {
      const l = left[row + x + dx];
      const r = right[row + x + dx - d];
      sumL += l;
      sumR += r;
      sumLL += l * l;
      sumRR += r * r;
      sumLR += l * r;
    }
  }

  const meanL = sumL / count;
  const meanR = sumR / count;
  const varL = sumLL - count * meanL * meanL;
  const varR = sumRR - count * meanR * meanR;

  if (varL <= 1e-6 || varR <= 1e-6) return 2;
  const covariance = sumLR - count * meanL * meanR;
  return 1 - covariance / Math.sqrt(varL * varR);
}

/* ============================================================
 * Основной расчёт
 * ========================================================== */

/**
 * Считает карту диспаратности слева-направо.
 *
 * @param {Uint8Array} left серое левое изображение
 * @param {Uint8Array} right серое правое изображение
 * @param {number} width
 * @param {number} height
 * @param {Partial<MatchOptions>} [options]
 * @returns {Float32Array} диспаратность, 0 = нет данных
 */
export function computeDisparity(left, right, width, height, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const half = halfBlock(opts.blockSize);
  const maxD = Math.min(opts.maxDisparity, width - half - 1);
  const disparity = new Float32Array(width * height);

  if (maxD < 1 || width < half * 2 + 2 || height < half * 2 + 2) {
    disparity.fill(INVALID);
    return disparity;
  }
  disparity.fill(INVALID);

  const costFn = opts.metric === METRIC.CENSUS
    ? (x, y, d) => costCensus(left, right, width, x, y, d, half)
    : opts.metric === METRIC.ZNCC
      ? (x, y, d) => costZNCC(left, right, width, x, y, d, half)
      : (x, y, d) => costSAD(left, right, width, x, y, d, half);

  const costs = new Float32Array(maxD);

  for (let y = half; y < height - half; y += 1) {
    for (let x = half; x < width - half; x += 1) {
      let bestD = 0;
      let bestCost = Infinity;
      let secondCost = Infinity;

      for (let d = 0; d < maxD; d += 1) {
        if (x - d - half < 0) {
          costs[d] = Infinity;
          continue;
        }
        const cost = costFn(x, y, d);
        costs[d] = cost;

        if (cost < bestCost) {
          secondCost = bestCost;
          bestCost = cost;
          bestD = d;
        } else if (cost < secondCost) {
          secondCost = cost;
        }
      }

      if (!Number.isFinite(bestCost)) continue;

      // Отбраковка неоднозначных совпадений: лучший должен быть заметно
      // лучше второго. Для SAD/Census это работает как «пиковость».
      if (Number.isFinite(secondCost) && opts.uniquenessRatio > 0) {
        const ratio = bestCost / (secondCost || 1);
        if (ratio > opts.uniquenessRatio) continue;
      }

      let value = bestD;
      if (opts.subpixel && bestD > 0 && bestD < maxD - 1) {
        const c0 = costs[bestD - 1];
        const c1 = costs[bestD];
        const c2 = costs[bestD + 1];
        if (Number.isFinite(c0) && Number.isFinite(c2)) {
          const denom = 2 * (c0 - 2 * c1 + c2);
          if (Math.abs(denom) > 1e-9) {
            const delta = (c0 - c2) / denom;
            if (delta > -1 && delta < 1) value = bestD + delta;
          }
        }
      }

      disparity[y * width + x] = value;
    }
  }

  return disparity;
}

/**
 * Обратная карта (справа-налево) — нужна для LR-проверки.
 */
export function computeDisparityRightToLeft(left, right, width, height, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const half = halfBlock(opts.blockSize);
  const maxD = Math.min(opts.maxDisparity, width - half - 1);
  const disparity = new Float32Array(width * height);

  if (maxD < 1 || width < half * 2 + 2 || height < half * 2 + 2) {
    disparity.fill(INVALID);
    return disparity;
  }
  disparity.fill(INVALID);

  const useCensus = opts.metric === METRIC.CENSUS;

  for (let y = half; y < height - half; y += 1) {
    for (let x = half; x < width - half; x += 1) {
      let bestD = 0;
      let bestCost = Infinity;

      for (let d = 0; d < maxD; d += 1) {
        // Ищем в левом изображении правее на d.
        if (x + d + half >= width) break;
        let cost = 0;
        for (let dy = -half; dy <= half; dy += 1) {
          const row = (y + dy) * width;
          for (let dx = -half; dx <= half; dx += 1) {
            if (useCensus) {
              cost += popcount((right[row + x + dx] ^ left[row + x + dx + d]) >>> 0);
            } else {
              cost += Math.abs(right[row + x + dx] - left[row + x + dx + d]);
            }
          }
        }
        if (cost < bestCost) {
          bestCost = cost;
          bestD = d;
        }
      }

      disparity[y * width + x] = bestD;
    }
  }

  return disparity;
}

/*
 * Примечание: computeDisparityRightToLeft ожидает на входе уже
 * census-преобразованные изображения, если metric === 'census'.
 */

/* ============================================================
 * Фильтры постобработки
 * ========================================================== */

/** LR-консистентность: оставляет только взаимно подтверждённые пиксели. */
export function leftRightCheck(disparity, rightDisparity, width, height, tolerance = 1.5) {
  const out = Float32Array.from(disparity);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const d = disparity[index];
      if (d < 0) {
        out[index] = INVALID;
        continue;
      }
      const rx = Math.round(x - d);
      if (rx < 0 || rx >= width) {
        out[index] = INVALID;
        continue;
      }
      const dr = rightDisparity[y * width + rx];
      if (dr < 0 || Math.abs(d - dr) > tolerance) out[index] = INVALID;
    }
  }
  return out;
}

/** Медианный фильтр 3×3 по валидным значениям. */
export function medianFilter(disparity, width, height) {
  const out = new Float32Array(disparity.length);
  out.fill(INVALID);
  const window = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      window.length = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const value = disparity[ny * width + nx];
          if (value >= 0) window.push(value);
        }
      }
      if (window.length === 0) continue;
      window.sort((a, b) => a - b);
      out[y * width + x] = window[window.length >> 1];
    }
  }

  return out;
}

/** Удаляет связные области меньше minSize пикселей. */
export function removeSpeckles(disparity, width, height, minSize = 60, tolerance = 2) {
  const visited = new Uint8Array(width * height);
  const stack = [];
  const region = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (visited[start] || disparity[start] < 0) continue;

      region.length = 0;
      stack.length = 0;
      stack.push(start);
      visited[start] = 1;
      const reference = disparity[start];

      while (stack.length > 0) {
        const current = stack.pop();
        region.push(current);
        const cy = (current / width) | 0;
        const cx = current % width;

        const neighbours = [
          cy > 0 ? current - width : -1,
          cy < height - 1 ? current + width : -1,
          cx > 0 ? current - 1 : -1,
          cx < width - 1 ? current + 1 : -1,
        ];

        for (const n of neighbours) {
          if (n < 0 || visited[n]) continue;
          const value = disparity[n];
          if (value < 0) continue;
          if (Math.abs(value - reference) > tolerance) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }

      if (region.length < minSize) {
        for (const index of region) disparity[index] = INVALID;
      }
    }
  }

  return disparity;
}

/**
 * Заполняет «дыры» (INVALID) медианой валидных соседей.
 * Полезно перед построением облака точек.
 */
export function fillHoles(disparity, width, height, iterations = 2) {
  let current = Float32Array.from(disparity);

  for (let pass = 0; pass < iterations; pass += 1) {
    const next = Float32Array.from(current);
    const window = [];

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (current[index] >= 0) continue;

        window.length = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const value = current[(y + dy) * width + (x + dx)];
            if (value >= 0) window.push(value);
          }
        }
        if (window.length >= 3) {
          window.sort((a, b) => a - b);
          next[index] = window[window.length >> 1];
        }
      }
    }
    current = next;
  }

  return current;
}

/* ============================================================
 * Глубина и 3D
 * ========================================================== */

/**
 * Диспаратность → глубина: Z = f·B / d.
 * @param {number} focalLength фокусное расстояние в пикселях
 * @param {number} baseline расстояние между камерами (в тех же единицах)
 */
export function disparityToDepth(disparity, focalLength = 1, baseline = 1) {
  const depth = new Float32Array(disparity.length);
  const scale = focalLength * baseline;
  for (let i = 0; i < disparity.length; i += 1) {
    depth[i] = disparity[i] > 0 ? scale / disparity[i] : 0;
  }
  return depth;
}

/**
 * Строит облако точек из карты диспаратности.
 * @returns {{positions: Float32Array, colors: Uint8Array, count: number}}
 */
export function buildPointCloud(disparity, rgba, width, height, options = {}) {
  const {
    maxPoints = 160000,
    depthScale = 1,
    focalLength = 1,
    baseline = 1,
  } = options;

  const total = width * height;
  const step = Math.max(1, Math.ceil(Math.sqrt(total / maxPoints)));

  const positions = [];
  const colors = [];
  let maxDisparity = 0;
  for (let i = 0; i < disparity.length; i += 1) {
    if (disparity[i] > maxDisparity) maxDisparity = disparity[i];
  }
  if (maxDisparity <= 0) maxDisparity = 1;

  const scale = focalLength * baseline;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = y * width + x;
      const d = disparity[index];
      if (d <= 0) continue;

      const z = (scale / d) * depthScale;
      positions.push(x - width / 2, -(y - height / 2), z);

      if (rgba) {
        const p = index * 4;
        colors.push(rgba[p], rgba[p + 1], rgba[p + 2]);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    count: positions.length / 3,
  };
}

/* ============================================================
 * Цветовые карты
 * ========================================================== */

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export const COLORMAPS = {
  turbo(t) {
    // Приближение карты Turbo (Google) полиномом.
    const x = clamp01(t);
    const r = 34.61 + x * (1172.33 + x * (-10793.56 + x * (33300.12 + x * (-38394.49 + x * 14825.05))));
    const g = 23.31 + x * (557.33 + x * (1225.33 + x * (-3574.96 + x * (3368.28 + x * -1011.05))));
    const b = 27.2 + x * (3211.1 + x * (-15327.97 + x * (27814.0 + x * (-22569.18 + x * 6838.66))));
    return [
      Math.max(0, Math.min(255, r)) | 0,
      Math.max(0, Math.min(255, g)) | 0,
      Math.max(0, Math.min(255, b)) | 0,
    ];
  },

  viridis(t) {
    const x = clamp01(t);
    const r = -1.26 + x * (9.52 + x * (-12.8 + x * 5.94));
    const g = 0.032 + x * (2.07 + x * (-3.46 + x * 2.36));
    const b = 1.14 + x * (-3.63 + x * (8.14 + x * -5.49));
    return [
      Math.max(0, Math.min(255, r * 255)) | 0,
      Math.max(0, Math.min(255, g * 255)) | 0,
      Math.max(0, Math.min(255, b * 255)) | 0,
    ];
  },

  grayscale(t) {
    const v = (clamp01(t) * 255) | 0;
    return [v, v, v];
  },
};

/**
 * Раскрашивает карту диспаратности в RGBA.
 * @param {Float32Array} disparity
 * @param {string} name ключ COLORMAPS
 * @param {number} invert инвертировать (ближе = темнее)
 */
export function colorizeDisparity(disparity, width, height, name = 'turbo', invert = false) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const colorFn = COLORMAPS[name] ?? COLORMAPS.turbo;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < disparity.length; i += 1) {
    const d = disparity[i];
    if (d <= 0) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }
  const range = max - min || 1;

  let valid = 0;
  for (let i = 0; i < disparity.length; i += 1) {
    const p = i * 4;
    const d = disparity[i];
    if (d <= 0) {
      // Нет данных — нейтральный тёмный фон.
      rgba[p] = 18;
      rgba[p + 1] = 22;
      rgba[p + 2] = 32;
      rgba[p + 3] = 255;
      continue;
    }
    valid += 1;
    let t = (d - min) / range;
    if (invert) t = 1 - t;
    const [r, g, b] = colorFn(t);
    rgba[p] = r;
    rgba[p + 1] = g;
    rgba[p + 2] = b;
    rgba[p + 3] = 255;
  }

  return { rgba, min, max, valid, total: disparity.length };
}

/* ============================================================
 * Экспорт
 * ========================================================== */

/** Облако точек → ASCII PLY с цветами. */
export function toPLY(positions, colors) {
  const count = positions.length / 3;
  const header = [
    'ply',
    'format ascii 1.0',
    'comment generated by jsttst stereo depth estimator',
    `element vertex ${count}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
  ].join('\n');

  const lines = [header];
  for (let i = 0; i < count; i += 1) {
    const p = i * 3;
    const r = colors[p] ?? 200;
    const g = colors[p + 1] ?? 200;
    const b = colors[p + 2] ?? 200;
    lines.push(
      `${positions[p].toFixed(5)} ${positions[p + 1].toFixed(5)} ${positions[p + 2].toFixed(5)} ${r} ${g} ${b}`,
    );
  }
  return lines.join('\n');
}

/** Карта высот → OBJ-меш с текстурными координатами. */
export function toOBJ(disparity, width, height, options = {}) {
  const { maxGrid = 180, heightScale = 1 } = options;
  const stepX = Math.max(1, Math.ceil(width / maxGrid));
  const stepY = Math.max(1, Math.ceil(height / maxGrid));

  const cols = Math.floor((width - 1) / stepX) + 1;
  const rows = Math.floor((height - 1) / stepY) + 1;

  let maxD = 0;
  for (let i = 0; i < disparity.length; i += 1) {
    if (disparity[i] > maxD) maxD = disparity[i];
  }
  if (maxD <= 0) maxD = 1;

  const vertices = [];
  const uvs = [];
  const faces = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = Math.min(col * stepX, width - 1);
      const y = Math.min(row * stepY, height - 1);
      const d = disparity[y * width + x];

      vertices.push(
        (x / width - 0.5).toFixed(5),
        (-(y / height) + 0.5).toFixed(5),
        ((d > 0 ? d / maxD : 0) * heightScale).toFixed(5),
      );
      uvs.push((x / (width - 1 || 1)).toFixed(5), (1 - y / (height - 1 || 1)).toFixed(5));
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = row * cols + col + 1;
      const b = a + 1;
      const c = (row + 1) * cols + col + 1;
      const d = c + 1;
      faces.push(`f ${a}/${a} ${c}/${c} ${d}/${d}`);
      faces.push(`f ${a}/${a} ${d}/${d} ${b}/${b}`);
    }
  }

  const lines = ['# jsttst stereo depth — 3D model', `# vertices: ${vertices.length / 3}`];
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(`v ${vertices[i]} ${vertices[i + 1]} ${vertices[i + 2]}`);
  }
  for (let i = 0; i < uvs.length; i += 2) {
    lines.push(`vt ${uvs[i]} ${uvs[i + 1]}`);
  }
  lines.push(...faces);

  return lines.join('\n');
}

/** Статистика по карте диспаратности. */
export function disparityStats(disparity, width, height) {
  let valid = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  for (let i = 0; i < disparity.length; i += 1) {
    const d = disparity[i];
    if (d <= 0) continue;
    valid += 1;
    sum += d;
    if (d < min) min = d;
    if (d > max) max = d;
  }

  const total = width * height;
  return {
    valid,
    total,
    coverage: total > 0 ? valid / total : 0,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    mean: valid > 0 ? sum / valid : 0,
  };
}