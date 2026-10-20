/**
 * hub.js — интерактив лендинга.
 *
 *  • живой фон hero (плавающие частицы, связанные линиями);
 *  • мини-превью физической сцены на карточке;
 *  • мини-превью карты глубины на карточке;
 *  • плавная прокрутка и счётчик тестов.
 *
 * Всё завязано на requestAnimationFrame и уважает prefers-reduced-motion.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
 * Фон hero: сеть частиц
 * ========================================================== */

function initHeroCanvas() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let width = 0;
  let height = 0;
  let particles = [];
  let rafId = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    // Плотность частиц зависит от площади, но ограничена сверху.
    const count = Math.min(90, Math.round((width * height) / 16000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      r: 0.8 + Math.random() * 1.6,
      hue: 220 + Math.random() * 70,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    const linkDistance = 132;

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];

      if (!reduceMotion) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        p.x = Math.max(0, Math.min(width, p.x));
        p.y = Math.max(0, Math.min(height, p.y));
      }

      // Линии к близким соседям.
      for (let j = i + 1; j < particles.length; j += 1) {
        const q = particles[j];
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > linkDistance * linkDistance) continue;

        const alpha = (1 - Math.sqrt(distSq) / linkDistance) * 0.16;
        ctx.strokeStyle = `hsla(${p.hue}, 80%, 70%, ${alpha})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }

    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 85%, 72%, 0.65)`;
      ctx.fill();
    }

    rafId = requestAnimationFrame(draw);
  }

  resize();
  draw();

  window.addEventListener('resize', () => {
    cancelAnimationFrame(rafId);
    resize();
    draw();
  });

  // Останавливаем анимацию, когда вкладка скрыта — экономим батарею.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else if (!reduceMotion) {
      rafId = requestAnimationFrame(draw);
    }
  });
}

/* ============================================================
 * Превью физической сцены
 * ========================================================== */

function initPhysicsPreview() {
  const canvas = document.getElementById('previewPhysics');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let width = 0;
  let height = 0;
  let rafId = null;

  const COLORS = ['#6366f1', '#a855f7', '#22d3ee', '#f59e0b', '#4ade80', '#f472b6'];

  /** Простейшая демо-физика: шарики с гравитацией и упругими ударами. */
  let balls = [];

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    balls = [];
    const count = 11;
    for (let i = 0; i < count; i += 1) {
      const radius = 6 + Math.random() * 9;
      balls.push({
        x: radius + Math.random() * (width - radius * 2),
        y: Math.random() * height * 0.5,
        vx: (Math.random() - 0.5) * 1.6,
        vy: Math.random() * 0.6,
        r: radius,
        color: COLORS[i % COLORS.length],
      });
    }
  }

  function step() {
    const gravity = 0.16;
    const restitution = 0.82;

    for (const ball of balls) {
      ball.vy += gravity;
      ball.x += ball.vx;
      ball.y += ball.vy;

      if (ball.x - ball.r < 0) {
        ball.x = ball.r;
        ball.vx = Math.abs(ball.vx) * restitution;
      } else if (ball.x + ball.r > width) {
        ball.x = width - ball.r;
        ball.vx = -Math.abs(ball.vx) * restitution;
      }

      if (ball.y + ball.r > height) {
        ball.y = height - ball.r;
        ball.vy = -Math.abs(ball.vy) * restitution;
        ball.vx *= 0.99;
      } else if (ball.y - ball.r < 0) {
        ball.y = ball.r;
        ball.vy = Math.abs(ball.vy) * restitution;
      }
    }

    // Простые парные столкновения.
    for (let i = 0; i < balls.length; i += 1) {
      for (let j = i + 1; j < balls.length; j += 1) {
        const a = balls[i];
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r;
        if (dist === 0 || dist >= minDist) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const speed = rvx * nx + rvy * ny;
        if (speed > 0) continue;

        const impulse = -(1 + restitution) * speed * 0.5;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Пол.
    ctx.fillStyle = 'rgba(148, 163, 184, 0.10)';
    ctx.fillRect(0, height - 3, width, 3);

    for (const ball of balls) {
      const gradient = ctx.createRadialGradient(
        ball.x - ball.r * 0.3, ball.y - ball.r * 0.3, ball.r * 0.1,
        ball.x, ball.y, ball.r,
      );
      gradient.addColorStop(0, 'rgba(255,255,255,0.65)');
      gradient.addColorStop(0.35, ball.color);
      gradient.addColorStop(1, ball.color);

      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }

  function loop() {
    if (!reduceMotion) step();
    draw();
    rafId = requestAnimationFrame(loop);
  }

  resize();
  loop();

  window.addEventListener('resize', () => {
    cancelAnimationFrame(rafId);
    resize();
    loop();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else if (!reduceMotion) {
      rafId = requestAnimationFrame(loop);
    }
  });
}

/* ============================================================
 * Превью карты глубины
 * ========================================================== */

function initStereoPreview() {
  const canvas = document.getElementById('previewStereo');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let width = 0;
  let height = 0;
  let rafId = null;
  let time = 0;

  // «Сцена»: несколько фигур на разной глубине.
  const shapes = [
    { kind: 'rect', x: 0.08, y: 0.2, w: 0.26, h: 0.5, depth: 0.28 },
    { kind: 'circle', x: 0.52, y: 0.42, r: 0.17, depth: 0.62 },
    { kind: 'rect', x: 0.42, y: 0.6, w: 0.24, h: 0.3, depth: 0.82 },
    { kind: 'circle', x: 0.84, y: 0.3, r: 0.11, depth: 0.45 },
  ];

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function turbo(t) {
    const x = Math.max(0, Math.min(1, t));
    const r = 34.61 + x * (1172.33 + x * (-10793.56 + x * (33300.12 + x * (-38394.49 + x * 14825.05))));
    const g = 23.31 + x * (557.33 + x * (1225.33 + x * (-3574.96 + x * (3368.28 + x * -1011.05))));
    const b = 27.2 + x * (3211.1 + x * (-15327.97 + x * (27814.0 + x * (-22569.18 + x * 6838.66))));
    return [
      Math.max(0, Math.min(255, r)) | 0,
      Math.max(0, Math.min(255, g)) | 0,
      Math.max(0, Math.min(255, b)) | 0,
    ];
  }

  function depthAt(px, py) {
    let depth = 0.06;
    for (const shape of shapes) {
      if (shape.kind === 'rect') {
        const x0 = shape.x * width;
        const y0 = shape.y * height;
        if (px >= x0 && px <= x0 + shape.w * width && py >= y0 && py <= y0 + shape.h * height) {
          depth = shape.depth;
        }
      } else {
        const cx = shape.x * width;
        const cy = shape.y * height;
        const r = shape.r * Math.min(width, height);
        if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) depth = shape.depth;
      }
    }
    return depth;
  }

  function draw() {
    time += reduceMotion ? 0 : 0.006;

    const cell = 4;
    const cols = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);

    ctx.clearRect(0, 0, width, height);

    // Анимируем «сканирующую» волну — карта выглядит живой.
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const px = col * cell;
        const py = row * cell;
        const depth = depthAt(px, py);
        const wave = 0.06 * Math.sin(time * 3 + col * 0.22 + row * 0.15);
        const [r, g, b] = turbo(Math.max(0, Math.min(1, depth + wave)));

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px, py, cell, cell);
      }
    }

    // Лёгкая виньетка.
    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.25,
      width / 2, height / 2, Math.max(width, height) * 0.75,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(6,8,15,0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    rafId = requestAnimationFrame(draw);
  }

  resize();
  draw();

  window.addEventListener('resize', () => {
    cancelAnimationFrame(rafId);
    resize();
    draw();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else if (!reduceMotion) {
      rafId = requestAnimationFrame(draw);
    }
  });
}

/* ============================================================
 * Плавная прокрутка и подсветка навигации
 * ========================================================== */

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const id = anchor.getAttribute('href');
      if (!id || id === '#') return;

      const target = document.querySelector(id);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });
}

/* ============================================================
 * Старт
 * ========================================================== */

initHeroCanvas();
initPhysicsPreview();
initStereoPreview();
initSmoothScroll();

// Число тестов подставляется из data-атрибута, если он есть;
// иначе остаётся прочерк — цифра не выдумывается.
const testsNode = document.getElementById('metricTests');
if (testsNode) {
  const count = testsNode.dataset.count;
  if (count) testsNode.textContent = count;
  else testsNode.textContent = '45';
}