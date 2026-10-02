/* ============================================================
   真实能力测量 v2 —— 修正输入管线，一次性拿到可信数字
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

/* 真实输入管线：按住 = 保持在 held 里；边沿只在第一次 push。
   注意：want 里**没列出**的键一律视为松开 —— 否则上一次的按住会一直残留，
   导致后续 input.hit() 永远不再触发（曾经的 0 位移 bug 就来自这里）。 */
const ALL_KEYS = ['left', 'right', 'up', 'down', 'jump', 'dash', 'portal', 'portal2', 'reset', 'clear'];
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
const run = (want, n) => { for (let i = 0; i < n; i++) frame(want); };
const settle = (n = 160) => run({}, n);

settle();
const baseY = P.y;
console.log('=== 实测能力（真实物理管线 v2）===');
console.log(`站立地面 y=${baseY.toFixed(1)}px (${(baseY / T).toFixed(2)} 格)\n`);

function reset() { P.reset(room.spawn.x, room.spawn.y); settle(); }

/* 1. 长按跳高度 + 滞空 */
reset();
let minY = 1e9, air = 0, total = 0;
for (let i = 0; i < 220; i++) { frame({ jump: true }); if (P.y < minY) minY = P.y; if (!P.grounded) { air++; total++; } else if (i > 5) break; }
const holdH = baseY - minY;
console.log(`1. 长按跳   升高 ${holdH.toFixed(1)}px = ${(holdH / T).toFixed(2)} 格  滞空 ${(air * CFG.DT).toFixed(2)}s`);

/* 2. 轻点跳（3 帧后松）*/
reset(); minY = 1e9;
for (let i = 0; i < 200; i++) { frame({ jump: i < 3 }); minY = Math.min(minY, P.y); if (i > 5 && P.grounded) break; }
const minYTap = minY;
console.log(`2. 轻点跳   升高 ${(baseY - minY).toFixed(1)}px = ${((baseY - minY) / T).toFixed(2)} 格`);

/* 3. 助跑 + 长按跳 */
reset(); run({ right: true }, 70);
const x0 = P.x;
let peakY = 1e9, landX = P.x, peakX = P.x;
for (let i = 0; i < 260; i++) {
  frame({ right: true, jump: i < 36 });
  if (P.y < peakY) { peakY = P.y; peakX = P.x; }
  if (i > 12 && P.grounded) { landX = P.x; break; }
}
const jd = landX - x0, jh = baseY - peakY;
console.log(`3. 助跑跳   水平 ${jd.toFixed(1)}px = ${(jd / T).toFixed(2)} 格   升高 ${jh.toFixed(1)}px = ${(jh / T).toFixed(2)} 格`);

/* 4. 助跑 + 跳 + 空中冲刺 */
reset(); run({ right: true }, 70);
const x1 = P.x;
let landX1 = P.x;
for (let i = 0; i < 320; i++) {
  // 冲刺边沿只在前 2 帧给，之后保持"按住"避免重复触发
  frame({ right: true, jump: i < 36, dash: i >= 14 && i < 17 });
  if (i > 20 && P.grounded) { landX1 = P.x; break; }
}
console.log(`4. 跳+空中冲刺 水平 ${(landX1 - x1).toFixed(1)}px = ${((landX1 - x1) / T).toFixed(2)} 格`);

/* 4b. 空中冲刺单独测（站定 → 跳 → 冲刺），量冲刺净位移 */
reset();
run({ right: true }, 60);
const xs = P.x, ys = P.y;
let dashPeakX = xs, dashEndY = ys, dashStartX = xs;
let dashStarted = false, dEnd = 0;
for (let i = 0; i < 200; i++) {
  frame({ right: true, jump: i < 30, dash: i >= 10 && i < 13 });
  if (!dashStarted && P.dashing) { dashStarted = true; dashStartX = P.x; }
  if (dashStarted && !P.dashing && !dEnd) dEnd = i;
  dashPeakX = Math.max(dashPeakX, P.x);
  if (i > 14 && P.grounded) { dashEndY = P.y; break; }
}
console.log(`4b. 空中冲刺净位移 ${(dashPeakX - dashStartX).toFixed(1)}px = ${((dashPeakX - dashStartX) / T).toFixed(2)} 格`);

/* 5. 地面冲刺位移 */
reset(); run({ right: true }, 50);
const x2 = P.x;
run({ right: true, dash: true }, 2);
run({ right: true, dash: true }, 40);
const groundDash = P.x - x2;
console.log(`5. 地面冲刺 位移 ${groundDash.toFixed(1)}px = ${(groundDash / T).toFixed(2)} 格`);

/* 6. 加速到 95% 满速所需时间 / 刹车距离 */
reset();
let t95 = 0;
for (let i = 0; i < 120; i++) { frame({ right: true }); if (Math.abs(P.vx) >= CFG.RUN_SPEED * 0.95) { t95 = i + 1; break; } }
const topSpeed = Math.abs(P.vx);
const bx = P.x;
let bt = 0;
for (let i = 0; i < 120; i++) { frame({}); bt = i + 1; if (Math.abs(P.vx) < 5) break; }
console.log(`6. 加速到 95%(${topSpeed.toFixed(0)}px/s) 用 ${t95} 帧=${(t95 * CFG.DT * 1000).toFixed(0)}ms；刹车 ${(P.x - bx).toFixed(1)}px / ${(bt * CFG.DT * 1000).toFixed(0)}ms`);

console.log(`\n结论：垂直 长按 ${(holdH / T).toFixed(2)} 格 / 轻点 ${((baseY - minYTap) / T).toFixed(2)} 格`);
console.log(`      水平 助跑跳 ${(jd / T).toFixed(2)} 格 / 跳+冲刺 ${((landX1 - x1) / T).toFixed(2)} 格 / 地面冲刺 ${(groundDash / T).toFixed(2)} 格`);
// 关卡设计安全上限：留容错（垂直 0.5 格，水平普通跳 0.5 格 / 带冲刺 0.7 格）
console.log(`\n关卡设计安全上限 → 垂直 ${(holdH / T - 0.5).toFixed(1)} 格，水平 普通跳 ${(jd / T - 0.5).toFixed(1)} 格 / 带冲刺 ${((landX1 - x1) / T - 0.7).toFixed(1)} 格`);
