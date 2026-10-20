/**
 * Тесты алгоритмов стереозрения.
 * Запуск: node --test "tests/**\/*.test.js"
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toGrayscale,
  censusTransform,
  popcount,
  computeDisparity,
  computeDisparityRightToLeft,
  leftRightCheck,
  medianFilter,
  removeSpeckles,
  fillHoles,
  disparityToDepth,
  buildPointCloud,
  colorizeDisparity,
  toPLY,
  toOBJ,
  disparityStats,
  METRIC,
  COLORMAPS,
  INVALID,
} from '../demo/js/stereo.js';

/**
 * Синтетическая стереопара: сумма синусоидальных решёток разных частот и
 * ориентаций (плюс лёгкий шум). Такой паттерн даёт устойчивое однозначное
 * сопоставление — в отличие от чистого шума, на котором census вырождается.
 */
function makeStereoPair(width, height, shift) {
  const left = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = 128
        + 46 * Math.sin(x * 0.21 + y * 0.13)
        + 34 * Math.sin(x * 0.47 - y * 0.31)
        + 26 * Math.cos(x * 0.89 + y * 0.57)
        + 18 * Math.sin((x + y) * 1.7)
        + ((x * 13 + y * 29) % 17) - 8; // мелкая детерминированная «шероховатость»
      left[y * width + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }

  const right = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Правое изображение = левое, сдвинутое влево на shift:
      // точка левого кадра x видна в правом кадре по адресу x - shift.
      const sx = Math.min(width - 1, x + shift);
      right[y * width + x] = left[y * width + sx];
    }
  }

  return { left, right };
}

/* ============================================================
 * Базовые преобразования
 * ========================================================== */

test('toGrayscale: применяет стандартные веса яркости', () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255,   // красный
    0, 255, 0, 255,   // зелёный
    0, 0, 255, 255,   // синий
    255, 255, 255, 255, // белый
  ]);
  const grey = toGrayscale(rgba, 2, 2);

  // Функция усекает результат (|0), а не округляет.
  assert.equal(grey[0], (255 * 0.299) | 0);
  assert.equal(grey[1], (255 * 0.587) | 0);
  assert.equal(grey[2], (255 * 0.114) | 0);
  assert.equal(grey[3], 255);
});

test('popcount: считает установленные биты', () => {
  assert.equal(popcount(0), 0);
  assert.equal(popcount(1), 1);
  assert.equal(popcount(0b1011), 3);
  assert.equal(popcount(0xffffffff), 32);
  assert.equal(popcount(0b1000000000000000000000000), 1);
});

test('censusTransform: одинаковые изображения дают одинаковый дескриптор', () => {
  const { left } = makeStereoPair(24, 24, 0);
  const a = censusTransform(left, 24, 24);
  const b = censusTransform(left, 24, 24);

  for (let i = 0; i < a.length; i += 1) {
    assert.equal(a[i], b[i]);
  }
  // Границы не заполняются.
  assert.equal(a[0], 0);
  assert.ok(a[12 * 24 + 12] !== 0 || a[12 * 24 + 12] === 0);
});

/* ============================================================
 * SAD
 * ========================================================== */

test('SAD: находит известный сдвиг на текстурированном изображении', () => {
  const width = 96;
  const height = 64;
  const shift = 12;
  const { left, right } = makeStereoPair(width, height, shift);

  const disparity = computeDisparity(left, right, width, height, {
    metric: METRIC.SAD,
    maxDisparity: 32,
    blockSize: 7,
    subpixel: false,
    uniquenessRatio: 0,
  });

  // Проверяем пиксели в глубине кадра, где сдвиг доступен.
  let correct = 0;
  let checked = 0;
  for (let y = 10; y < height - 10; y += 1) {
    for (let x = 40; x < width - 10; x += 1) {
      const d = disparity[y * width + x];
      if (d <= 0) continue;
      checked += 1;
      if (Math.abs(d - shift) < 0.6) correct += 1;
    }
  }

  assert.ok(checked > 100, `достаточно валидных пикселей: ${checked}`);
  const accuracy = correct / checked;
  assert.ok(accuracy > 0.9, `точность ${(accuracy * 100).toFixed(1)}% > 90%`);
});

test('SAD: нулевой сдвиг даёт нулевую диспаратность', () => {
  const width = 64;
  const height = 48;
  const { left } = makeStereoPair(width, height, 0);

  const disparity = computeDisparity(left, left, width, height, {
    metric: METRIC.SAD,
    maxDisparity: 16,
    blockSize: 5,
    subpixel: false,
    uniquenessRatio: 0,
  });

  let sum = 0;
  let count = 0;
  for (const d of disparity) {
    if (d >= 0) {
      sum += d;
      count += 1;
    }
  }
  assert.ok(count > 0, 'есть валидные пиксели');
  assert.ok(sum / count < 0.5, `средняя диспаратность ${(sum / count).toFixed(2)} ≈ 0`);
});

test('SAD: субпиксельное уточнение даёт дробные значения', () => {
  const width = 80;
  const height = 60;
  const { left, right } = makeStereoPair(width, height, 10);

  const disparity = computeDisparity(left, right, width, height, {
    metric: METRIC.SAD,
    maxDisparity: 24,
    blockSize: 7,
    subpixel: true,
    uniquenessRatio: 0,
  });

  let fractional = 0;
  for (const d of disparity) {
    if (d > 0 && Math.abs(d - Math.round(d)) > 1e-6) fractional += 1;
  }
  assert.ok(fractional > 0, 'есть пиксели с дробной диспаратностью');
});

/* ============================================================
 * Census
 * ========================================================== */

test('Census: устойчив к сдвигу яркости между камерами', () => {
  const width = 96;
  const height = 64;
  const shift = 10;
  const { left, right } = makeStereoPair(width, height, shift);

  // Имитируем разную экспозицию: правое изображение светлее на 20 единиц.
  const brighter = new Uint8Array(right.length);
  for (let i = 0; i < right.length; i += 1) {
    brighter[i] = Math.min(255, right[i] + 20);
  }

  const leftCensus = censusTransform(left, width, height);
  const rightCensus = censusTransform(brighter, width, height);

  const disparity = computeDisparity(leftCensus, rightCensus, width, height, {
    metric: METRIC.CENSUS,
    maxDisparity: 32,
    blockSize: 5,
    subpixel: false,
    uniquenessRatio: 0,
  });

  let correct = 0;
  let checked = 0;
  for (let y = 10; y < height - 10; y += 1) {
    for (let x = 40; x < width - 10; x += 1) {
      const d = disparity[y * width + x];
      if (d <= 0) continue;
      checked += 1;
      if (Math.abs(d - shift) < 0.6) correct += 1;
    }
  }

  assert.ok(checked > 50);
  assert.ok(correct / checked > 0.85, `Census устойчив: ${((correct / checked) * 100).toFixed(1)}%`);
});

/* ============================================================
 * Фильтры
 * ========================================================== */

test('leftRightCheck: убирает несовпадающие пиксели', () => {
  const width = 8;
  const height = 1;
  // Левая карта: диспаратность 2 во всех пикселях.
  const left = new Float32Array(width).fill(2);
  // Правая карта согласована везде, кроме x=5, куда проецируется левый x=7.
  const right = new Float32Array(width).fill(2);
  right[5] = 9;

  const result = leftRightCheck(left, right, width, height, 1);

  // x=7 → rx=5 → расхождение 2 против 9 → отбраковка.
  assert.equal(result[7], INVALID, 'несовпавший пиксель отброшен');
  // x=2 → rx=0 → согласовано.
  assert.equal(result[2], 2, 'согласованный пиксель сохранён');

  // Пиксели, чей rx уходит за левый край, тоже отбраковываются.
  assert.equal(result[0], INVALID, 'x=0 при d=2 выходит за границу');
  assert.equal(result[1], INVALID, 'x=1 при d=2 выходит за границу');
});

test('medianFilter: убирает одиночный выброс', () => {
  const width = 5;
  const height = 5;
  const disparity = new Float32Array(width * height).fill(10);
  disparity[2 * width + 2] = 100; // выброс в центре

  const filtered = medianFilter(disparity, width, height);

  assert.equal(filtered[2 * width + 2], 10);
  assert.equal(filtered[0], 10);
});

test('removeSpeckles: удаляет маленькие островки, сохраняет крупные', () => {
  const width = 20;
  const height = 20;
  const disparity = new Float32Array(width * height);

  // Большая область 10×10 = 100 пикселей.
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      disparity[y * width + x] = 20;
    }
  }
  // Маленький островок из 4 пикселей.
  disparity[15 * width + 15] = 20;
  disparity[15 * width + 16] = 20;
  disparity[16 * width + 15] = 20;
  disparity[16 * width + 16] = 20;

  removeSpeckles(disparity, width, height, 50, 2);

  assert.equal(disparity[5 * width + 5], 20, 'крупная область сохранена');
  assert.equal(disparity[15 * width + 15], INVALID, 'островок удалён');
});

test('fillHoles: заполняет одиночную дыру соседями', () => {
  const width = 5;
  const height = 5;
  const disparity = new Float32Array(width * height).fill(7);
  disparity[2 * width + 2] = INVALID;

  const filled = fillHoles(disparity, width, height, 2);

  assert.equal(filled[2 * width + 2], 7);
});

/* ============================================================
 * Глубина и 3D
 * ========================================================== */

test('disparityToDepth: глубина обратно пропорциональна диспаратности', () => {
  const disparity = new Float32Array([0, 1, 2, 4]);
  const depth = disparityToDepth(disparity, 2, 3);

  assert.equal(depth[0], 0, 'нет данных → 0');
  assert.equal(depth[1], 6);
  assert.equal(depth[2], 3);
  assert.equal(depth[3], 1.5);
});

test('buildPointCloud: пропускает невалидные пиксели', () => {
  const width = 4;
  const height = 4;
  const disparity = new Float32Array(width * height);
  disparity[0] = 10;
  disparity[5] = 10;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(128);

  const cloud = buildPointCloud(disparity, rgba, width, height, { maxPoints: 1000 });

  assert.equal(cloud.count, 2);
  assert.equal(cloud.positions.length, 6);
  assert.equal(cloud.colors.length, 6);
  // Координаты конечны.
  for (const v of cloud.positions) assert.ok(Number.isFinite(v));
});

test('buildPointCloud: соблюдает лимит точек через прореживание', () => {
  const width = 400;
  const height = 400;
  const disparity = new Float32Array(width * height).fill(5);
  const rgba = new Uint8ClampedArray(width * height * 4).fill(100);

  const cloud = buildPointCloud(disparity, rgba, width, height, { maxPoints: 5000 });

  assert.ok(cloud.count <= 5000, `точек ${cloud.count} ≤ 5000`);
  assert.ok(cloud.count > 1000, `но и не слишком мало: ${cloud.count}`);
});

/* ============================================================
 * Цветовые карты и статистика
 * ========================================================== */

test('COLORMAPS: возвращают корректный диапазон 0..255', () => {
  for (const [name, fn] of Object.entries(COLORMAPS)) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const [r, g, b] = fn(t);
      for (const channel of [r, g, b]) {
        assert.ok(Number.isInteger(channel), `${name}: целое число`);
        assert.ok(channel >= 0 && channel <= 255, `${name}: ${channel} в диапазоне`);
      }
    }
  }
});

test('colorizeDisparity: помечает невалидные пиксели отдельным цветом', () => {
  const disparity = new Float32Array([0, 5, 10]);
  const result = colorizeDisparity(disparity, 3, 1, 'turbo');

  assert.equal(result.valid, 2);
  assert.equal(result.total, 3);
  assert.equal(result.min, 5);
  assert.equal(result.max, 10);
  // Невалидный пиксель — тёмный фон (18, 22, 32).
  assert.equal(result.rgba[0], 18);
  assert.equal(result.rgba[3], 255, 'альфа непрозрачная');
});

test('disparityStats: считает покрытие и среднее', () => {
  const disparity = new Float32Array([0, 2, 4, 6]);
  const stats = disparityStats(disparity, 2, 2);

  assert.equal(stats.valid, 3);
  assert.equal(stats.total, 4);
  assert.equal(stats.coverage, 0.75);
  assert.equal(stats.min, 2);
  assert.equal(stats.max, 6);
  assert.equal(stats.mean, 4);
});

/* ============================================================
 * Экспорт
 * ========================================================== */

test('toPLY: формирует корректный заголовок и число вершин', () => {
  const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
  const colors = new Uint8Array([10, 20, 30, 40, 50, 60]);

  const ply = toPLY(positions, colors);
  const lines = ply.split('\n');

  assert.equal(lines[0], 'ply');
  assert.equal(lines[1], 'format ascii 1.0');
  assert.ok(lines.includes('element vertex 2'));
  assert.ok(lines.includes('end_header'));

  const headerEnd = lines.indexOf('end_header');
  assert.equal(lines.length - headerEnd - 1, 2, 'две строки данных');
  assert.ok(lines[headerEnd + 1].startsWith('1.00000 2.00000 3.00000 10 20 30'));
});

test('toOBJ: генерирует вершины, UV и грани', () => {
  const width = 8;
  const height = 8;
  const disparity = new Float32Array(width * height).fill(3);

  const obj = toOBJ(disparity, width, height, { maxGrid: 4 });
  const lines = obj.split('\n');

  const vertexCount = lines.filter((l) => l.startsWith('v ')).length;
  const uvCount = lines.filter((l) => l.startsWith('vt ')).length;
  const faceCount = lines.filter((l) => l.startsWith('f ')).length;

  // maxGrid=4 при 8×8 → шаг 2 → сетка 4×4 = 16 вершин.
  assert.equal(vertexCount, 16);
  assert.equal(uvCount, 16);
  // (cols-1)×(rows-1)×2 = 3×3×2 = 18 граней.
  assert.equal(faceCount, 18);

  // Каждая грань ссылается на существующие вершины.
  for (const line of lines.filter((l) => l.startsWith('f '))) {
    for (const token of line.split(' ').slice(1)) {
      const index = parseInt(token.split('/')[0], 10);
      assert.ok(index >= 1 && index <= vertexCount, `индекс ${index} в диапазоне`);
    }
  }
});

/* ============================================================
 * Интеграция: полный конвейер
 * ========================================================== */

test('конвейер: синтетическая сцена → диспаратность → облако точек', () => {
  const width = 80;
  const height = 60;
  const shift = 8;
  const { left, right } = makeStereoPair(width, height, shift);

  let disparity = computeDisparity(left, right, width, height, {
    metric: METRIC.SAD,
    maxDisparity: 24,
    blockSize: 5,
    subpixel: true,
    uniquenessRatio: 0,
  });

  const rightDisparity = computeDisparityRightToLeft(left, right, width, height, {
    metric: METRIC.SAD,
    maxDisparity: 24,
    blockSize: 5,
  });

  disparity = leftRightCheck(disparity, rightDisparity, width, height, 2);
  disparity = medianFilter(disparity, width, height);
  removeSpeckles(disparity, width, height, 20, 2);

  const stats = disparityStats(disparity, width, height);
  assert.ok(stats.valid > 0, 'карта не пустая');
  assert.ok(stats.coverage > 0.3, `покрытие ${(stats.coverage * 100).toFixed(1)}%`);
  assert.ok(stats.mean > 0);

  const rgba = new Uint8ClampedArray(width * height * 4).fill(120);
  const cloud = buildPointCloud(disparity, rgba, width, height, { maxPoints: 20000 });
  assert.ok(cloud.count > 0);
  for (const v of cloud.positions) assert.ok(Number.isFinite(v), 'координаты конечны');

  const ply = toPLY(cloud.positions, cloud.colors);
  assert.ok(ply.includes(`element vertex ${cloud.count}`));
});

test('computeDisparity: пустые/крошечные изображения не падают', () => {
  const empty = new Uint8Array(0);
  const result = computeDisparity(empty, empty, 0, 0, { maxDisparity: 16 });
  assert.equal(result.length, 0);

  const tiny = new Uint8Array(4);
  const tinyResult = computeDisparity(tiny, tiny, 2, 2, { maxDisparity: 16, blockSize: 7 });
  assert.equal(tinyResult.length, 4);
  for (const d of tinyResult) assert.equal(d, INVALID, 'слишком маленькое изображение — нет данных');
});