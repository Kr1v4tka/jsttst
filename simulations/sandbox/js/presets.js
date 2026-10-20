/**
 * presets.js — сцены-заготовки для песочницы.
 *
 * Каждая сцена — чистая функция `(world) => void`, поэтому их легко
 * комбинировать, тестировать и вызывать из UI.
 */

const PALETTE = [
  '#38bdf8', '#a78bfa', '#f472b6', '#facc15',
  '#4ade80', '#fb923c', '#22d3ee', '#f87171',
];

function pickColor(index) {
  return PALETTE[index % PALETTE.length];
}

/** Башня из коробок. */
export function buildTower(world) {
  const columns = 4;
  const rows = 8;
  const size = 34;
  const startX = world.width / 2 - (columns * size) / 2;
  const startY = world.height - 60;

  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = startX + col * size + size / 2;
      const y = startY - row * size;
      world.createBox(x, y, size - 2, size - 2, {
        color: pickColor(index),
        friction: 0.6,
        restitution: 0.12,
      });
      index += 1;
    }
  }
}

/** Дождь из шаров. */
export function buildRain(world, count = 40) {
  for (let i = 0; i < count; i += 1) {
    const radius = 7 + Math.random() * 11;
    const x = radius + Math.random() * (world.width - radius * 2);
    const y = -radius - Math.random() * 260;
    world.createCircle(x, y, radius, {
      color: pickColor(i),
      restitution: 0.55,
      velocity: { x: (Math.random() - 0.5) * 120, y: Math.random() * 140 },
    });
  }
}

/** Маятник на верёвке. */
export function buildPendulum(world) {
  const anchor = world.createCircle(world.width / 2, 90, 14, {
    color: '#94a3b8',
    static: true,
  });
  const bob = world.createCircle(world.width / 2 + 190, 90, 26, {
    color: '#f472b6',
    restitution: 0.6,
  });
  world.createDistanceJoint(anchor, bob, 1);
  return { anchor, bob };
}

/** Наклонная плоскость с шарами. */
export function buildRamp(world) {
  const ramp = world.createBox(world.width * 0.5, world.height * 0.55, world.width * 0.62, 22, {
    color: '#475569',
    static: true,
    angle: -0.28,
  });

  for (let i = 0; i < 12; i += 1) {
    world.createCircle(
      world.width * 0.22 + i * 22,
      world.height * 0.3 - i * 6,
      10 + Math.random() * 8,
      { color: pickColor(i), restitution: 0.45, friction: 0.2 },
    );
  }
  return ramp;
}

/** «Ньютонова люлька» — ряд шаров на подвесах. */
export function buildCradle(world) {
  const count = 5;
  const spacing = 52;
  const startX = world.width / 2 - ((count - 1) * spacing) / 2;
  const anchorY = 120;
  const radius = 24;

  for (let i = 0; i < count; i += 1) {
    const x = startX + i * spacing;
    const anchor = world.createCircle(x, anchorY, 6, { color: '#334155', static: true });
    const bob = world.createCircle(x, anchorY + 220, radius, {
      color: pickColor(i),
      restitution: 0.95,
      friction: 0.02,
      linearDamping: 0.001,
    });
    world.createDistanceJoint(anchor, bob, 1);
  }

  // Раскачиваем крайний шар.
  const first = world.bodies.find((b) => !b.isStatic);
  if (first) first.velocity.set(-260, 0);
}

/** «Генератор» — падающие полигоны. */
export function buildPolygons(world, count = 14) {
  for (let i = 0; i < count; i += 1) {
    const sides = 3 + Math.floor(Math.random() * 5);
    world.createPolygon(
      Math.random() * (world.width - 120) + 60,
      Math.random() * -400,
      18 + Math.random() * 22,
      sides,
      {
        color: pickColor(i),
        restitution: 0.35,
        friction: 0.5,
        angularVelocity: (Math.random() - 0.5) * 6,
      },
    );
  }
}

/** Смешанная «демо-сцена» при первом запуске. */
export function buildShowcase(world) {
  const floor = world.createBox(world.width / 2, world.height - 18, world.width, 36, {
    color: '#334155',
    static: true,
    friction: 0.7,
  });

  const leftWall = world.createBox(18, world.height / 2, 36, world.height, {
    color: '#334155',
    static: true,
  });

  buildTower(world);

  for (let i = 0; i < 8; i += 1) {
    world.createCircle(
      world.width * 0.2 + Math.random() * 120,
      world.height * 0.35 - i * 40,
      14 + Math.random() * 10,
      { color: pickColor(i + 2), restitution: 0.62, friction: 0.3 },
    );
  }

  const anchor = world.createCircle(world.width * 0.78, 90, 10, {
    color: '#94a3b8',
    static: true,
  });
  const bob = world.createCircle(world.width * 0.78 + 130, 90, 22, {
    color: '#facc15',
    restitution: 0.5,
  });
  world.createDistanceJoint(anchor, bob, 1);

  return { floor, leftWall };
}

export const PRESETS = {
  showcase: { label: 'Демо-сцена', build: buildShowcase },
  tower: { label: 'Башня', build: buildTower },
  rain: { label: 'Дождь', build: buildRain },
  pendulum: { label: 'Маятник', build: buildPendulum },
  ramp: { label: 'Наклонная плоскость', build: buildRamp },
  cradle: { label: 'Люлька Ньютона', build: buildCradle },
  polygons: { label: 'Полигоны', build: buildPolygons },
};

export { PALETTE, pickColor };