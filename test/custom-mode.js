/* ============================================================
   自定义模式冒烟测试
   ------------------------------------------------------------
   验证：
     ① custom.js 能在最小 DOM 环境下加载并 init
     ② playMap / gotoLevel / restoreOriginal 不会炸
     ③ 编辑器能把网格转成可用的 Room
     ④ 20 格选关面板生成正确
   ⚠️ 这里**不真开浏览器** —— 用一层极简 DOM 桩，
      只要能跑通"逻辑"即可。渲染正确性靠人工预览。
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

/* ---------------- 极简 DOM 桩 ---------------- */
function makeDom() {
  const byId = new Map();
  const mkEl = (tag, id) => {
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      id: id || '',
      className: '',
      style: {},
      dataset: {},
      children: [],
      /* ⚠️ innerHTML 必须是"会真的清空 children"的访问器。
         真实 DOM 里 `el.innerHTML=''` 会把子节点删光；桩里如果只是存个字符串，
         那么 `innerHTML=''; appendChild(...)` 会**越积越多**，
         测试里看到的子节点数就是历史累计值（第一次就踩了：
         键位面板渲染出 0 行 → 其实是被判定"没渲染"）。
         删掉这个陷阱后，渲染类断言才可信。 */
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) { this._innerHTML = String(v); this.children.length = 0; },
      textContent: '',
      value: '',
      width: 0, height: 0,
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
      _handlers: {},
      addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
      removeEventListener() {},
      appendChild(c) { this.children.push(c); return c; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 420, height: 252 }; },
      getContext() { return makeCtx(); },
      setPointerCapture() {},
      dispatch(t, ev) { for (const fn of (this._handlers[t] || [])) fn(ev || {}); },
      focus() {},
    };
    return el;
  };
  function makeCtx() {
    return new Proxy({}, {
      get(t, k) {
        if (k === 'measureText') return () => ({ width: 60 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
    });
  }
  const doc = {
    readyState: 'complete',
    _els: byId,
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, mkEl('div', id));
      return byId.get(id);
    },
    createElement(tag) { return mkEl(tag); },
    querySelector(sel) { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: mkEl('body'),
  };
  return { doc, byId, mkEl, makeCtx };
}

/* ---------------- 内存版 localStorage ---------------- */
function makeLS() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  };
}

console.log('\n[1] 引擎 + custom.js 加载');
const files = ['config.js', 'util.js', 'input.js', 'actor.js', 'portal.js', 'player.js',
  'props.js', 'levels.js', 'fx.js', 'audio.js', 'render.js', 'game.js'];
let bundle = '';
for (const f of files) bundle += '\n' + fs.readFileSync(path.join(dir, f), 'utf8');
bundle += '\nglobalThis.__X = { CFG, Game, Room, ACTIONS, KEYBINDS, ROOMS };\n';

/* 收集 window 上的 keydown 监听器 —— 键位录制逻辑全在这里，
   测「录制是否吞键 / 是否让路」必须能手动触发它们。
   ⚠️ 注册顺序很重要：input.js 的监听器先注册（负责录制），
      custom.js 的全局快捷键后注册。用捕获与冒泡分开存，
      方便分别验证"录制时全局快捷键必须让路"。 */
const winListeners = { keydown: [], keydownCapture: [] };
function collectKeydown(sb2) {
  // input.js 用 { passive:false } 注册，custom.js 用 true（捕获）
  return winListeners.keydown.concat(winListeners.keydownCapture);
}

const { doc } = makeDom();
const ctxProxy = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 100 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'canvas') return { width: 960, height: 576 };
    return () => {};
  },
});
const cv = { width: 960, height: 576, style: {}, getContext: () => ctxProxy,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 576 }), addEventListener() {} };

const sb = {
  console, Math, Date, parseInt, parseFloat, isNaN, JSON, Object, Array, String, Number,
  Boolean, Set, Map, Infinity, NaN, ArrayBuffer, Uint8Array,
  // 分享码要用到 base64 与 UTF-8 编解码 —— 浏览器原生自带，Node 里要手动补
  TextEncoder, TextDecoder,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  navigator: {},
  localStorage: makeLS(),
  document: doc,
  addEventListener(type, fn, opts) {
    if (type === 'keydown') {
      if (opts === true || (opts && opts.capture)) winListeners.keydownCapture.push(fn);
      else winListeners.keydown.push(fn);
    }
  },
  removeEventListener() {},
  requestAnimationFrame() {}, cancelAnimationFrame() {},
  setTimeout: (fn) => { try { fn(); } catch (e) { throw e; } return 0; },
  clearTimeout() {},
  performance: { now: () => 0 },
  devicePixelRatio: 1,
  alert: () => {},
  confirm: () => true,
};
sb.window = sb; sb.globalThis = sb;
// game.js 会用 document.getElementById('game') 拿画布
doc._els.set('game', cv);
vm.createContext(sb);
vm.runInContext(bundle, sb);

const { CFG, Game, Room, ACTIONS, KEYBINDS } = sb.__X;
const g = new Game(cv);
g.renderer.W = 960; g.renderer.H = 576;
sb.window.__game = g;
// custom.js 会读 document.getElementById('selectPanel') 等 —— 桩会按需创建
try {
  vm.runInContext(fs.readFileSync(path.join(dir, 'custom.js'), 'utf8'), sb);
  // 等 DOMContentLoaded 的 setTimeout(…,0) 立即执行
} catch (e) {
  console.log('  ✗ custom.js 抛错: ' + e.message + '\n' + e.stack.split('\n').slice(0, 4).join('\n'));
  fail++;
}
check('custom.js 加载后 window.__custom 存在', !!sb.window.__custom);
check('CUSTOM 全局存在', !!sb.CUSTOM);

const C = sb.window.__custom;
if (!C) { console.log('\n结果: 通过 ' + pass + ' / 失败 ' + fail); process.exit(1); }

console.log('\n[2] 选关面板：20 格');
const gridEl = doc._els.get('selectGrid');
check('选关网格已创建', !!gridEl);
check('选关网格有 20 个子格', gridEl && gridEl.children.length === 20,
  `实际 ${gridEl ? gridEl.children.length : 0}`);
check('每个格子都带 rid', gridEl && gridEl.children.every((c, i) => c.dataset.rid === String(i)));

console.log('\n[3] gotoLevel 跳关');
g.start();
C.gotoLevel(11);
check('跳到了第 12 关 (rid=11)', g.roomId === 11, `roomId=${g.roomId}`);
check('玩家落在该关出生点', Math.abs(g.player.x - g.room.spawn.x) < 2
  && Math.abs(g.player.y - g.room.spawn.y) < 2);
check('传送门被清空', !g.portals.a.active && !g.portals.b.active);
C.gotoLevel(19);
check('能跳到最后一关 (rid=19)', g.roomId === 19, `roomId=${g.roomId}`);
C.gotoLevel(0);
check('能跳回第 1 关', g.roomId === 0);

console.log('\n[4] playMap 自定义关卡');
const rows = [];
for (let y = 0; y < CFG.ROOM_H; y++) {
  if (y === 0 || y === CFG.ROOM_H - 1) rows.push('#'.repeat(CFG.ROOM_W));
  else rows.push('#' + ' '.repeat(CFG.ROOM_W - 2) + '#');
}
rows[CFG.ROOM_H - 2] = '#' + '#'.repeat(CFG.ROOM_W - 2) + '#';
// 放 S 和 G（G 放在地板上一格）
const r16 = rows[CFG.ROOM_H - 3].split('');
r16[4] = 'S'; rows[CFG.ROOM_H - 3] = r16.join('');
const r15 = rows[CFG.ROOM_H - 4].split('');
r15[12] = 'G'; rows[CFG.ROOM_H - 4] = r15.join('');

C.playMap(rows, { name: '冒烟测试关' });
check('进入自定义关卡模式（只有 1 个房间）', g.rooms.length === 1, `rooms=${g.rooms.length}`);
check('房间名被采用', g.room.name === '冒烟测试关', g.room.name);
check('出生点解析正确', g.room.spawn.x > 0 && g.room.spawn.y > 0);

// 跑 120 帧确认自定义关卡不崩
let ok = true;
try {
  for (let i = 0; i < 120; i++) { g.input.beginStep(); g.step(CFG.DT); }
} catch (e) { ok = false; console.log('    抛错: ' + e.message); }
check('自定义关卡能稳定跑 120 帧', ok);

C.restoreOriginal();
check('restoreOriginal 后恢复 20 关', g.rooms.length === 20, `rooms=${g.rooms.length}`);

console.log('\n[5] 记录写入');
C.submitClear(3, 12.5, 4);
C.submitClear(3, 9.8, 6);     // 更快 → 应刷新最佳
const rec = C.records[3];
check('通关被记录', rec && rec.cleared === true);
check('最佳时间取更小值', Math.abs(rec.best - 9.8) < 0.001, `best=${rec.best}`);
check('死亡数取更大值', rec.deaths === 6, `deaths=${rec.deaths}`);
check('localStorage 里存了记录', !!sb.localStorage.getItem('portalrunner.records.v1'));

console.log('\n[6] 编辑器：网格 → Room');
const edCanvas = doc._els.get('edCanvas');
check('编辑器画布存在', !!edCanvas);
check('画布尺寸为 30×18 格', edCanvas && edCanvas.width === CFG.ROOM_W * 22
  && edCanvas.height === CFG.ROOM_H * 22, `${edCanvas && edCanvas.width}×${edCanvas && edCanvas.height}`);
// 模拟"试玩"：直接走 playMap（编辑器内部就是这么做的）
let playOk = true;
try { g.__customWrapped; C.openSelect(); } catch (e) { playOk = false; console.log('    抛错: ' + e.message); }
check('打开选关面板不抛错', playOk);

console.log('\n[7] 自定义关卡持久化');
const saved = [{ name: '关卡A', map: rows, savedAt: 1 }];
sb.localStorage.setItem('portalrunner.custom.levels.v1', JSON.stringify(saved));
const back = C.loadCustomLevels();
check('自定义关卡能存能读', back.length === 1 && back[0].name === '关卡A');
check('地图 18 行', back[0].map.length === 18);
check('每行 30 列', back[0].map.every(r => r.length === CFG.ROOM_W));

/* ------------------------------------------------------------
   [8] 键位设置：面板切换不能把输入吃掉
   ------------------------------------------------------------
   玩家的原话：「按键修改按钮点击后进入编辑地图页面，无法修改按键」。
   根因（三个叠加）：
     ① index.html 内联脚本和 custom.js 各绑了一遍按钮 → 两个监听器打架
     ② openPanel 切换面板时没清 input.captureAction →
        录制状态残留，之后所有按键都被录制器吞掉，游戏里按什么都没反应
     ③ 全局 keydown（Tab / Esc）抢在录制之前处理 → 想绑 Tab/Esc 永远绑不上
   这里把这三条逐个钉死。
   ------------------------------------------------------------ */
console.log('\n[8] 键位设置：面板切换与录制状态');
C.openPanel('binds');
// ⚠️ 必须用 doc.getElementById 取元素（它才会按需创建），
//    直接 _els.get 在元素还没被访问过时是 undefined。
const bindRows = doc.getElementById('bindRows');
check('打开键位面板会渲染出所有动作行',
  bindRows && bindRows.children.length === ACTIONS.length,
  `实际 ${bindRows ? bindRows.children.length : 0} / 期望 ${ACTIONS.length}`);
check('每行都有「名字 + 按键框」两个子元素',
  bindRows && bindRows.children.every(r => r.children.length === 2));

// 模拟玩家点了第一个「按键框」开始录制
const firstKey = bindRows.children[0].children[1];
firstKey.dispatch('click');
check('点按键框后进入录制状态', g.input.captureAction === ACTIONS[0].id,
  `captureAction=${g.input.captureAction}`);
check('录制中的框带 listening 样式', firstKey.classList.contains('listening'));

// ★ 关键回归：录制中直接切到编辑器 —— 必须清掉 captureAction
C.openPanel('editor');
check('★ 录制中切到编辑器会自动取消录制（曾经卡死的 bug）',
  g.input.captureAction === null,
  `captureAction=${g.input.captureAction}`);

// 录制中切到选关 / 大厅也一样
firstKey.dispatch('click');
C.openPanel('select');
check('录制中切到选关也会取消录制', g.input.captureAction === null);
firstKey.dispatch('click');
C.openPanel('hall');
check('录制中切到地图大厅也会取消录制', g.input.captureAction === null);

// 取消录制后，普通按键必须重新被游戏收到（不能被吞）
C.closePanels();
g.input.held = Object.create(null);
g.input.queued.length = 0;
const keydownHandlers = collectKeydown(sb);
check('全局 keydown 监听器已注册', keydownHandlers.length > 0, `${keydownHandlers.length} 个`);
const fakeKey = (code) => ({ code, key: code, preventDefault() {}, stopPropagation() {} });
let prevented = false;
for (const fn of keydownHandlers) {
  fn({ code: 'ArrowRight', key: 'ArrowRight', preventDefault() { prevented = true; }, stopPropagation() {} });
}
check('未录制时方向键会被识别为动作并阻止默认行为', prevented);

// 录制态下按键必须被录制器吞掉、且不产生动作
firstKey.dispatch('click');
g.input.queued.length = 0;
for (const fn of keydownHandlers) fn(fakeKey('KeyK'));
check('录制态下按 K 会绑定到该动作', KEYBINDS[ACTIONS[0].id] === 'KeyK',
  `${ACTIONS[0].id} → ${KEYBINDS[ACTIONS[0].id]}`);
check('录制结束后 captureAction 归零', g.input.captureAction === null);

// ★ 回归③：录制态下 Tab / Esc 必须让路，否则永远绑不上这两个键
firstKey.dispatch('click');
let tabOpenedSelect = false;
const selectWasShown = doc.getElementById('selectPanel').classList.contains('show');
for (const fn of keydownHandlers) fn(fakeKey('Tab'));
check('★ 录制态下按 Tab 不会被"打开选关"抢走',
  doc.getElementById('selectPanel').classList.contains('show') === selectWasShown
  && KEYBINDS[ACTIONS[0].id] === 'Tab',
  `绑定结果 = ${KEYBINDS[ACTIONS[0].id]}`);

/* ------------------------------------------------------------
   [9] 分享码 + 地图大厅
   ------------------------------------------------------------ */
console.log('\n[9] 分享码与地图大厅');
check('CUSTOM 暴露 makeShareCode / parseShareCode',
  typeof C.makeShareCode === 'function' && typeof C.parseShareCode === 'function');

let rtOk = false, rtCode = '';
try {
  rtCode = C.makeShareCode('测试关卡', rows);
  const p = C.parseShareCode(rtCode);
  rtOk = p.name === '测试关卡' && p.map.join('\n') === rows.join('\n');
} catch (e) { console.log('    抛错: ' + e.message); }
check('分享码往返无损', rtOk, `码长 ${rtCode.length}`);

let badHandled = false;
try { C.parseShareCode('乱码乱码'); } catch (e) { badHandled = true; }
check('坏分享码会抛错而不是生成乱图', badHandled);

// 大厅：导入 / 去重 / 列表
const hallGrid = doc._els.get('hallGrid');
check('大厅网格已创建', !!hallGrid);
sb.localStorage.setItem('portalrunner.custom.levels.v1', '[]');
C.hall.refresh();
check('空大厅会给出提示', String(hallGrid.innerHTML).includes('还没有自定义地图'));

const imported = C.hall.importCode(rtCode, {});
check('导入分享码后进了大厅', !!imported && C.hall.all().length === 1,
  `大厅里有 ${C.hall.all().length} 张`);
const again = C.hall.importCode(rtCode, {});
check('同一张地图重复导入会去重', C.hall.all().length === 1, `大厅里有 ${C.hall.all().length} 张`);

C.hall.refresh();
check('大厅渲染出卡片', hallGrid.children.length === 1, `${hallGrid.children.length} 张卡`);
check('每张卡带缩略图 + 操作区', hallGrid.children.length === 1
  && hallGrid.children[0].children.length >= 2);

// 内置的 20 个官方关卡也必须能分享出去
const ROOMS_ALL = sb.__ROOMS || null;
if (ROOMS_ALL) {
  let allOk = true;
  for (const r of ROOMS_ALL) {
    try { C.parseShareCode(C.makeShareCode(r.name, r.map)); } catch (e) { allOk = false; }
  }
  check('20 个官方关卡都能生成可解析的分享码', allOk);
}

console.log(`\n结果: 通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
