/**
 * solver.js — последовательный импульсный решатель (Sequential Impulses).
 *
 * Три фазы:
 *   1. warmStart  — применяем импульсы прошлого шага (быстрые стабильные стопки);
 *   2. solveVelocity — итерации по нормали и касательной с накоплением;
 *   3. solvePosition — мягкая позиционная коррекция по локальным якорям.
 */

const POSITION_SLOP = 0.5;      // допуск проникновения, px
const POSITION_PERCENT = 0.35;  // доля исправления за итерацию
const MAX_LINEAR_CORRECTION = 40;

/**
 * Применяет кэшированные импульсы и прогревает контакт.
 * @param {import('./contact.js').Contact[]} contacts
 * @param {Map<string, {n:number,t:number}>} cache
 */
export function warmStart(contacts, cache) {
  for (const contact of contacts) {
    const { a, b, normal, tangent } = contact;

    for (let i = 0; i < contact.points.length; i += 1) {
      const p = contact.points[i];
      const cached = cache.get(contact.cacheKey(i));
      if (!cached) continue;

      p.normalImpulse = cached.n;
      p.tangentImpulse = cached.t;

      const ix = normal.x * cached.n + tangent.x * cached.t;
      const iy = normal.y * cached.n + tangent.y * cached.t;

      if (!a.isStatic) {
        a.velocity.x -= ix * a.invMass;
        a.velocity.y -= iy * a.invMass;
        a.angularVelocity -= a.invInertia * (p.rAx * iy - p.rAy * ix);
      }
      if (!b.isStatic) {
        b.velocity.x += ix * b.invMass;
        b.velocity.y += iy * b.invMass;
        b.angularVelocity += b.invInertia * (p.rBx * iy - p.rBy * ix);
      }
    }
  }
}

/**
 * Итерации по скоростям.
 * @param {import('./contact.js').Contact[]} contacts
 * @param {number} iterations
 */
export function solveVelocity(contacts, iterations) {
  for (let iter = 0; iter < iterations; iter += 1) {
    for (const contact of contacts) {
      const { a, b, normal, tangent } = contact;

      for (const p of contact.points) {
        /* ---- нормаль ---- */
        let vax = a.velocity.x - a.angularVelocity * p.rAy;
        let vay = a.velocity.y + a.angularVelocity * p.rAx;
        let vbx = b.velocity.x - b.angularVelocity * p.rBy;
        let vby = b.velocity.y + b.angularVelocity * p.rBx;

        let vn = (vbx - vax) * normal.x + (vby - vay) * normal.y;
        let lambda = (p.velocityBias - vn) * p.normalMass;

        const oldN = p.normalImpulse;
        p.normalImpulse = Math.max(oldN + lambda, 0);
        lambda = p.normalImpulse - oldN;

        const ix = normal.x * lambda;
        const iy = normal.y * lambda;

        if (!a.isStatic) {
          a.velocity.x -= ix * a.invMass;
          a.velocity.y -= iy * a.invMass;
          a.angularVelocity -= a.invInertia * (p.rAx * iy - p.rAy * ix);
        }
        if (!b.isStatic) {
          b.velocity.x += ix * b.invMass;
          b.velocity.y += iy * b.invMass;
          b.angularVelocity += b.invInertia * (p.rBx * iy - p.rBy * ix);
        }

        /* ---- касательная (трение Кулона) ---- */
        vax = a.velocity.x - a.angularVelocity * p.rAy;
        vay = a.velocity.y + a.angularVelocity * p.rAx;
        vbx = b.velocity.x - b.angularVelocity * p.rBy;
        vby = b.velocity.y + b.angularVelocity * p.rBx;

        const vt = (vbx - vax) * tangent.x + (vby - vay) * tangent.y;
        let lambdaT = -vt * p.tangentMass;

        const maxFriction = contact.friction * p.normalImpulse;
        const oldT = p.tangentImpulse;
        p.tangentImpulse = Math.max(-maxFriction, Math.min(maxFriction, oldT + lambdaT));
        lambdaT = p.tangentImpulse - oldT;

        const tx = tangent.x * lambdaT;
        const ty = tangent.y * lambdaT;

        if (!a.isStatic) {
          a.velocity.x -= tx * a.invMass;
          a.velocity.y -= ty * a.invMass;
          a.angularVelocity -= a.invInertia * (p.rAx * ty - p.rAy * tx);
        }
        if (!b.isStatic) {
          b.velocity.x += tx * b.invMass;
          b.velocity.y += ty * b.invMass;
          b.angularVelocity += b.invInertia * (p.rBx * ty - p.rBy * tx);
        }
      }
    }
  }
}

/**
 * Позиционная коррекция. Работает по локальным якорям, поэтому корректно
 * учитывает поворот тел за шаг.
 * @param {import('./contact.js').Contact[]} contacts
 * @param {number} iterations
 */
export function solvePosition(contacts, iterations) {
  for (let iter = 0; iter < iterations; iter += 1) {
    for (const contact of contacts) {
      const { a, b, normal } = contact;
      const invSum = a.invMass + b.invMass;
      if (invSum <= 0) continue;

      for (const p of contact.points) {
        const separation = contact.currentSeparation(p);
        const penetration = -separation;
        if (penetration <= POSITION_SLOP) continue;

        let correction = (penetration - POSITION_SLOP) * POSITION_PERCENT;
        if (correction > MAX_LINEAR_CORRECTION) correction = MAX_LINEAR_CORRECTION;

        const cx = normal.x * correction;
        const cy = normal.y * correction;

        if (!a.isStatic) {
          a.position.x -= cx * (a.invMass / invSum);
          a.position.y -= cy * (a.invMass / invSum);
        }
        if (!b.isStatic) {
          b.position.x += cx * (b.invMass / invSum);
          b.position.y += cy * (b.invMass / invSum);
        }
      }
    }
  }
}

/** Сохраняет накопленные импульсы для следующего шага. */
export function storeImpulses(contacts, cache) {
  for (const contact of contacts) {
    for (let i = 0; i < contact.points.length; i += 1) {
      const p = contact.points[i];
      cache.set(contact.cacheKey(i), { n: p.normalImpulse, t: p.tangentImpulse });
    }
  }
}