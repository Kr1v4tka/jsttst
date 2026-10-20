/**
 * collider.js — узкая фаза: строит манифолды контактов для пар тел.
 *
 * Поддерживаются три комбинации:
 *   • круг × круг
 *   • полигон × полигон (SAT + клиппинг опорной грани)
 *   • круг × полигон
 *
 * Нормаль контакта всегда направлена от `a` к `b`.
 */

import { Vec2 } from './vec2.js';
import { BODY_KIND } from './body.js';

/** Допуск выбора опорной грани — чтобы не «прыгала» на почти равных рёбрах. */
const FACE_TOLERANCE = 5e-4;
/** Точки глубже этого значения считаются контактом (спекулятивный допуск). */
const CONTACT_SLOP = 0.02;

/* ============================================================
 * Круг × круг
 * ========================================================== */

function collideCircleCircle(a, b) {
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const radiusSum = a.radius + b.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq > radiusSum * radiusSum) return null;

  const dist = Math.sqrt(distSq);
  let nx;
  let ny;
  if (dist > 1e-6) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    // Центры совпали — расталкиваем по произвольной оси.
    nx = 1;
    ny = 0;
  }

  const penetration = radiusSum - dist;
  const px = a.position.x + nx * a.radius;
  const py = a.position.y + ny * a.radius;

  return {
    normal: new Vec2(nx, ny),
    points: [{ x: px, y: py, penetration, featureId: 0 }],
  };
}

/* ============================================================
 * Полигон × полигон
 * ========================================================== */

/** Максимальное разделение граней A относительно B и индекс этой грани. */
function findMaxSeparation(a, b) {
  let bestSep = -Infinity;
  let bestIndex = 0;
  const normals = a.worldNormals;
  const vertices = a.worldVertices;

  for (let i = 0; i < normals.length; i += 1) {
    const n = normals[i];
    const v = vertices[i];

    // Опорная точка B в направлении -n.
    let minDot = Infinity;
    for (let j = 0; j < b.worldVertices.length; j += 1) {
      const w = b.worldVertices[j];
      const dot = w.x * n.x + w.y * n.y;
      if (dot < minDot) minDot = dot;
    }

    const sep = minDot - (v.x * n.x + v.y * n.y);
    if (sep > bestSep) {
      bestSep = sep;
      bestIndex = i;
    }
  }

  return { separation: bestSep, index: bestIndex };
}

/**
 * Отсекает отрезок плоскостью: оставляет часть, где dot(n, p) <= offset.
 * @returns {Array<{x:number,y:number}>} 0, 1 или 2 точки
 */
function clipSegment(points, nx, ny, offset) {
  if (points.length < 2) return points;
  const [p1, p2] = points;
  const d1 = nx * p1.x + ny * p1.y - offset;
  const d2 = nx * p2.x + ny * p2.y - offset;
  const out = [];

  if (d1 <= 0) out.push(p1);
  if (d2 <= 0) out.push(p2);

  if (d1 * d2 < 0) {
    const t = d1 / (d1 - d2);
    out.push({
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t,
    });
  }

  return out.slice(0, 2);
}

function collidePolygonPolygon(a, b) {
  const sepA = findMaxSeparation(a, b);
  if (sepA.separation > CONTACT_SLOP) return null;

  const sepB = findMaxSeparation(b, a);
  if (sepB.separation > CONTACT_SLOP) return null;

  // Выбираем опорную грань: она даёт наибольшее разделение.
  let ref;
  let inc;
  let refIndex;
  let flip;
  if (sepA.separation >= sepB.separation - FACE_TOLERANCE) {
    ref = a;
    inc = b;
    refIndex = sepA.index;
    flip = false;
  } else {
    ref = b;
    inc = a;
    refIndex = sepB.index;
    flip = true;
  }

  const refNormal = ref.worldNormals[refIndex];
  const refCount = ref.worldVertices.length;
  const v1 = ref.worldVertices[refIndex];
  const v2 = ref.worldVertices[(refIndex + 1) % refCount];

  // Инцидентная грань — та, чья нормаль наиболее антипараллельна опорной.
  let incIndex = 0;
  let minDot = Infinity;
  for (let i = 0; i < inc.worldNormals.length; i += 1) {
    const dot = inc.worldNormals[i].dot(refNormal);
    if (dot < minDot) {
      minDot = dot;
      incIndex = i;
    }
  }

  const incCount = inc.worldVertices.length;
  const i1 = inc.worldVertices[incIndex];
  const i2 = inc.worldVertices[(incIndex + 1) % incCount];
  let clipped = [
    { x: i1.x, y: i1.y },
    { x: i2.x, y: i2.y },
  ];

  // Боковые плоскости опорной грани.
  const tx = v2.x - v1.x;
  const ty = v2.y - v1.y;
  const tLen = Math.hypot(tx, ty);
  if (tLen < 1e-9) return null;
  const tangentX = tx / tLen;
  const tangentY = ty / tLen;

  // Оставляем точки, лежащие «между» v1 и v2 по касательной.
  clipped = clipSegment(clipped, -tangentX, -tangentY, -(tangentX * v1.x + tangentY * v1.y));
  if (clipped.length === 0) return null;
  clipped = clipSegment(clipped, tangentX, tangentY, tangentX * v2.x + tangentY * v2.y);
  if (clipped.length === 0) return null;

  const normal = flip ? refNormal.times(-1) : refNormal.clone();
  const points = [];
  const refOffset = refNormal.x * v1.x + refNormal.y * v1.y;

  for (let k = 0; k < clipped.length; k += 1) {
    const p = clipped[k];
    const separation = refNormal.x * p.x + refNormal.y * p.y - refOffset;
    if (separation > CONTACT_SLOP) continue;
    points.push({
      x: p.x,
      y: p.y,
      penetration: Math.max(-separation, 0),
      featureId: (flip ? 10000 : 0) + refIndex * 100 + k,
    });
  }

  if (points.length === 0) return null;
  return { normal, points };
}

/* ============================================================
 * Круг × полигон
 * ========================================================== */

function collideCirclePolygon(circle, polygon) {
  // Работаем в локальной системе полигона — так проще и точнее.
  const local = polygon.toLocal(circle.position);
  const normals = polygon.localNormals;
  const vertices = polygon.localVertices;

  let bestSep = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < normals.length; i += 1) {
    const n = normals[i];
    const v = vertices[i];
    const sep = local.x * n.x + local.y * n.y - (v.x * n.x + v.y * n.y);
    if (sep > bestSep) {
      bestSep = sep;
      bestIndex = i;
    }
  }

  // Центр снаружи и дальше радиуса — контакта нет.
  if (bestSep > circle.radius + CONTACT_SLOP) return null;

  const count = vertices.length;
  const v1 = vertices[bestIndex];
  const v2 = vertices[(bestIndex + 1) % count];

  let closestLocal;
  let normalLocal;
  let penetration;

  if (bestSep < 0) {
    // Центр круга внутри полигона — выталкиваем по нормали ближайшей грани.
    normalLocal = normals[bestIndex].clone();
    closestLocal = local.clone();
    penetration = circle.radius - bestSep;
  } else {
    const ex = v2.x - v1.x;
    const ey = v2.y - v1.y;
    const edgeLenSq = ex * ex + ey * ey;
    let t = 0;
    if (edgeLenSq > 1e-12) {
      t = ((local.x - v1.x) * ex + (local.y - v1.y) * ey) / edgeLenSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    closestLocal = new Vec2(v1.x + ex * t, v1.y + ey * t);

    const dx = local.x - closestLocal.x;
    const dy = local.y - closestLocal.y;
    const dist = Math.hypot(dx, dy);
    if (dist > circle.radius + CONTACT_SLOP) return null;

    if (dist > 1e-6) {
      normalLocal = new Vec2(dx / dist, dy / dist);
      penetration = circle.radius - dist;
    } else {
      normalLocal = normals[bestIndex].clone();
      penetration = circle.radius;
    }
  }

  const worldPoint = polygon.toWorld(closestLocal);
  // Нормаль полигон → круг.
  const polyToCircle = polygon.rotateVector(normalLocal);

  return {
    normal: polyToCircle.times(-1), // от круга к полигону
    points: [{
      x: worldPoint.x,
      y: worldPoint.y,
      penetration: Math.max(penetration, 0),
      featureId: 20000 + bestIndex,
    }],
  };
}

/* ============================================================
 * Публичный API
 * ========================================================== */

/**
 * Строит контакт для пары тел.
 * @param {import('./body.js').RigidBody} a
 * @param {import('./body.js').RigidBody} b
 * @returns {{normal: Vec2, points: Array}|null} нормаль направлена от a к b
 */
export function collide(a, b) {
  if (a.isStatic && b.isStatic) return null;

  const aIsCircle = a.kind === BODY_KIND.CIRCLE;
  const bIsCircle = b.kind === BODY_KIND.CIRCLE;

  if (aIsCircle && bIsCircle) return collideCircleCircle(a, b);
  if (!aIsCircle && !bIsCircle) return collidePolygonPolygon(a, b);
  if (aIsCircle) return collideCirclePolygon(a, b);

  // b — круг, a — полигон: считаем как (круг, полигон) и разворачиваем нормаль.
  const result = collideCirclePolygon(b, a);
  if (!result) return null;
  result.normal.negate();
  return result;
}

/** Быстрая проверка пересечения AABB. */
export function aabbOverlap(a, b) {
  return !(
    a.maxX < b.minX
    || a.minX > b.maxX
    || a.maxY < b.minY
    || a.minY > b.maxY
  );
}