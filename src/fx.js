/* ============================================================
   特效 —— 粒子 / 屏幕震动 / 拖尾 / 传送门视口绘制
   ============================================================ */

class FX {
  constructor() { this.parts = []; this.rings = []; this.sparks = []; }
  clear() { this.parts.length = 0; this.rings.length = 0; this.sparks.length = 0; }

  add(p) { if (this.parts.length < 620) this.parts.push(p); }

  /* ---- 生成器 ---- */
  landDust(x, y, intensity) {
    const n = Math.round(6 + intensity * 16);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI;
      const sp = rand(30, 130) * (0.5 + intensity);
      this.add({
        x: x + rand(-7, 7), y: y - 1,
        vx: Math.cos(a) * sp * (Math.random() < .5 ? -1 : 1) * 0.9,
        vy: -Math.abs(Math.sin(a)) * sp * 0.5,
        life: rand(0.22, 0.5), max: 0.5, r: rand(1.4, 3.4),
        c: '#cfd8e8', g: 320, kind: 'dust',
      });
    }
  }
  jumpDust(x, y) {
    for (let i = 0; i < 7; i++) {
      this.add({
        x: x + rand(-6, 6), y: y - 2,
        vx: rand(-70, 70), vy: rand(-24, -4),
        life: rand(0.16, 0.34), max: 0.34, r: rand(1.2, 2.6),
        c: '#b9c6dc', g: 260, kind: 'dust',
      });
    }
  }
  coyotePuff(x, y) {
    this.rings.push({ x, y, r: 4, max: 20, life: 0.3, maxLife: 0.3, c: '255,255,255', lw: 1.6 });
  }
  airJumpPuff(x, y) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(40, 150);
      this.add({
        x, y: y + 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 + 30,
        life: rand(0.14, 0.3), max: 0.3, r: rand(1.6, 3.2),
        c: i % 3 === 0 ? '#ffffff' : '#bfe8ff', g: 40, kind: 'spark',
      });
    }
    this.rings.push({ x, y: y + 4, r: 5, max: 24, life: 0.24, maxLife: 0.24, c: '190,240,255', lw: 2 });
  }
  portalBurst(x, y, color, d, speed) {
    const n = clamp(Math.round(speed / 22), 6, 22);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(50, 260);
      this.add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.18, 0.45), max: 0.45, r: rand(1.4, 3.6),
        c: color, g: 40, kind: 'spark',
      });
    }
    this.rings.push({ x, y, r: 6, max: 44, life: 0.34, maxLife: 0.34, c: hexToRgb(color), lw: 3 });
  }
  crystalBurst(x, y) {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 7, sp = rand(60, 220);
      this.add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.2, 0.5), max: 0.5, r: rand(1.6, 3.6),
        c: '#bfe0ff', g: 20, kind: 'spark',
      });
    }
    this.rings.push({ x, y, r: 5, max: 34, life: 0.3, maxLife: 0.3, c: '160,210,255', lw: 2.4 });
  }
  deathBurst(x, y) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 7, sp = rand(60, 340);
      this.add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: rand(0.3, 0.8), max: 0.8, r: rand(1.6, 4.4),
        c: i % 2 ? '#ff8a6a' : '#ffd0a0', g: 420, kind: 'spark',
      });
    }
    this.rings.push({ x, y, r: 4, max: 52, life: 0.4, maxLife: 0.4, c: '255,150,110', lw: 3 });
  }
  trailPuff(x, y, c) {
    this.add({
      x: x + rand(-2, 2), y: y + rand(-2, 2),
      vx: rand(-8, 8), vy: rand(-8, 8),
      life: rand(0.1, 0.22), max: 0.22, r: rand(1, 2.4),
      c, g: 0, kind: 'glow',
    });
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.vx *= (1 - 2.2 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) { this.rings.splice(i, 1); continue; }
      const t = 1 - r.life / r.maxLife;
      r.r = lerp(r.r, r.max, 0.24);
    }
  }

  draw(g) {
    for (const p of this.parts) {
      const a = clamp(p.life / p.max, 0, 1);
      g.globalAlpha = p.kind === 'dust' ? a * 0.8 : a;
      g.fillStyle = p.c;
      if (p.kind === 'spark') {
        g.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      } else {
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.4 + a * 0.6), 0, 7); g.fill();
      }
    }
    g.globalAlpha = 1;
    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      g.strokeStyle = `rgba(${r.c},${(1 - t) * 0.85})`;
      g.lineWidth = r.lw * (1 - t * 0.7);
      g.beginPath(); g.arc(r.x, r.y, r.r, 0, 7); g.stroke();
    }
  }
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
