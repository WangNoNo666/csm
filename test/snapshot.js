/* ============================================================
   生成关卡总览 SVG —— 直接从 src/levels.js 的真实数据绘制
   用途：肉眼核查每个房间的平台/水晶/箱子/压力板/门的实际位置
   用法：node test/snapshot.js  → 输出 level-preview.svg
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');
const files = ['config.js','util.js','input.js','actor.js','portal.js','player.js','props.js',
  'levels.js','fx.js','audio.js','render.js','game.js'];
let bundle = '';
for (const f of files) bundle += `\n` + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Game };\n';
const ctx = new Proxy({}, { get: (t, k) => {
  if (k === 'measureText') return () => ({ width: 100 });
  if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
  if (k === 'canvas') return { width: 960, height: 576 };
  return () => {};
} });
const cv = { width: 960, height: 576, style: {}, getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 576 }), addEventListener() {} };
const sb = { console, Math, Date, parseInt, parseFloat, isNaN, JSON, Object, Array, String, Number,
  Boolean, Set, Map, Infinity, NaN,
  document: { getElementById: () => cv, addEventListener() {} },
  addEventListener() {}, requestAnimationFrame() {}, performance: { now: () => 0 }, devicePixelRatio: 1 };
sb.window = sb; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(bundle, sb);
const { CFG, Game } = sb.__X;
const T = CFG.TILE, W = CFG.ROOM_W * T, H = CFG.ROOM_H * T;

const g = new Game(cv);
g.renderer.W = 960; g.renderer.H = 576;

const COL = {
  bg: '#0f1420', wall: '#2f3a52', wallTop: '#4a5b7d', grid: '#1b2333',
  crystal: '#6ee7ff', crate: '#c98b4b', goal: '#ffd75e', plate: '#ff7a59',
  gate: '#ff5f8f', spawn: '#7dffa8', text: '#dfe7f5', dim: '#8a97ad',
  hazard: '#ff4d5e', hazardBg: '#3a1220',
};

/** SVG 文本转义 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let svg = '';
const PAD = 14, SCALE = 0.62;
const cw = W * SCALE, ch = H * SCALE;

function roomSvg(room, i, cols) {
  const ox = PAD + (i % cols) * (cw + PAD);
  const oy = PAD + Math.floor(i / cols) * (ch + PAD + 22);
  let s = `<g transform="translate(${ox},${oy})">`;
  s += `<rect x="0" y="0" width="${cw}" height="${ch}" rx="6" fill="${COL.bg}" stroke="#33405c"/>`;
  // 网格
  s += `<g stroke="${COL.grid}" stroke-width=".5">`;
  for (let x = 1; x < CFG.ROOM_W; x++) s += `<line x1="${x * T * SCALE}" y1="0" x2="${x * T * SCALE}" y2="${ch}"/>`;
  for (let y = 1; y < CFG.ROOM_H; y++) s += `<line x1="0" y1="${y * T * SCALE}" x2="${cw}" y2="${y * T * SCALE}"/>`;
  s += `</g>`;
  // 实心
  for (const sol of room.solids) {
    if (!sol.active) continue;
    s += `<rect x="${sol.x * SCALE}" y="${sol.y * SCALE}" width="${sol.w * SCALE}" height="${sol.h * SCALE}" fill="${COL.wall}"/>`;
    s += `<rect x="${sol.x * SCALE}" y="${sol.y * SCALE}" width="${sol.w * SCALE}" height="2" fill="${COL.wallTop}"/>`;
  }
  /* 尖刺/岩浆等 hazard。
     ⚠️ 必须画出来：这是「7B 难度」唯一的直观证据。
        引擎里一个 '^' 会变成**整格 32×32 的伤害盒**（不是小三角），
        所以图上也按整格画 —— 否则容易误判"这点刺随便跳过去"。 */
  for (const hz of room.hazards) {
    const hx = hz.x * SCALE, hy = hz.y * SCALE, hw = hz.w * SCALE, hh = hz.h * SCALE;
    s += `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" fill="${COL.hazardBg}" stroke="${COL.hazard}" stroke-width=".6"/>`;
    // 锯齿：底边一排三角，看起来就是刺
    const teeth = Math.max(2, Math.round(hz.w / 10));
    const tw = hw / teeth;
    for (let k = 0; k < teeth; k++) {
      const bx = hx + k * tw;
      s += `<path d="M ${bx} ${hy + hh} L ${bx + tw / 2} ${hy} L ${bx + tw} ${hy + hh} Z" fill="${COL.hazard}" opacity=".75"/>`;
    }
  }
  // 门（关着的画出来）
  for (const gt of room.gates) {
    s += `<rect x="${gt.x * SCALE}" y="${gt.y * SCALE}" width="${gt.w * SCALE}" height="${gt.h * SCALE}" fill="${COL.gate}" opacity=".35" stroke="${COL.gate}" stroke-dasharray="3 3"/>`;
  }
  // 压力板
  for (const pl of room.plates) {
    s += `<rect x="${pl.x * SCALE}" y="${pl.y * SCALE}" width="${pl.w * SCALE}" height="${Math.max(3, pl.h * SCALE)}" fill="${COL.plate}"/>`;
  }
  // 水晶
  for (const cr of room.crystals) {
    const cx = cr.x * SCALE, cy = cr.y * SCALE, r = 7;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COL.crystal}" opacity=".45"/>`;
    s += `<path d="M ${cx} ${cy - r} L ${cx + r * .7} ${cy} L ${cx} ${cy + r} L ${cx - r * .7} ${cy} Z" fill="${COL.crystal}"/>`;
  }
  // 收集半径提示（15px）
  for (const cr of room.crystals) {
    s += `<circle cx="${cr.x * SCALE}" cy="${cr.y * SCALE}" r="${15 * SCALE}" fill="${COL.crystal}" opacity=".12"/>`;
  }
  // 箱子
  for (const b of room.crates) {
    s += `<rect x="${b.x * SCALE}" y="${b.y * SCALE}" width="${b.w * SCALE}" height="${b.h * SCALE}" rx="2" fill="${COL.crate}" stroke="#8a5c2b"/>`;
  }
  // 终点
  if (room.goal) {
    const gx = room.goal.x * SCALE, gy = room.goal.y * SCALE;
    s += `<circle cx="${gx}" cy="${gy}" r="9" fill="${COL.goal}" opacity=".9"/>`;
    s += `<circle cx="${gx}" cy="${gy}" r="14" fill="none" stroke="${COL.goal}" opacity=".4"/>`;
  }
  // 出生点
  s += `<circle cx="${(room.spawn.x + CFG.P_W / 2) * SCALE}" cy="${(room.spawn.y + CFG.P_H / 2) * SCALE}" r="5" fill="${COL.spawn}"/>`;
  // 世界内浮字提示（引导层）
  for (const t of room.texts) {
    const tx = t.x * SCALE, ty = t.y * SCALE;
    s += `<g opacity=".95">`;
    s += `<rect x="${tx - 74}" y="${ty - 9}" width="148" height="15" rx="4" fill="#0a1220" stroke="#4ea6ff" stroke-width=".7"/>`;
    s += `<path d="M ${tx - 4} ${ty + 6} L ${tx} ${ty + 11} L ${tx + 4} ${ty + 6} Z" fill="#0a1220" stroke="#4ea6ff" stroke-width=".7"/>`;
    s += `<text x="${tx}" y="${ty + 2}" text-anchor="middle" font-family="monospace" font-size="8.5" fill="#cfe2ff">${esc(t.text)}</text>`;
    s += `</g>`;
  }
  s += `<text x="6" y="${ch - 6}" font-family="monospace" font-size="10" fill="${COL.text}">房间${room.id} · ${esc(room.name)}</text>`;
  s += `<text x="6" y="${ch + 14}" font-family="monospace" font-size="9" fill="#7fd6a0">▶ ${esc(room.objective || '')}</text>`;
  s += `</g>`;
  return s;
}

const cols = 2;
const totalW = PAD + cols * (cw + PAD);
const totalH = PAD + Math.ceil(g.rooms.length / cols) * (ch + PAD + 22);
svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH + 46}" viewBox="0 0 ${totalW} ${totalH + 46}">`;
svg += `<rect width="100%" height="100%" fill="#080b12"/>`;
svg += `<text x="${PAD}" y="24" font-family="monospace" font-size="15" fill="${COL.text}">蔚蓝式传送门跑酷 · 关卡总览（每格 32px）</text>`;
svg += `<text x="${PAD}" y="40" font-family="monospace" font-size="10" fill="${COL.dim}">● 绿=出生点　◆ 青=冲刺水晶（含 15px 收集半径）　▮ 橙=箱子　● 黄=终点　▬ 红=压力板　▨ 粉=能量门　▲ 红刺=尖刺（一击必死，整格判定）</text>`;
svg += `<g transform="translate(0,46)">`;
for (let i = 0; i < g.rooms.length; i++) svg += roomSvg(g.rooms[i], i, cols);
svg += `</g></svg>`;

fs.writeFileSync(path.join(__dirname, '..', 'level-preview.svg'), svg);
console.log('已生成 level-preview.svg');
console.log(`房间数 ${g.rooms.length}，画布 ${totalW}×${totalH + 46}`);
for (const room of g.rooms) {
  console.log(`  房间${room.id} ${room.name}: 实心块 ${room.solids.length}, 尖刺 ${String(room.hazards.length).padStart(2)}, 水晶 ${room.crystals.length}, 箱子 ${room.crates.length}, 压力板 ${room.plates.length}, 门 ${room.gates.length}, 浮字 ${room.texts.length}, 出生 (${(room.spawn.x / T).toFixed(1)},${(room.spawn.y / T).toFixed(1)})`);
}
