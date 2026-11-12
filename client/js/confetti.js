// Confete simples para o pódio

const COLORS = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#a855f7', '#f97316'];
let particles = [];
let running = false;

export function burst(count = 140) {
  const c = document.getElementById('confetti');
  if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  c.width = innerWidth;
  c.height = innerHeight;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.4,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      s: 5 + Math.random() * 6,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      life: 160 + Math.random() * 60,
    });
  }
  if (!running) {
    running = true;
    requestAnimationFrame(() => tick(c));
  }
}

function tick(c) {
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  particles = particles.filter((p) => p.life-- > 0 && p.y < c.height + 20);
  for (const p of particles) {
    p.vy += 0.35;
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.r);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    ctx.restore();
  }
  if (particles.length) requestAnimationFrame(() => tick(c));
  else {
    running = false;
    ctx.clearRect(0, 0, c.width, c.height);
  }
}
