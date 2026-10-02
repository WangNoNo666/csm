/* ============================================================
   进阶动作能力实测 v2 —— 按「玩家实操帧序」逐步扫描
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
const T = CFG.TILE;

const g = new Game(cv); g.renderer.W = 960; g.renderer.H = 576;
g.switchRoom(0, false);
const room = g.room, P = g.player, IN = g.input;
const ALL_KEYS = ['left','right','up','down','jump','dash','portal','portal2','reset','clear'];
function frame(want) {
  want = want || {};
  for (const k of ALL_KEYS) {
    const v = !!want[k];
    if (v && !IN.held[k]) IN.queued.push(k);
    if (!v && IN.held[k]) IN.held[k] = false;
  }
  IN.beginStep();
  g.step(CFG.DT);
}
const run = (w, n) => { for (let i = 0; i < n; i++) frame(w); };
const settle = (n = 160) => run({}, n);
function reset() { P.reset(room.spawn.x, room.spawn.y); settle(); }

settle();
const baseY = P.y;
console.log('=== 进阶动作实测 v2 ===');
console.log(`地面 y=${baseY.toFixed(1)}px (${(baseY / T).toFixed(2)} 格)`);

/* ---------- A. 凌波微步：跳跃 → 空中斜下冲刺 → 冲刺结束后按跳 ---------- */
// 精确重建 Celeste 的输入：jump(起跳) → dash(斜下) → 冲刺结束后的窗口内 jump
function tryWave(jumpFrames, dashStart, dashLen, waveAt) {
  reset();
  run({ right: true }, 55);           // 助跑
  const x0 = P.x, y0 = P.y;
  let maxX = x0, minY = y0, wave = false, dashSeen = false;
  for (let i = 0; i < 340; i++) {
    const jump = i < jumpFrames;
    const dash = i >= dashStart && i < dashStart + dashLen;
    const wj = i >= waveAt && i < waveAt + 2;
    frame({ right: true, down: dash, jump: jump || wj, dash });
    maxX = Math.max(maxX, P.x); minY = Math.min(minY, P.y);
    if (P.dashing) dashSeen = true;
    if (P.waveFx > 0.9) wave = true;
  }
  return { dx: maxX - x0, up: y0 - minY, wave, dashSeen };
}
let bestWave = null;
for (let ds = 6; ds <= 26; ds += 2) {
  for (let wv = ds + 14; wv <= ds + 30; wv += 2) {
    const r = tryWave(24, ds, 3, wv);
    if (r.wave && (!bestWave || r.dx > bestWave.dx)) bestWave = { ...r, ds, wv };
  }
}
console.log(`A. 凌波微步  水平 ${bestWave.dx.toFixed(1)}px = ${(bestWave.dx / T).toFixed(2)} 格   `
  + `净升 ${bestWave.up.toFixed(1)}px = ${(bestWave.up / T).toFixed(2)} 格   触发✓ (dash@${bestWave.ds},jump@${bestWave.wv})`);

/* ---------- B. 超级跳：地面冲刺 + 冲刺中按跳 ---------- */
function trySuper(dashFrames, jumpAt) {
  reset();
  run({ right: true }, 55);
  const x0 = P.x, y0 = P.y;
  let maxX = x0, minY = y0, sup = false;
  for (let i = 0; i < 340; i++) {
    const dash = i < dashFrames;
    const jump = i >= jumpAt && i < jumpAt + 2;
    frame({ right: true, jump, dash });
    maxX = Math.max(maxX, P.x); minY = Math.min(minY, P.y);
    if (P.superFx > 0.9) sup = true;
  }
  return { dx: maxX - x0, up: y0 - minY, sup };
}
let bestSup = null;
for (let jf = 1; jf <= 5; jf++) {
  const r = trySuper(3, jf);
  if (r.sup && (!bestSup || r.dx > bestSup.dx)) bestSup = { ...r, jf };
}
if (bestSup) {
  console.log(`B. 超级跳    水平 ${bestSup.dx.toFixed(1)}px = ${(bestSup.dx / T).toFixed(2)} 格   `
    + `净升 ${bestSup.up.toFixed(1)}px = ${(bestSup.up / T).toFixed(2)} 格   触发✓`);
} else {
  // 超级跳不触发时，退而求其次：地面冲刺 + 冲刺结束瞬间跳
  const r = trySuper(3, 99);
  console.log(`B. 超级跳    ✗ 未触发（superFx 未置位）—— 退化为地面冲刺 ${(r.dx / T).toFixed(2)} 格`);
}

/* ---------- C. 空中冲刺 + 起跳的组合水平距离 ---------- */
{
  reset(); run({ right: true }, 55);
  const x0 = P.x;
  let maxX = x0;
  for (let i = 0; i < 340; i++) { frame({ right: true, jump: i < 24, dash: i >= 8 && i < 11 }); maxX = Math.max(maxX, P.x); }
  console.log(`C. 跳+空中冲刺 水平 ${(maxX / T - x0 / T).toFixed(2)} 格`);
}
/* ---------- C2. 纯地面冲刺 ---------- */
{
  reset(); run({ right: true }, 55);
  const x0 = P.x;
  for (let i = 0; i < 40; i++) frame({ right: true, dash: i < 3 });
  console.log(`C2. 地面冲刺  水平 ${(P.x / T - x0 / T).toFixed(2)} 格`);
}

/* ---------- D. 墙跳：交替蹬墙的净升 ---------- */
const rid = g.rooms.findIndex(r => r.name && r.name.includes('墙跳'));
if (rid >= 0) {
  g.switchRoom(rid, false); settle(80);
  const P2 = g.player, R2 = g.room;
  console.log(`\nD. 墙跳房间「${R2.name}」 出生 (${(P2.x / T).toFixed(1)},${(P2.y / T).toFixed(1)})`);
  const y0 = P2.y;
  let minY = y0, wjCount = 0, lastWj = -99;
  // 走到井口再蹬墙：先向右跑，贴住右壁后交替
  for (let i = 0; i < 200; i++) frame({ right: true });
  console.log(`   走到 x=${(P2.x / T).toFixed(1)} 格, y=${(P2.y / T).toFixed(1)} 格, 贴墙=${P2.wallSlide || P2.climbing}`);
  for (let i = 0; i < 1400; i++) {
    // 每 26 帧翻一次方向，翻方向的头 2 帧按跳
    const ph = Math.floor(i / 26);
    const dir = ph % 2 === 0 ? 'right' : 'left';
    const jump = (i % 26) < 2;
    frame({ [dir]: true, jump });
    minY = Math.min(minY, P2.y);
    if (P2.wallJumpFx > 0.9 && i - lastWj > 8) { wjCount++; lastWj = i; }
  }
  console.log(`   连续蹬墙 净升 ${(y0 - minY).toFixed(1)}px = ${((y0 - minY) / T).toFixed(2)} 格   蹬墙次数≈${wjCount}`);
  g.switchRoom(0, false); settle(60);
}
