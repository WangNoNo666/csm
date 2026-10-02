/* ============================================================
   输入 —— 两个关键点：
   ① 所有输入状态在固定步长内被采样/消费，按键边沿（pressed）
      在一步物理后被消费，保证"按了必响应、不丢帧"
   ② 键位**完全可自定义**（默认 + localStorage 持久化），
      见 KEYBINDS / Input.applyBinds()

   默认键位（用户指定）：
     方向/移动 : ↑ ↓ ← →   （← → 左右移动，↑ 也能跳）
     跳跃      : C          （↑ 兼容；空中再按一次 = 空跳，仅 1 次）
     快速下降  : ↓
     蓝门      : B
     橙门      : O
     清空门    : P          （放在不易误触的位置）
     重生      : R
     暂停      : Esc
   ★ 第十三版：X「冲刺」已被彻底移除（位移能力过强，压掉了传送门的必要性）
   ============================================================ */

/** 动作定义 —— UI 用来生成设置面板 */
const ACTIONS = [
  { id: 'left',    label: '向左移动',   def: 'ArrowLeft' },
  { id: 'right',   label: '向右移动',   def: 'ArrowRight' },
  { id: 'up',      label: '向上（攀爬/看）', def: 'ArrowUp' },
  { id: 'down',    label: '向下 / 快速下降', def: 'ArrowDown' },
  { id: 'jump',    label: '跳跃',       def: 'KeyC' },
  { id: 'portal',  label: '蓝色传送门', def: 'KeyB' },
  { id: 'portal2', label: '橙色传送门', def: 'KeyO' },
  { id: 'clear',   label: '清空传送门', def: 'KeyP' },
  { id: 'reset',   label: '回到房间起点', def: 'KeyR' },
  { id: 'pause',   label: '暂停',       def: 'Escape' },
];

/** 动作 → 键位（可被用户覆盖）。键位用 KeyboardEvent.code */
const KEYBINDS = {};
for (const a of ACTIONS) KEYBINDS[a.id] = a.def;
// 兼容旧习惯的别名（始终生效，不参与自定义）
const KEY_ALIASES = {
  ArrowUp: 'up',
  KeyW: 'up',
  Space: 'jump',
  KeyJ: 'jump',
  KeyQ: 'portal',
  KeyE: 'portal2',
  KeyL: 'clear',
  KeyA: 'left',
  KeyD: 'right',
  KeyS: 'down',
};

const BIND_STORE = 'portalrunner.binds.v1';

/** 人类可读的键名 */
const KEY_LABEL = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Space: '空格', Escape: 'Esc', Enter: '回车', Tab: 'Tab',
  ShiftLeft: '左Shift', ShiftRight: '右Shift', ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
  AltLeft: '左Alt', AltRight: '右Alt', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/',
};
function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABEL[code]) return KEY_LABEL[code];
  if (/^Key([A-Z])$/.test(code)) return RegExp.$1;
  if (/^Digit(\d)$/.test(code)) return RegExp.$1;
  if (/^Numpad(\d)$/.test(code)) return '小键盘' + RegExp.$1;
  return code;
}

function loadBinds() {
  try {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(BIND_STORE);
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const a of ACTIONS) {
      if (typeof obj[a.id] === 'string' && obj[a.id]) KEYBINDS[a.id] = obj[a.id];
    }
  } catch (e) { /* 隐私模式 / 禁用存储 → 用默认 */ }
}
function saveBinds() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(BIND_STORE, JSON.stringify(KEYBINDS));
  } catch (e) { /* 忽略 */ }
}
function resetBinds() {
  for (const a of ACTIONS) KEYBINDS[a.id] = a.def;
  saveBinds();
}

class Input {
  constructor() {
    this.held = Object.create(null);
    this.pressed = Object.create(null);   // 本步内刚按下
    this.released = Object.create(null);  // 本步内刚松开
    this.queued = [];                      // 渲染帧期间累积的按下事件
    this.mouse = { x: 0, y: 0, down: false, pressed: false, released: false, rpressed: false };
    this._mq = [];
    loadBinds();
    this.captureAction = null;   // 设置面板正在录制的动作
    this._bind();
  }

  /** code → 动作（可自定义优先，其次别名） */
  actionOf(code) {
    for (const id in KEYBINDS) if (KEYBINDS[id] === code) return id;
    return KEY_ALIASES[code] || null;
  }

  /** 把某个动作重新绑定到 code（会自动解绑冲突） */
  rebind(action, code) {
    if (!code || code === 'Escape') return false;
    // 冲突处理：同一 code 不能绑两个动作
    for (const id in KEYBINDS) if (id !== action && KEYBINDS[id] === code) KEYBINDS[id] = null;
    KEYBINDS[action] = code;
    saveBinds();
    return true;
  }

  _bind() {
    addEventListener('keydown', (e) => {
      // 正在录制键位：吞掉这次按键，交给设置面板
      if (this.captureAction) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== 'Escape') { this.rebind(this.captureAction, e.code); }
        this.captureAction = null;
        this._captured = true;      // UI 用：本轮录制刚结束，该重画键位表
        return;
      }
      const a = this.actionOf(e.code);
      if (a) {
        e.preventDefault();
        if (!this.held[a]) this.queued.push(a);
      }
      if (e.repeat) e.preventDefault();
    }, { passive: false });

    addEventListener('keyup', (e) => {
      const a = this.actionOf(e.code);
      if (a) { e.preventDefault(); this.held[a] = false; }
    }, { passive: false });

    addEventListener('blur', () => { this.held = Object.create(null); });

    const cv = document.getElementById('game');
    if (cv) {
      const upd = (e) => {
        const r = cv.getBoundingClientRect();
        this.mouse.x = (e.clientX - r.left) * (cv.width / r.width);
        this.mouse.y = (e.clientY - r.top) * (cv.height / r.height);
      };
      cv.addEventListener('mousemove', upd);
      cv.addEventListener('mousedown', (e) => {
        upd(e);
        if (e.button === 0) { this.mouse.down = true; this._mq.push('L'); }
        if (e.button === 2) { this._mq.push('R'); }
        e.preventDefault();
      });
      cv.addEventListener('mouseup', (e) => {
        if (e.button === 0) { this.mouse.down = false; this._mq.push('LUP'); }
        e.preventDefault();
      });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('mouseleave', () => { this.mouse.down = false; });
    }
  }

  /** 每个物理步开头调用：把渲染帧累积的事件转成边沿标记 */
  beginStep() {
    this.pressed = Object.create(null);
    this.released = Object.create(null);
    this.mouse.pressed = false;
    this.mouse.rpressed = false;
    this.mouse.released = false;

    for (const a of this.queued) {
      if (!this.held[a]) { this.held[a] = true; this.pressed[a] = true; }
    }
    this.queued.length = 0;

    for (const m of this._mq) {
      if (m === 'L') { this.mouse.pressed = true; this.mouse.down = true; }
      else if (m === 'R') { this.mouse.rpressed = true; }
      else if (m === 'LUP') { this.mouse.released = true; this.mouse.down = false; }
    }
    this._mq.length = 0;
  }

  down(a) { return !!this.held[a]; }
  hit(a) { return !!this.pressed[a]; }
  up(a) { return !!this.released[a]; }

  /** 方向轴：-1 / 0 / 1 */
  get ax() { return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0); }
  get ay() { return (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0); }
}
