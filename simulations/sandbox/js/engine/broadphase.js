/**
 * broadphase.js — uniform spatial hash для поиска пар-кандидатов.
 *
 * Тела вставляются в ячейки по своему AABB; пара считается один раз благодаря
 * паре ключей `idA:idB`. Сетка пересоздаётся каждый шаг — это дешевле, чем
 * инкрементальное обслуживание при активном движении.
 */

import { aabbOverlap } from './collider.js';

export class SpatialHash {
  /**
   * @param {number} cellSize размер ячейки в пикселях
   */
  constructor(cellSize = 96) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.stamp = 0;
  }

  clear() {
    this.cells.clear();
    this.stamp = 0;
  }

  _key(cx, cy) {
    // Упаковка двух int32 в один строковый ключ — быстрее конкатенации.
    return `${cx},${cy}`;
  }

  /** @param {import('./body.js').RigidBody[]} bodies */
  rebuild(bodies) {
    this.cells.clear();
    this.stamp += 1;
    const size = this.cellSize;

    for (const body of bodies) {
      const b = body.aabb;
      const minX = Math.floor(b.minX / size);
      const maxX = Math.floor(b.maxX / size);
      const minY = Math.floor(b.minY / size);
      const maxY = Math.floor(b.maxY / size);

      for (let cx = minX; cx <= maxX; cx += 1) {
        for (let cy = minY; cy <= maxY; cy += 1) {
          const key = this._key(cx, cy);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(body);
        }
      }
    }
  }

  /**
   * Возвращает пары тел, чьи AABB пересекаются.
   * @param {import('./body.js').RigidBody[]} bodies
   * @param {Array<[object, object]>} out переиспользуемый массив
   */
  queryPairs(bodies, out = []) {
    out.length = 0;
    const seen = new Set();

    for (const bucket of this.cells.values()) {
      const len = bucket.length;
      for (let i = 0; i < len; i += 1) {
        const a = bucket[i];
        for (let j = i + 1; j < len; j += 1) {
          const b = bucket[j];
          if (a.isStatic && b.isStatic) continue;
          // Спящее тело просыпается только при контакте с движущимся.
          if (a.isSleeping && b.isSleeping) continue;

          const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
          if (seen.has(key)) continue;
          seen.add(key);

          if (!aabbOverlap(a.aabb, b.aabb)) continue;
          out.push([a, b]);
        }
      }
    }

    return out;
  }
}