/* ============================================================
   解密道具 & 机关
   - PushBox : 可推动、可被重力作用、可被"用力推进"传送门的箱子
               （静止或轻微挪动不会被吸走 —— 必须玩家明显朝门内推它）
   - Plate   : 压力板（箱子/玩家压住即触发）
   - Switch  : 按钮（接触触发，可保持）
   - Gate    : 门（由信号控制开合，可被箱子穿过——门开时）
   - Button  : 玩家交互按键触发（E）
   - Crystal : 能量水晶（补充空中跳）
   - MovingBlock : 由信号驱动的移动石墙（把箱子顶出去/造路）
   ============================================================ */

class PushBox extends Actor {
  constructor(x, y, id) {
    super(x, y, 20, 20);
    this.id = id;
    this.isBox = true;
    this.spawn = { x, y };
    this.onPlate = false;
    this.carry = 0;
    this.portalCd = 0;
    this.gravityScale = 1;
    this.stuckT = 0;      // 连续被卡住的时长（用于渐进脱困）
    // 「正被玩家顶着走」的速度（见 pushSpeed 的注释）。
    // 只在玩家接触的那一帧被写入，脱离接触立刻归零 —— 专供传送门速度闸用。
    this.topPush = 0;
  }
  reset() { this.x = this.spawn.x; this.y = this.spawn.y; this.vx = 0; this.vy = 0; this.remX = 0; this.remY = 0; this.stuckT = 0; this.topPush = 0; }

  update(dt, game, solids) {
    this.portalCd = Math.max(0, this.portalCd - dt);
    /* ⚠️⚠️ 「顶推速度」的清零时机非常讲究，改错会让推箱传送彻底失效 ⚠️⚠️
       ------------------------------------------------------------------
       本函数的执行顺序是：
         c.update()  →  portals.check()（读 topPush）
         ... 之后**同一帧** game.step() 才调用 pushCrates() 写入下一帧的 topPush
       所以 topPush 的生命周期是「上一帧 pushCrates 写入 → 本帧 portals.check 读取」。
       如果把清零放在函数**开头**（`this.topPush = 0` 写在第一行），
       那么本帧 check 读到的永远是 0 → 横推闸门恒不成立 →
       "把箱子顶到传送门上"永远不传送（实测：箱子贴到门前 8px 停住，
       portalCd 恒为 0，一路滑到隔墙上）。
       ✅ 正确做法：清零放在函数**末尾** —— 读完之后才作废，
          既保证 check 拿到的是上一帧的真实顶推速度，
          又保证玩家一旦松手（pushCrates 不再写入），
          下一帧末尾清零后 topPush 自然归 0，箱子不会"松手后继续飞"。*/
    const room = game.room;
    this._prevCx = this.cx; this._prevCy = this.cy;

    // 重力（箱子下落更快更"实"）
    if (!this.grounded) {
      this.vy += CFG.GRAV_FALL * 1.05 * dt;
      if (this.vy > CFG.FAST_FALL_MAX) this.vy = CFG.FAST_FALL_MAX;
    } else {
      this.vy = Math.min(this.vy + 200 * dt, 60);
    }
    // 水平阻尼
    this.vx = approach(this.vx, 0, 900 * dt);

    this.grounded = false;
    const beforeX = this.x, beforeY = this.y;
    this.moveX(this.vx * dt, solids, room);
    game.portals.check(this, game);        // 想被传送 → 必须自身有明显朝门内的速度
    this.moveY(this.vy * dt, solids, room);
    game.portals.check(this, game);

    // 稳定接地
    if (!this.grounded && this.vy >= 0 && this.checkGround(solids, room)) { this.grounded = true; this.vy = 0; }

    // 被移动石块推挤 / 多重重叠分离
    this.resolveStuck(solids, room, beforeX, beforeY, dt, game);

    // ★ 见函数头的注释：清零必须在**所有** portals.check 之后
    this.topPush = 0;
  }

  /**
   * 脱困：处理"卡在墙角/被机关夹住/被玩家推进死角"。
   *
   * 三步渐进策略：
   *  1) 多重叠分离：沿**最小穿透轴**把自己推出来（比单个 MTV 更稳）
   *  2) 前后对比：如果这一步几乎没挪动但速度不为 0 → 判定为受阻
   *  3) 受阻持续 → 沿受阻方向做"切向滑动"（横着溜出去），
   *     仍出不来则沿原方向反向轻推，最后兜底回退到出生点附近的最近可用格
   */
  resolveStuck(solids, room, beforeX, beforeY, dt, game) {
    const movedDist = Math.hypot(this.x - beforeX, this.y - beforeY);
    const wanted = Math.hypot(this.vx, this.vy) * dt;

    // ---- 1) 多重叠分离（最多 4 轮，逐轮取最深穿透轴）----
    let freed = false;
    for (let iter = 0; iter < 4; iter++) {
      const hit = this.deepestOverlap(solids, room);
      if (!hit) { freed = true; break; }
      // 沿该轴按穿透量推出，留一点余量
      if (hit.axis === 'x') {
        this.x += hit.sign * (hit.depth + CFG.PUSH_OUT);
        this.vx = hit.sign * Math.min(Math.abs(this.vx), 40) * 0.5;
      } else {
        this.y += hit.sign * (hit.depth + CFG.PUSH_OUT);
        if (hit.sign < 0) { this.grounded = true; this.vy = 0; }
        else this.vy = Math.min(0, this.vy);
      }
    }
    if (freed) { this.stuckT = Math.max(0, this.stuckT - dt * 2); return; }

    // ---- 2) 还有重叠 → 判定为受阻，累计时长 ----
    this.stuckT += dt;
    if (this.stuckT < 0.08) return;

    // ---- 3) 切向滑动脱困：优先沿"上一帧实际能动的方向"溜出去 ----
    const slid = this.trySlideOut(solids, room);
    if (slid) { this.stuckT = 0; return; }

    // ---- 兜底：被彻底夹死 → 轻微上抬（挤到地板/天花板缝隙之上），仍不行则回出生点 ----
    this.y -= 3;
    if (this.deepestOverlap(solids, room)) {
      this.y += 3;
      // 找回出生点方向最近的可站立位置
      this.unstickToSpawn(solids, room, game);
    } else {
      this.grounded = false;
    }
    this.stuckT = 0;
  }

  /** 找穿透最深的那块 solid，返回 {axis, sign, depth} */
  deepestOverlap(solids, room) {
    let best = null;
    for (const s of solids) {
      const ox = Math.min(this.x + this.w, s.x + s.w) - Math.max(this.x, s.x);
      const oy = Math.min(this.y + this.h, s.y + s.h) - Math.max(this.y, s.y);
      if (ox <= 0 || oy <= 0) continue;
      const axis = ox < oy ? 'x' : 'y';
      const depth = axis === 'x' ? ox : oy;
      let sign;
      if (axis === 'x') sign = this.cx < s.x + s.w / 2 ? -1 : 1;
      else sign = this.cy < s.y + s.h / 2 ? -1 : 1;
      if (!best || depth > best.depth) best = { axis, sign, depth };
    }
    return best;
  }

  /** 尝试往四个方向小步移动，看哪个方向能脱离重叠 */
  trySlideOut(solids, room) {
    const step = 3;
    const tries = [
      { dx: -step, dy: 0 }, { dx: step, dy: 0 },
      { dx: 0, dy: -step }, { dx: 0, dy: step },
    ];
    // 优先尝试与当前速度垂直的方向（保留"横着溜走"的直觉）
    tries.sort((a, b) => Math.abs(b.dx * this.vx) - Math.abs(a.dx * this.vx));
    for (const t of tries) {
      const ox = this.x, oy = this.y;
      this.x += t.dx; this.y += t.dy;
      if (!this.deepestOverlap(solids, room)) return true;
      this.x = ox; this.y = oy;
    }
    return false;
  }

  /** 终极兜底：在出生点附近沿地面找回一个不重叠的位置 */
  unstickToSpawn(solids, room, game) {
    const sx = this.spawn.x, sy = this.spawn.y;
    for (let r = 0; r <= 12; r++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        this.x = sx + Math.cos(ang) * r * 8;
        this.y = sy + Math.sin(ang) * r * 8;
        if (!this.deepestOverlap(solids, room)) {
          this.vx = 0; this.vy = 0; this.remX = 0; this.remY = 0;
          return;
        }
      }
    }
    // 真的完全找不到 → 静默复位（宁可传送也不要永远卡死）
    this.reset();
  }

  /**
   * 被玩家从侧面推。
   *
   * ⚠️⚠️ 这里踩过一个**把整关玩废**的坑，改前务必读完 ⚠️⚠️
   * ------------------------------------------------------------------
   * 旧实现是 `this.vx = clamp(this.vx + dx * 46, -RUN_SPEED, RUN_SPEED)`。
   * 配合 `pushCrates` 里那句 `c.x += dir * min(overlapX, 40)` **每帧都执行**，
   * 会产生一个"速度泵"：
   *
   *   每帧 pushBy 把 vx 推高 `1.4 * 46 ≈ 64.4`，
   *   而箱子自身的阻尼 `approach(vx, 0, 900*dt)` 每帧只减 `15`。
   *   → 净效果是 vx **每帧还在加速**，一路顶到 `RUN_SPEED = 180` 上限后锁死。
   *
   * 实测（房间3 诊断探针）：
   *   `box.vx` 从 k=11 起就恒等于 **-180**，玩家松开方向键 **60 帧后依然是 -180**，
   *   箱子像被焊在玩家身上一样继续以全速往左滑 ——
   *   玩家根本**停不下来**，箱子一路滑过压力板、碾过减速带、
   *   最终撞在房间左墙上被 `resolveStuck` 判定为"彻底夹死"，
   *   触发兜底 `unstickToSpawn()` **瞬移回出生格** → 板灭 → 门关 → 本关报废。
   *
   * ✅ 正确做法：玩家只能给箱子一个**很轻的推力**，剩下的交给阻尼。
   *    箱子真正的位移来自 `pushCrates` 的位置修正（那是可解的、可停的），
   *    速度只需要"够它自己再溜一小段"即可。
   *
   * @param {number} dx  推力方向（±1 附近）
   * @param {number} [gain=4] 推力增益。默认 4（而不是 46）：
   *        箱子每帧大约获得 5~6 的速度，两帧内就被 900/s 的阻尼抹平，
   *        玩家一松手箱子立刻停住 —— 这才是"推箱子"该有的手感。
   */
  pushBy(dx, gain = 4) {
    this.vx = clamp(this.vx + dx * gain, -CFG.RUN_SPEED, CFG.RUN_SPEED);
  }

  /**
   * 「被玩家顶着走」的接触速度（供传送门速度闸使用）。
   *
   * ⚠️⚠️ 为什么需要它：`pushBy` 的 gain 只有 4，`vx` 恒定停在 ~4 ⚠️⚠️
   * ------------------------------------------------------------------
   * `PushBox.update()` 里 `approach(vx, 0, 900*dt)` 每帧把速度抹掉 15，
   * 而玩家推动时 `pushBy` 每帧只加 4 —— 于是 `vx` 的**平衡点就是 4**。
   * 箱子看起来在匀速走，但那个位移其实来自 `pushCrates` 里的**位置修正**
   * `c.x += dir * overlapX`，不是来自 `vx`。
   *
   * 这在推箱解谜里没问题，但**传送门的横向速度闸会被误判**：
   * `Portal.check()` 对箱子走 `pushIn` 分支，要求
   *   `|vLat| > minSpeed * 0.4 = 40 * 0.4 = 16`
   * 而横推时 `vLat` 正好就是 `vx = 4` → **4 < 16**，
   * 于是"玩家把箱子顶到传送门上"永远不触发传送
   * （实测：箱子被推到门前 8px 处贴住，portalCd 始终为 0，
   *   一路滑到隔墙上停住）。
   *
   * ✅ 修法：单独记录一个**只在接触帧有效**的"顶推速度" `pushSpeed`。
   *    它由 `pushCrates` 每帧写入（等于玩家当时的水平速度，上限 RUN_SPEED），
   *    一旦玩家脱离接触就立刻归零 —— 所以它**不会**像旧的 `vx` 那样
   *    "松手后还在飞"（那个坑见 `pushBy` 的注释）。
   *    传送门速度闸用它来判断"箱子正被主动顶着走"，物理运动仍然只用 `vx`，
   *    两套速度各司其职，互不污染。
   */
  pushSpeed(dir, playerVx) {
    // 只取沿推力方向的分量，避免玩家"侧身蹭过去"也被算成顶推
    const along = playerVx * dir;
    this.topPush = along > 0 ? Math.min(along, CFG.RUN_SPEED) : 0;
  }
}

/* ------------------------- 机关 ------------------------- */

class Signal {
  constructor(on = false) { this.on = on; this.t = 0; }
}

class Plate {
  /**
   * 压力板：有实体压住就通电。放在 (gx,gy) 格的地面上（板面贴该格底边）。
   *
   * @param {number} gx      左起格号
   * @param {number} gy      所在格行（板面贴 gy+1 行的上边缘）
   * @param {object} signal  信号对象
   * @param {number} [tw=1]  板**跨几格宽**（默认 1）。
   *   ⚠️ 为什么需要多格板：房间3 把板放进 2 格宽的坑底，箱子掉下来会
   *      在坑底继续往右滑半格。板只盖 1 格时，箱子会滑出触发区 → 板灭 → 门关。
   *      盖满整个坑底（tw=2）才稳。
   */
  constructor(gx, gy, signal, tw = 1) {
    this.gx = gx; this.gy = gy;
    this.tw = Math.max(1, tw | 0);
    this.signal = signal;
    this.pressed = false;
    this.anim = 0;
    this.w = 24 + (this.tw - 1) * CFG.TILE;
    this.h = 7;
    this.x = gx * CFG.TILE + (CFG.TILE - 24) / 2;
    // 板面顶边 = 该格底边 - 板高 → 板"趴"在地板上
    this.y = (gy + 1) * CFG.TILE - this.h;
  }
  /**
   * 触发判定区域：**整个格子宽**（不是只有板条那 24px）+ 板上方一点。
   *
   * ⚠️ 为什么必须放到整格宽（这是真机跑出来的 bug）：
   *   早先是 `this.x - 3, w: this.w + 6` → 只有 x=225..255（约 1 格里的中间部分）。
   *   推箱子关（房间3）里，箱子推进触发区、板亮了；玩家一松手，
   *   箱子因为阻尼回弹**滑到 6.50 格（中心 208px，箱体 198..218）**，
   *   整个箱体落在触发区**左边外面** → 板又灭了 → 门关上 → 玩家永远出不去。
   *   实测连续死亡 35 次，玩家被永久锁在左侧。
   *   放到整格宽之后，只要箱子"停在这一格上"板就一直是亮的，
   *   符合玩家的直觉（我看到箱子压在板上了），也不再出现"松手就灭"。
   *
   * 上边界 y - 6 → 让贴地走过的玩家也能触发（人的脚在板面上方 0~6px）。
   */
  get triggerRect() {
    return { x: this.gx * CFG.TILE, y: this.y - 6, w: CFG.TILE * this.tw, h: this.h + 7 };
  }
  update(dt, entities) {
    const r = this.triggerRect;
    let p = false;
    for (const e of entities) {
      if (!e) continue;
      if (aabb(e.box, r)) { p = true; break; }
    }
    if (p !== this.pressed) this.anim = 1;
    this.pressed = p;
    this.anim = Math.max(0, this.anim - dt * 5);
    this.signal.on = p;
  }
  draw(g) {
    const cx = this.x + this.w / 2;
    const drop = this.pressed ? 3 : 0;
    // 底座
    g.fillStyle = '#2a3446';
    g.fillRect(this.x - 2, this.y + this.h - 3, this.w + 4, 3);
    // 板面
    g.fillStyle = this.pressed ? '#2ecc9b' : '#57657f';
    g.fillRect(this.x, this.y + drop, this.w, this.h - drop);
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillRect(this.x, this.y + drop, this.w, 1.5);
    // 指示灯
    g.fillStyle = this.pressed ? '#7cffd4' : '#39445a';
    g.beginPath(); g.arc(cx, this.y - 3, 2.2, 0, 7); g.fill();
    if (this.anim > 0.01) {
      g.strokeStyle = `rgba(124,255,212,${this.anim * 0.7})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(cx, this.y, 10 + (1 - this.anim) * 14, 0, 7); g.stroke();
    }
  }
}

class SwitchLever {
  /** 拉杆：玩家/箱子碰到就翻转并保持 */
  constructor(gx, gy, signal) {
    this.gx = gx; this.gy = gy;
    this.signal = signal;
    this.flipped = false;
    this.anim = 0;
    this.cd = 0;
    this.x = gx * CFG.TILE + 16;
    this.y = gy * CFG.TILE + 16;
  }
  update(dt, entities) {
    this.cd = Math.max(0, this.cd - dt);
    this.anim = Math.max(0, this.anim - dt * 4);
    for (const e of entities) {
      if (!e) continue;
      const d = Math.hypot(e.cx - this.x, e.cy - this.y);
      if (d < 16 && this.cd <= 0) {
        this.flipped = !this.flipped;
        this.signal.on = this.flipped;
        this.cd = 0.35;
        this.anim = 1;
      }
    }
  }
  draw(g) {
    const on = this.flipped;
    g.save();
    g.translate(this.x, this.y);
    // 底座
    g.fillStyle = '#2a3446';
    g.fillRect(-8, 2, 16, 8);
    g.fillStyle = on ? '#2ecc9b' : '#57657f';
    g.fillRect(-8, 2, 16, 3);
    // 杆
    const ang = on ? -0.9 : 0.9;
    g.rotate(ang);
    g.strokeStyle = on ? '#7cffd4' : '#8b98b0';
    g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 4); g.lineTo(0, -13); g.stroke();
    g.fillStyle = on ? '#7cffd4' : '#b9c3d4';
    g.beginPath(); g.arc(0, -14, 3.4, 0, 7); g.fill();
    g.restore();
    if (this.anim > 0.01) {
      g.strokeStyle = `rgba(124,255,212,${this.anim * 0.6})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(this.x, this.y, 14 + (1 - this.anim) * 12, 0, 7); g.stroke();
    }
  }
}

class Gate {
  /** 门：signal.on 时打开（消失，不再阻挡） */
  constructor(gx, gy, w, h, signal, invert = false) {
    this.gx = gx; this.gy = gy;
    this.x = gx * CFG.TILE; this.y = gy * CFG.TILE;
    this.w = w * CFG.TILE; this.h = h * CFG.TILE;
    this.signal = signal;
    this.invert = invert;
    this.open = false;
    this.openAmt = 0;   // 0 关 1 全开
    this.active = true;
  }
  update(dt) {
    const want = this.invert ? !this.signal.on : this.signal.on;
    this.open = want;
    this.openAmt = damp(this.openAmt, want ? 1 : 0, 12, dt);
    // 完全打开后才不阻挡
    this.active = this.openAmt < 0.72;
  }
  /** 当前实际碰撞矩形（随开合缩放，但保持"要开就全开"的手感不阻塞） */
  get solidRect() {
    if (!this.active) return null;
    // 关着：整块；正在开：主体缩到边缘，避免把玩家卡住
    return { x: this.x, y: this.y, w: this.w, h: this.h, active: true, isGate: true };
  }
  draw(g) {
    const a = 1 - this.openAmt;
    if (a <= 0.02) {
      // 完全打开：只留门框轮廓
      g.strokeStyle = 'rgba(110,125,150,.35)';
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeRect(this.x + .5, this.y + .5, this.w - 1, this.h - 1);
      g.setLineDash([]);
      return;
    }
    g.save();
    g.globalAlpha = a;
    const grd = g.createLinearGradient(this.x, this.y, this.x, this.y + this.h);
    grd.addColorStop(0, '#5a4a7a');
    grd.addColorStop(1, '#3a2f57');
    g.fillStyle = grd;
    g.fillRect(this.x, this.y, this.w, this.h);
    // 能量纹路
    g.strokeStyle = 'rgba(160,130,255,.5)';
    g.lineWidth = 1;
    for (let y = this.y + 6; y < this.y + this.h; y += 9) {
      g.beginPath(); g.moveTo(this.x + 2, y); g.lineTo(this.x + this.w - 2, y); g.stroke();
    }
    g.strokeStyle = 'rgba(190,165,255,.85)';
    g.lineWidth = 2;
    g.strokeRect(this.x + 1, this.y + 1, this.w - 2, this.h - 2);
    g.restore();
  }
}

class MovingBlock {
  /** 信号驱动的移动方块：在 a↔b 间往返，可当作平台/推挤器 */
  constructor(gx, gy, w, h, dx, dy, signal, speed = 1.6) {
    this.x0 = gx * CFG.TILE; this.y0 = gy * CFG.TILE;
    this.tx = (gx + dx) * CFG.TILE; this.ty = (gy + dy) * CFG.TILE;
    this.x = this.x0; this.y = this.y0;
    this.w = w * CFG.TILE; this.h = h * CFG.TILE;
    this.signal = signal;
    this.speed = speed;
    this.p = 0; this.dir = 1;
    this.dxPrev = 0; this.dyPrev = 0;
    this.active = true;
  }
  update(dt) {
    const target = this.signal.on ? 1 : 0;
    const prevX = this.x, prevY = this.y;
    // 平滑逼近
    const rate = this.speed * (this.signal.on ? 0.55 : 1);
    this.p = damp(this.p, target, rate * 3.4, dt);
    this.x = lerp(this.x0, this.tx, this.p);
    this.y = lerp(this.y0, this.ty, this.p);
    this.dxPrev = this.x - prevX;
    this.dyPrev = this.y - prevY;
  }
  get solidRect() { return { x: this.x, y: this.y, w: this.w, h: this.h, active: true, isMoving: true, ref: this }; }
  draw(g) {
    const grd = g.createLinearGradient(this.x, this.y, this.x, this.y + this.h);
    grd.addColorStop(0, '#4b5568');
    grd.addColorStop(1, '#333c4c');
    g.fillStyle = grd;
    g.fillRect(this.x, this.y, this.w, this.h);
    g.strokeStyle = this.signal.on ? 'rgba(124,255,212,.85)' : 'rgba(140,155,180,.5)';
    g.lineWidth = 2;
    g.strokeRect(this.x + 1, this.y + 1, this.w - 2, this.h - 2);
    g.fillStyle = this.signal.on ? 'rgba(124,255,212,.25)' : 'rgba(255,255,255,.06)';
    g.fillRect(this.x + 3, this.y + 3, this.w - 6, 4);
  }
}

class Crystal {
  /** 空中水晶：接触即补充**一次空中跳**（原"冲刺水晶"，取消冲刺后改造）
   *
   *  ★ 第十三版：冲刺被整体移除，水晶原来的"补冲刺"职能失效。
   *    但水晶在 10 个房间的**地图数据里已经存在**（`'o'` 格），
   *    直接删掉会让所有关卡少一个视觉地标和路线暗示。
   *    所以把它改造成「**空中跳**（air jump）」的补给点：
   *      · 落地时自动恢复 1 次
   *      · 吃水晶也恢复 1 次
   *      · 空中按跳时若有次数 → 获得一次"二段跳"
   *    这样在没有冲刺之后，玩家依然有一个可靠的空中微调手段，
   *    而且它比冲刺**可控得多**（只有 1 次、高度和普通跳一致），
   *    不会像冲刺那样把平衡打穿。 */
  constructor(gx, gy, respawn = 2.2) {
    this.gx = gx; this.gy = gy;
    this.x = gx * CFG.TILE + 16;
    this.y = gy * CFG.TILE + 16;
    this.respawn = respawn;
    this.timer = 0;
    this.t = Math.random() * 6;
  }
  update(dt, game) {
    this.t += dt;
    if (this.timer > 0) { this.timer -= dt; return; }
    const p = game.player;
    if (Math.hypot(p.cx - this.x, p.cy - this.y) < 15) {
      if (p.airJumps < CFG.AIR_JUMP_MAX) {
        p.airJumps = CFG.AIR_JUMP_MAX;
        this.timer = this.respawn;
        game.fx.crystalBurst(this.x, this.y);
        game.audio?.crystal();
      }
    }
    // 箱子也能吃到？不需要。留给玩家。
  }
  draw(g) {
    if (this.timer > 0) {
      // 冷却残影
      g.strokeStyle = 'rgba(120,170,255,.18)';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(this.x, this.y, 7, 0, 7); g.stroke();
      return;
    }
    const s = 1 + Math.sin(this.t * 3) * 0.09;
    g.save();
    g.translate(this.x, this.y + Math.sin(this.t * 2) * 2);
    g.rotate(this.t * 0.9);
    g.scale(s, s);
    const grd = g.createRadialGradient(0, 0, 1, 0, 0, 11);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.4, '#79b6ff');
    grd.addColorStop(1, 'rgba(70,130,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill();
    g.fillStyle = '#e8f3ff';
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 0); g.lineTo(0, 7); g.lineTo(-5, 0);
    g.closePath(); g.fill();
    g.restore();
  }
}

class Goal {
  constructor(gx, gy) {
    this.x = gx * CFG.TILE + 16; this.y = gy * CFG.TILE + 16;
    this.t = 0;
  }
  /**
   * 终点判定。
   *
   * ⚠️⚠️ 这里踩过一个"玩家明明冲过去了却不过关"的坑，改前务必读完 ⚠️⚠️
   * ------------------------------------------------------------------
   * 旧实现是 `Math.hypot(p.cx - this.x, p.cy - this.y) < 14` ——
   * 一个**半径仅 0.44 格**的圆，还只比玩家**中心点**。
   *
   * 蔚蓝式平台跳跃里，玩家抵达终点几乎总是「高速腾空飞过来」的：
   * 起跳时最高能到离地 3.7 格，横向一帧能走 3px。
   * 实测房间3：玩家从 x=22 的刺起跳，弧线顶点在 py≈11（离终点行 14 有 3 格高），
   * 一路飞到 px≈25.5 才落回终点所在的行 —— 此时离终点中心已经 **68px 远**。
   * 结果就是：玩家肉眼看着自己"冲过终点了"，引擎却判定没碰到，
   * 继续往右走到墙上卡住，**永远过不了关**。
   *
   * ✅ 正确做法：用玩家的**整个碰撞盒**（不是中心点）去撞终点的**整格矩形**。
   *    只要身体任何一个部位进过终点格，就算抵达 —— 这也符合玩家直觉：
   *    "我碰到那个金色的球了"。
   *    顺带把判定格稍微放大到 1.25 格（半径 20px），
   *    让高速掠过时也不会因为"一帧跨过整格"而漏判（最坏一帧 3px，绰绰有余）。
   */
  update(dt, game) {
    this.t += dt;
    const p = game.player;
    const b = p.box;                       // 玩家碰撞盒（11×15）
    const half = CFG.TILE * 0.62;          // 终点判定半边长 ≈ 19.8px
    const hit = b.x < this.x + half && b.x + b.w > this.x - half &&
                b.y < this.y + half && b.y + b.h > this.y - half;
    if (hit) game.win();
  }
  draw(g) {
    const t = this.t;
    g.save();
    g.translate(this.x, this.y);
    for (let i = 0; i < 3; i++) {
      const r = 9 + i * 5 + Math.sin(t * 2.4 - i * 0.8) * 2.4;
      g.strokeStyle = `rgba(255,215,120,${0.75 - i * 0.2})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke();
    }
    const grd = g.createRadialGradient(0, 0, 1, 0, 0, 10);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.5, '#ffd76e');
    grd.addColorStop(1, 'rgba(255,180,60,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, 10, 0, 7); g.fill();
    g.restore();
  }
}

class Hazard {
  /** 尖刺 / 危险区：碰到死亡 */
  constructor(gx, gy, w, h, type = 'spike') {
    this.x = gx * CFG.TILE; this.y = gy * CFG.TILE;
    this.w = w * CFG.TILE; this.h = h * CFG.TILE;
    this.type = type;
    this.t = Math.random() * 3;
  }
  update(dt) { this.t += dt; }
  draw(g) {
    if (this.type === 'spike') {
      g.fillStyle = '#e0574f';
      g.beginPath();
      const n = Math.round(this.w / 10);
      const step = this.w / n;
      for (let i = 0; i < n; i++) {
        const x0 = this.x + i * step;
        g.moveTo(x0, this.y + this.h);
        g.lineTo(x0 + step / 2, this.y);
        g.lineTo(x0 + step, this.y + this.h);
      }
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.fillRect(this.x, this.y + this.h - 2, this.w, 2);
    } else {
      // 岩浆/虚空
      const grd = g.createLinearGradient(0, this.y, 0, this.y + this.h);
      grd.addColorStop(0, 'rgba(255,110,80,.85)');
      grd.addColorStop(1, 'rgba(180,40,60,.95)');
      g.fillStyle = grd;
      const wob = Math.sin(this.t * 3) * 2;
      g.beginPath();
      g.moveTo(this.x, this.y + 3 + wob);
      g.quadraticCurveTo(this.x + this.w / 2, this.y - 3 - wob, this.x + this.w, this.y + 3 + wob);
      g.lineTo(this.x + this.w, this.y + this.h);
      g.lineTo(this.x, this.y + this.h);
      g.closePath(); g.fill();
    }
  }
}

/**
 * TextHint —— 世界内的浮动文字提示。
 * 玩家靠近时淡入，带一个小箭头朝下指，避免"提示浮在空中不知道指哪"。
 */
class TextHint {
  constructor(gx, gy, text, once = false) {
    this.x = gx * CFG.TILE + CFG.TILE / 2;
    this.y = gy * CFG.TILE + CFG.TILE / 2;
    this.text = text; this.once = once;
    this.seen = false;      // once 模式下是否已经展示过
    this.alpha = 0;         // 淡入淡出
    this.t = 0;
    this.w = 0;             // 由渲染层回填的文字宽度
  }
  update(dt, game) {
    this.t += dt;
    const p = game.player;
    const dx = p.cx - this.x, dy = p.cy - this.y;
    // dy > 0 表示玩家在提示的下方（提示浮在玩家头顶）。
    // 纵向容差给到 1.5 格，横向 3.5 格，保证走到"跟前"就能看到。
    const near = Math.abs(dx) < 112 && dy > -60 && dy < 170;
    const want = near && (!this.once || !this.seen) ? 1 : 0;
    if (near) this.seen = true;
    // 淡入 0.25s / 淡出 0.4s
    this.alpha = approach(this.alpha, want, dt * (want > this.alpha ? 4 : 2.5));
    if (this.alpha < 0.002) this.alpha = 0;
  }
}

