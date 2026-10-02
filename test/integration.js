/* 集成测试：用假 Canvas/DOM 跑真实的 Game.step + render()，
   验证渲染与主循环不会抛异常，并检查传送门递归渲染的调用路径 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');

/* ---------- 假 Canvas 2D 上下文 ---------- */
function makeCtx() {
  const calls = { transform: 0, save: 0, restore: 0, clip: 0, fill: 0, stroke: 0, fillText: 0 };
  const noop = () => {};
  const ctx = {
    _calls: calls,
    canvas: null,
    imageSmoothingEnabled: false,
    globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
    shadowColor: '', shadowBlur: 0, globalCompositeOperation: 'source-over',
    save() { calls.save++; }, restore() { calls.restore++; },
    clip() { calls.clip++; }, transform() { calls.transform++; },
    translate: noop, rotate: noop, scale: noop, setTransform: noop, resetTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop, ellipse: noop,
    fill() { calls.fill++; }, stroke() { calls.stroke++; },
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText() { calls.fillText++; }, strokeText: noop,
    measureText: (t) => ({ width: (t || '').length * 7 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    setLineDash: noop, getLineDash: () => [],
    drawImage: noop, putImageData: noop, getImageData: () => ({ data: [] }),
  };
  return ctx;
}

function makeCanvas(w, h) {
  const ctx = makeCtx();
  const cv = {
    width: w, height: h,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    addEventListener: () => {}, removeEventListener: () => {},
  };
  ctx.canvas = cv;
  cv._ctx = ctx;
  return cv;
}

/* ---------- 假 DOM ---------- */
const canvas = makeCanvas(960, 576);
const listeners = {};
const document = {
  getElementById: (id) => {
    if (id === 'game') return canvas;
    if (id === 'stage') return { clientWidth: 1200, clientHeight: 720 };
    if (id === 'btnSound' || id === 'btnReset') return { addEventListener: () => {}, classList: { toggle: () => {} }, textContent: '' };
    return { addEventListener: () => {}, classList: { toggle: () => {} }, textContent: '', style: {} };
  },
  addEventListener: () => {},
};
let rafCount = 0;
const sandbox = {
  console, Math, Date, parseInt, parseFloat, isNaN, JSON, Object, Array, String, Number,
  Boolean, Set, Map, Infinity, NaN, Promise,
  document,
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  removeEventListener: () => {},
  requestAnimationFrame: (fn) => { rafCount++; if (rafCount < 3) setTimeout(() => fn(performance.now()), 0); return rafCount; },
  performance: { now: () => Date.now() },
  devicePixelRatio: 1,
  innerWidth: 1200, innerHeight: 720,
  setTimeout, clearTimeout,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
// 屏蔽音频（无 AudioContext）
sandbox.AudioContext = undefined;
sandbox.webkitAudioContext = undefined;
vm.createContext(sandbox);

const files = ['config.js','util.js','input.js','actor.js','portal.js','player.js','props.js',
  'levels.js','fx.js','audio.js','render.js','game.js','main.js'];

let bundle = '';
for (const f of files) bundle += `\n//=== ${f} ===\n` + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__T = { CFG, render, drawPlayer, drawHUD, roundRect };\n';
vm.createContext(sandbox);

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  \u2713 ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  \u2717 ' + n + '  ' + e); } };

console.log('\n[A] 加载真实代码（含 main.js 启动流程）');
try {
  vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });
  check('全部脚本加载成功', true);
} catch (e) {
  check('全部脚本加载成功', false, e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const T = sandbox.__T;
const game = sandbox.__game;
check('window.__game 已暴露', !!game);
check('renderer 尺寸已设置', game.renderer.W > 0 && game.renderer.H > 0, `${game.renderer.W}x${game.renderer.H}`);
check('音频在无 AudioContext 时优雅降级', game.audio.enabled === false || game.audio.ctx === null);
check('rAF 主循环已启动', rafCount > 0, `raf=${rafCount}`);

/* ---------- 模拟真实操作 ---------- */
console.log('\n[B] 模拟真实操作 + 渲染（含传送门递归）');
const IN = game.input;
function press(a) { IN.queued.push(a); }
function release(a) { IN.held[a] = false; }

function tick(n = 1, held = [], presses = []) {
  for (let k = 0; k < n; k++) {
    // 先把本步的按键按下列入队列，beginStep 会把它们变成 pressed 边沿
    for (const a of [...presses, ...held]) {
      if (!IN.held[a]) IN.queued.push(a);
    }
    IN.beginStep();
    game.step(T.CFG.DT);
    renderSafe();
  }
  // 一步之后，held 里的键保持按住；presses 里的键松开（模拟"点一下"）
  for (const a of presses) IN.held[a] = false;
}
/** 只按一帧（点按） */
function tap(a) { tick(1, [], [a]); }
let renderErr = null;
function renderSafe() {
  try { T.render(); }
  catch (e) { if (!renderErr) renderErr = e; }
}

// 让玩家落地
tick(120);
check('落地后无渲染异常', !renderErr, renderErr ? renderErr.message : `player y=${game.player.y.toFixed(0)}`);
check('玩家已接地', game.player.grounded === true);

// 放两个门（Q/E）
renderErr = null;
tap('portal');
tap('portal2');
check('Q/E 能放置两个传送门', game.portals.a.active && game.portals.b.active,
  `A(${game.portals.a.active}) B(${game.portals.b.active}) 朝向 d=${game.portals.a.d}/${game.portals.b.d}`);
check('两个门不在同一位置', game.portals.a.x !== game.portals.b.x || game.portals.a.y !== game.portals.b.y);

// 两个门都激活 → 渲染递归视口（这是最容易崩的路径）
renderErr = null;
tick(30);
check('传送门递归视口渲染无异常', !renderErr, renderErr ? renderErr.message + ' @ ' + (renderErr.stack||'').split('\n')[1] : '');
check('ctx.transform 被调用于视口映射', canvas._ctx._calls.transform > 0, `transform 调用 ${canvas._ctx._calls.transform} 次`);
check('ctx.clip 被调用于门裁剪', canvas._ctx._calls.clip > 0, `clip 调用 ${canvas._ctx._calls.clip} 次`);
check('save/restore 配对', canvas._ctx._calls.save === canvas._ctx._calls.restore,
  `save=${canvas._ctx._calls.save} restore=${canvas._ctx._calls.restore}`);

// 移动 + 跳跃 + 冲刺
renderErr = null;
IN.held.right = true;
tick(20, ['right']);
tick(8, ['right', 'jump'], ['jump']);
tick(10, ['right']);
tick(6, ['right', 'dash'], ['dash']);
tick(40, ['right']);
IN.held.right = false;
check('移动+跳+冲刺全程无异常', !renderErr, renderErr ? renderErr.message : `player x=${game.player.x.toFixed(0)}`);
check('玩家确实向右移动了', game.player.x > game.room.spawn.x, `Δx=${(game.player.x - game.room.spawn.x).toFixed(0)}`);

// 清门
tap('clear');
check('C 键清门生效', !game.portals.a.active && !game.portals.b.active);

// 房间切换 + 在别房间放门（跨房间门）
console.log('\n[C] 跨房间传送门');
game.switchRoom(2, true);
tick(10);
check('可切换到房间 2', game.room.id === 2, `当前房间 ${game.room.id}`);
renderErr = null;
tap('portal');
check('在新房间能放门', game.portals.a.active, `门房间=${game.portals.a.roomId}`);
tap('portal2');
tick(20);
check('跨房间后渲染无异常', !renderErr, renderErr ? renderErr.message : '');

// 压力板房间（房间3 = 机关 · 压力板，含木箱）
console.log('\n[D] 机关房间实跑');
game.switchRoom(3, true);
tick(60);
const r1 = game.room;
check('房间3 有箱子与压力板', r1.crates.length > 0 && r1.plates.length > 0);
// 把箱子直接搬到压力板上，验证门开
const bx = r1.crates[0], pl = r1.plates[0];
bx.x = pl.x + 6; bx.y = pl.y - 20; bx.vy = 0;
tick(40);
check('箱子压板 → 信号通电', r1.signals[0].on === true);
check('门打开（不再阻挡）', r1.gates[0].active === false);
renderErr = null;
tick(20);
check('机关房间渲染无异常', !renderErr, renderErr ? renderErr.message : '');

// 玩家踩箱子上
console.log('\n[E] 玩家与箱子交互');
game.switchRoom(3, true);
tick(30);
const p = game.player, box = game.room.crates[0];
p.x = box.x - 1; p.y = box.y - p.h - 1; p.vy = 0;
tick(30);
check('玩家可站在箱子上（不穿透）', p.y + p.h <= box.y + 2.5, `pBottom=${(p.y + p.h).toFixed(1)} boxTop=${box.y.toFixed(1)}`);
renderErr = null;
tick(10);
check('箱子交互渲染无异常', !renderErr, renderErr ? renderErr.message : '');

// 死亡 / 重生
console.log('\n[F] 死亡与重生');
const d0 = game.deaths;
game.respawnPlayer();
check('重生计数递增', game.deaths === d0 + 1);
check('重生回出生点', Math.abs(game.player.x - game.room.spawn.x) < 1, `x=${game.player.x.toFixed(1)}`);
renderErr = null;
tick(40);
check('重生后渲染无异常', !renderErr, renderErr ? renderErr.message : '');

// 通关
console.log('\n[G] 关卡流程');
game.switchRoom(2, true);
tick(10);
// 抵达终点：先进入「本关通过」过场（不是直接结束游戏）
game.win();
check('抵达终点后进入本关通过过场', game.levelClear === true);
check('抵达终点后没有立刻结束游戏', game.won === false, `won=${game.won}`);
check('本轮用时被记录', typeof game.levelTimes[2] === 'number',
  `${(game.levelTimes[2] || 0).toFixed(2)}s`);
renderErr = null;
tick(20);
check('过场期间渲染无异常', !renderErr, renderErr ? renderErr.message : '');
// 过场走完 → 自动进入下一关
let gGuard = 0;
while (game.levelClear && gGuard++ < 400) tick(1);
check('过场结束后自动进入下一关', game.roomId === 3, `roomId=${game.roomId}`);
check('切关后玩家在新关出生点',
  Math.abs(game.player.x - game.room.spawn.x) < 2, `x=${game.player.x.toFixed(1)}`);

// 最后一关通关 → 结算
game.switchRoom(19, true);
tick(10);
game.win();
gGuard = 0;
while (game.levelClear && gGuard++ < 400) tick(1);
check('最后一关结束后才进入结算画面', game.won === true, `won=${game.won}`);
renderErr = null;
tick(60);
check('通关结算渲染无异常', !renderErr, renderErr ? renderErr.message : '');

// 长时间稳定性
console.log('\n[H] 长时间稳定性');
renderErr = null;
game.resetAll(true);
IN.held.right = true;
let jumpDown = false, dashDown = false;
for (let i = 0; i < 900; i++) {
  const presses = [];
  if (i % 40 === 0) { presses.push('jump'); jumpDown = true; }
  if (i % 40 === 12) jumpDown = false;
  if (i % 90 === 0) { presses.push('dash'); dashDown = true; }
  if (i % 90 === 5) dashDown = false;
  if (i % 90 === 20) presses.push('portal');
  if (i % 90 === 25) presses.push('portal2');
  if (i % 200 === 0) game.portals.clear();
  const held = ['right'];
  if (jumpDown) held.push('jump');
  if (dashDown) held.push('dash');
  tick(1, held, presses);
}
IN.held.right = false;
check('900 步随机操作无异常', !renderErr, renderErr ? renderErr.message : '');
check('粒子数受控（无泄漏）', game.fx.parts.length < 700, `粒子上限内 ${game.fx.parts.length}`);
check('实体未飞出世界', Math.abs(game.player.y) < 5000, `y=${game.player.y.toFixed(0)}`);
check('save/restore 仍配对', canvas._ctx._calls.save === canvas._ctx._calls.restore,
  `save=${canvas._ctx._calls.save} restore=${canvas._ctx._calls.restore}`);

/* 每个房间都渲染一遍 */
console.log('\n[I] 全部房间渲染');
renderErr = null;
for (const r of game.rooms) {
  game.switchRoom(r.id, true);
  tick(15);
}
check(`${game.rooms.length} 个房间全部渲染无异常`, !renderErr, renderErr ? renderErr.message : '');
check('渲染发生了大量绘制调用', canvas._ctx._calls.fill > 100, `fill=${canvas._ctx._calls.fill}`);

console.log(`\n${'='.repeat(46)}`);
console.log(`  通过 ${pass}  /  失败 ${fail}`);
console.log(`${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
