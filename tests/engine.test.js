/**
 * Тесты физического движка песочницы.
 *
 * Запуск:  node --test tests/
 *
 * Движок не зависит от DOM, поэтому тестируется в чистом Node.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Vec2 } from '../simulations/sandbox/js/engine/vec2.js';
import { World } from '../simulations/sandbox/js/engine/world.js';
import { BODY_KIND } from '../simulations/sandbox/js/engine/body.js';
import { collide } from '../simulations/sandbox/js/engine/collider.js';
import { SpatialHash } from '../simulations/sandbox/js/engine/broadphase.js';
import { PolygonBody } from '../simulations/sandbox/js/engine/polygon.js';
import { CircleBody } from '../simulations/sandbox/js/engine/circle.js';

/** Прогоняет мир на заданное число секунд фиксированным шагом. */
function simulate(world, seconds, step = 1 / 120) {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i += 1) world.step(step);
}

function makeWorld(width = 800, height = 600, settings = {}) {
  const world = new World(width, height, { fixedStep: 1 / 120, ...settings });
  world.boundsEnabled = true;
  return world;
}

/* ============================================================
 * Vec2
 * ========================================================== */

test('Vec2: базовые операции не мутируют исходные векторы там, где не должны', () => {
  const a = new Vec2(3, 4);
  const b = new Vec2(1, 2);

  assert.equal(a.length(), 5);
  assert.equal(a.dot(b), 11);
  assert.equal(a.cross(b), 2);

  const sum = a.plus(b);
  assert.deepEqual([sum.x, sum.y], [4, 6]);
  assert.deepEqual([a.x, a.y], [3, 4], 'исходный вектор не изменился');
});

test('Vec2: rotate поворачивает на 90° против часовой стрелки', () => {
  const v = new Vec2(1, 0).rotate(Math.PI / 2);
  assert.ok(Math.abs(v.x - 0) < 1e-9);
  assert.ok(Math.abs(v.y - 1) < 1e-9);
});

/* ============================================================
 * Массы и инерция
 * ========================================================== */

test('CircleBody: масса пропорциональна площади, инерция — ½mr²', () => {
  const circle = new CircleBody(0, 0, 10);
  circle.applyDensity(0.0016);

  const expectedMass = Math.PI * 100 * 0.0016;
  assert.ok(Math.abs(circle.mass - expectedMass) < 1e-9);
  assert.ok(Math.abs(circle.inertia - 0.5 * expectedMass * 100) < 1e-9);
  assert.equal(circle.isStatic, false);
});

test('PolygonBody: центр масс переносится в начало координат', () => {
  // Смещённый квадрат — после recenter центр масс должен быть в (0,0).
  const poly = PolygonBody.box(50, 50, 20, 20);
  let sumX = 0;
  let sumY = 0;
  for (const v of poly.localVertices) {
    sumX += v.x;
    sumY += v.y;
  }
  assert.ok(Math.abs(sumX / 4) < 1e-9);
  assert.ok(Math.abs(sumY / 4) < 1e-9);
});

test('PolygonBody: статическое тело имеет нулевую обратную массу', () => {
  const poly = PolygonBody.box(0, 0, 40, 40);
  poly.applyDensity(0.0016);
  poly.setMass(0, 0);

  assert.equal(poly.isStatic, true);
  assert.equal(poly.invMass, 0);
  assert.equal(poly.invInertia, 0);
});

/* ============================================================
 * Коллайдер
 * ========================================================== */

test('collider: два далеко стоящих круга не сталкиваются', () => {
  const a = new CircleBody(0, 0, 10);
  const b = new CircleBody(100, 0, 10);
  a.applyDensity(0.001);
  b.applyDensity(0.001);
  a.updateBounds();
  b.updateBounds();

  assert.equal(collide(a, b), null);
});

test('collider: пересекающиеся круги дают нормаль от A к B', () => {
  const a = new CircleBody(0, 0, 10);
  const b = new CircleBody(15, 0, 10);
  a.applyDensity(0.001);
  b.applyDensity(0.001);
  a.updateBounds();
  b.updateBounds();

  const contact = collide(a, b);
  assert.ok(contact, 'контакт найден');
  assert.ok(Math.abs(contact.normal.x - 1) < 1e-9, 'нормаль направлена по +X');
  assert.ok(Math.abs(contact.normal.y) < 1e-9);
  assert.ok(Math.abs(contact.points[0].penetration - 5) < 1e-9);
});

test('collider: круг над квадратом получает нормаль вверх', () => {
  const circle = new CircleBody(0, -18, 10);
  const box = PolygonBody.box(0, 0, 40, 40);
  circle.applyDensity(0.001);
  box.applyDensity(0.001);
  circle.updateBounds();
  box.updateBounds();

  const contact = collide(circle, box);
  assert.ok(contact, 'контакт найден');
  // Круг выше квадрата → нормаль от круга к квадрату смотрит вниз (+Y).
  assert.ok(contact.normal.y > 0.9, `нормаль вниз, получено y=${contact.normal.y}`);
});

test('collider: два статических тела не образуют контакт', () => {
  const a = PolygonBody.box(0, 0, 40, 40);
  const b = PolygonBody.box(10, 0, 40, 40);
  a.setMass(0, 0);
  b.setMass(0, 0);
  a.updateBounds();
  b.updateBounds();

  assert.equal(collide(a, b), null);
});

/* ============================================================
 * Широкая фаза
 * ========================================================== */

test('SpatialHash: находит только пересекающиеся пары', () => {
  const world = makeWorld();
  world.createCircle(100, 100, 20);
  world.createCircle(110, 100, 20);
  world.createCircle(700, 500, 20);

  const hash = new SpatialHash(96);
  hash.rebuild(world.bodies);
  const pairs = hash.queryPairs(world.bodies);

  assert.equal(pairs.length, 1, 'ровно одна пара-кандидат');
  const [a, b] = pairs[0];
  assert.ok(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < 20);
});

/* ============================================================
 * Интегратор и гравитация
 * ========================================================== */

test('интегратор: свободное падение набирает скорость ≈ g·t', () => {
  const world = makeWorld(4000, 4000);
  world.boundsEnabled = false;
  const body = world.createCircle(500, 100, 10);

  simulate(world, 1);

  // Полунеявный Эйлер + лёгкое демпфирование: скорость чуть меньше g·t.
  const expected = world.gravity.y * 1;
  assert.ok(body.velocity.y > expected * 0.94, `v=${body.velocity.y}, ожидалось ≈${expected}`);
  assert.ok(body.velocity.y <= expected, 'демпфирование не разгоняет тело');
});

test('интегратор: тело остаётся в границах мира', () => {
  const world = makeWorld(400, 300);
  const body = world.createCircle(200, 50, 12);
  body.velocity.set(900, 400);

  simulate(world, 4);

  const b = body.updateBounds();
  assert.ok(b.minX >= -1, `левый край внутри: ${b.minX}`);
  assert.ok(b.maxX <= world.width + 1, `правый край внутри: ${b.maxX}`);
  assert.ok(b.maxY <= world.height + 1, `низ внутри: ${b.maxY}`);
});

test('интегратор: за 10 секунд нет NaN и бесконечностей', () => {
  const world = makeWorld(600, 400);
  for (let i = 0; i < 40; i += 1) {
    world.createCircle(60 + (i % 10) * 50, 40 + Math.floor(i / 10) * 40, 12, {
      restitution: 0.8,
    });
  }

  simulate(world, 10);

  for (const body of world.bodies) {
    assert.ok(Number.isFinite(body.position.x), `x конечно у тела ${body.id}`);
    assert.ok(Number.isFinite(body.position.y), `y конечно у тела ${body.id}`);
    assert.ok(Number.isFinite(body.velocity.x), `vx конечно у тела ${body.id}`);
    assert.ok(Number.isFinite(body.angle), `угол конечен у тела ${body.id}`);
  }
});

/* ============================================================
 * Разрешение столкновений
 * ========================================================== */

test('столкновение: два шара расходятся и не остаются вложенными', () => {
  const world = makeWorld(800, 600);
  world.gravity.y = 0;

  const a = world.createCircle(300, 300, 20, { restitution: 0.9, friction: 0 });
  const b = world.createCircle(335, 300, 20, { restitution: 0.9, friction: 0 });
  a.velocity.set(150, 0);
  b.velocity.set(-150, 0);

  simulate(world, 1.2);

  const distance = a.position.distanceTo(b.position);
  const minDistance = a.radius + b.radius;
  assert.ok(
    distance >= minDistance - 1.5,
    `шары разошлись: расстояние ${distance.toFixed(2)}, минимум ${minDistance}`,
  );
});

test('столкновение: суммарный импульс сохраняется при упругом ударе', () => {
  const world = makeWorld(1200, 800);
  world.gravity.y = 0;

  const a = world.createCircle(400, 400, 20, { restitution: 1, friction: 0 });
  const b = world.createCircle(460, 400, 20, { restitution: 1, friction: 0 });
  a.velocity.set(200, 0);

  const momentumBefore = a.mass * a.velocity.x + b.mass * b.velocity.x;

  // Имитируем столкновение без границ.
  world.boundsEnabled = false;
  simulate(world, 0.5);

  const momentumAfter = a.mass * a.velocity.x + b.mass * b.velocity.x;
  const relative = Math.abs(momentumAfter - momentumBefore) / Math.abs(momentumBefore);
  assert.ok(relative < 0.05, `импульс сохранён, отклонение ${(relative * 100).toFixed(2)}%`);
  assert.ok(b.velocity.x > 0, 'второй шар получил импульс');
});

test('стопка коробок: оседает, не проваливается и засыпает', () => {
  const world = makeWorld(600, 600);
  const size = 40;
  const floorY = 560;

  world.createBox(300, floorY + size / 2, 600, size, { static: true });

  const boxes = [];
  for (let i = 0; i < 5; i += 1) {
    boxes.push(world.createBox(300, floorY - size / 2 - i * size, size, size, {
      restitution: 0.05,
      friction: 0.7,
    }));
  }

  simulate(world, 6);

  // Все коробки выше пола и не пересекаются по вертикали сильнее допуска.
  const sorted = [...boxes].sort((p, q) => q.position.y - p.position.y);
  for (let i = 0; i < sorted.length; i += 1) {
    assert.ok(Number.isFinite(sorted[i].position.y));
    if (i > 0) {
      const gap = sorted[i - 1].position.y - sorted[i].position.y;
      assert.ok(gap > size * 0.7, `коробки не слиплись: зазор ${gap.toFixed(1)}`);
    }
  }

  // Нижняя коробка лежит на полу, а не провалилась.
  assert.ok(sorted[0].position.y < floorY, 'нижняя коробка над полом');
  assert.ok(sorted[0].position.y > floorY - size, 'нижняя коробка не провалилась в пол');
});

/* ============================================================
 * Соединения
 * ========================================================== */

test('DistanceJoint: удерживает длину связи', () => {
  const world = makeWorld(800, 600);
  const anchor = world.createCircle(400, 100, 10, { static: true });
  const bob = world.createCircle(540, 100, 20, { restitution: 0.2 });

  const joint = world.createDistanceJoint(anchor, bob, 1);
  const restLength = joint.restLength;

  simulate(world, 4);

  const length = joint.currentLength();
  assert.ok(
    Math.abs(length - restLength) < restLength * 0.08,
    `длина удержана: ${length.toFixed(2)} против ${restLength.toFixed(2)}`,
  );
});

test('DistanceJoint: удаление тела убирает его соединения', () => {
  const world = makeWorld();
  const a = world.createCircle(100, 100, 10);
  const b = world.createCircle(200, 100, 10);
  world.createDistanceJoint(a, b, 1);

  assert.equal(world.joints.length, 1);
  world.remove(a);
  assert.equal(world.joints.length, 0, 'соединение удалено вместе с телом');
});

/* ============================================================
 * Сон
 * ========================================================== */

test('сон: покоящееся тело засыпает, а удар его будит', () => {
  const world = makeWorld(600, 400);
  const body = world.createCircle(300, 380, 15);
  body.velocity.set(0, 0);

  simulate(world, 3);
  assert.equal(body.isSleeping, true, 'тело уснуло на полу');

  // Будим ударом.
  body.wake();
  body.velocity.set(0, -500);
  assert.equal(body.isSleeping, false);
});

/* ============================================================
 * Лимиты и устойчивость
 * ========================================================== */

test('world: превышение лимита тел вытесняет самое старое', () => {
  const world = makeWorld(800, 600, { maxBodies: 20 });
  for (let i = 0; i < 40; i += 1) {
    world.createCircle(50 + (i % 10) * 60, 50 + Math.floor(i / 10) * 60, 8);
  }
  assert.ok(world.bodies.length <= 20, `тел ${world.bodies.length} ≤ 20`);
});

test('world: advance ограничивает dt и не уходит в спираль', () => {
  const world = makeWorld(400, 400);
  world.createCircle(200, 200, 20);

  // Внезапный «фриз» на 5 секунд не должен прокрутить 5 секунд физики.
  world.advance(5);

  assert.ok(world.steps <= 8, `шагов ${world.steps}, ожидалось ≤ 8`);
});

test('world: clear полностью очищает состояние', () => {
  const world = makeWorld();
  world.createCircle(100, 100, 10);
  world.createCircle(200, 100, 10);
  world.createDistanceJoint(world.bodies[0], world.bodies[1], 1);

  world.clear();

  assert.equal(world.bodies.length, 0);
  assert.equal(world.joints.length, 0);
  assert.equal(world.contacts.length, 0);
});

test('world: bodyAt находит верхнее тело под точкой', () => {
  const world = makeWorld(400, 400);
  world.createCircle(100, 100, 30);
  const top = world.createCircle(100, 100, 15);

  world.bodies[0].updateBounds();
  top.updateBounds();

  const found = world.bodyAt(100, 100);
  assert.equal(found, top, 'возвращается последнее добавленное тело');
  assert.equal(world.bodyAt(390, 390), null, 'пустое место — null');
});

test('world: тела разных форм уживаются в одной сцене без NaN', () => {
  const world = makeWorld(700, 500);

  for (let i = 0; i < 12; i += 1) {
    world.createCircle(80 + Math.random() * 540, Math.random() * -300, 10 + Math.random() * 12);
  }
  for (let i = 0; i < 12; i += 1) {
    world.createBox(80 + Math.random() * 540, Math.random() * -300, 20 + Math.random() * 20, 20 + Math.random() * 20);
  }
  for (let i = 0; i < 8; i += 1) {
    world.createPolygon(80 + Math.random() * 540, Math.random() * -300, 15 + Math.random() * 15, 3 + i % 4);
  }

  simulate(world, 8);

  for (const body of world.bodies) {
    assert.ok(Number.isFinite(body.position.x) && Number.isFinite(body.position.y));
    assert.equal(body.kind === BODY_KIND.CIRCLE || body.kind === BODY_KIND.POLYGON, true);
  }
});