/* ============================================================
   Player —— 玩家控制器
   基础手感清单：
     ✓ 落地挤压 / 起跳拉伸（视觉反馈）
     ✓ coyote time（离地 0.10s 内仍可跳）
     ✓ jump buffer（落地前 0.13s 按跳会记住）
     ✓ 可变跳跃高度（松手剪切）
     ✓ 顶点重力衰减（滞空"悬停"感）
     ✓ 快速下落
     ✓ 转身加速加成、空中最小摩擦力（保留动量但可微调）

   位移手段（**没有冲刺**）：
     ✓ 走 / 跑 / 跳
     ✓ 传送门惯性  —— 从高处坠进门 → 高速甩出，且方向键不再刹车
     ✓ 墙跳 / 墙滑        : 贴墙下滑减速，可蹬墙反向弹开
     ✓ 攀爬               : 贴墙按上缓慢上移（有体力 + 单次上升上限）

   ★ 第十三版：**彻底移除冲刺（dash）**。
     用户原话：「取消冲刺（太影响平衡了，且传送门无法在墙上放置，
     而且惯性经常没有，彻底修复这个问题）」。
     移除范围：冲刺本体 / 冲刺次数 / 冲刺水晶补充 / 凌波微步 / 超级跳
     （后两个都是冲刺的衍生动作，冲刺没了它们也无从谈起）。
     位移完全交给「跳跃 + 传送门惯性 + 墙跳」，传送门成为唯一的长距离手段。
   ============================================================ */

class Player extends Actor {
  constructor(x, y) {
    super(x, y, CFG.P_W, CFG.P_H);
    this.alive = true;
    this.respawn = { x, y };
    this.trail = [];
    this.animT = 0;
    this.coyoteFx = 0;
    this.jumpFx = 0;
    this.landFxV = 0;
    this.crouch = 0;
    this.inPortalAnim = 0;
    this.wallSlide = false;
    this.wallDir = 0;        // 贴墙方向：-1 左侧 / +1 右侧
    this.climbing = false;
    this.stamina = CFG.CLIMB_STAMINA;
    this.climbStartY = null;   // 攀爬起点（一次攀爬的硬上限用，见 updateWallState）
    this.airJumps = CFG.AIR_JUMP_MAX;   // 空中跳次数（落地/吃水晶补充）
    // 进阶动作的"发光"提示状态（渲染层用来画特效）
    this.wallJumpFx = 0;
    this.airJumpFx = 0;
  }

  reset(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.remX = 0; this.remY = 0;
    this.grounded = false; this.coyote = 0; this.jumpBuffer = 0;
    this.jumping = false; this.portalCd = 0; this.alive = true;
    this.trail.length = 0;
    this.squashX = 1; this.squashY = 1;
    this.wallDir = 0; this.wallSlide = false; this.climbing = false;
    this.stamina = CFG.CLIMB_STAMINA;
    this.climbStartY = null;
    this.wallCoyote = 0; this.wallLock = 0;
    this.wallJumpFx = 0;
    this.airJumpFx = 0;
    this.airJumps = CFG.AIR_JUMP_MAX;
  }

  /** 是否还能空中跳（HUD 用） */
  get airJumpUsable() { return this.airJumps > 0; }

  update(dt, input, game, solids) {
    const room = game.room;
    this.animT += dt;
    this.portalCd = Math.max(0, this.portalCd - dt);
    this.jumpFx = Math.max(0, this.jumpFx - dt * 4);
    this.coyoteFx = Math.max(0, this.coyoteFx - dt * 5);
    this.squashX = damp(this.squashX, 1, 14, dt);
    this.squashY = damp(this.squashY, 1, 14, dt);
    this.inPortalAnim = Math.max(0, this.inPortalAnim - dt * 3);
    this.wallJumpFx = Math.max(0, this.wallJumpFx - dt * 3);
    this.airJumpFx = Math.max(0, this.airJumpFx - dt * 4);
    if (this.wallLock > 0) this.wallLock -= dt;

    this.wasGrounded = this.grounded;
    this.onGroundThisStep = false;

    // 记录本步起始位置（供传送门扫掠判定使用）
    this._prevCx = this.cx; this._prevCy = this.cy;

    // ---------- 计时器 ----------
    if (this.grounded) {
      this.coyote = CFG.COYOTE;
      this.airJumps = CFG.AIR_JUMP_MAX;   // ★ 落地恢复空中跳
      // ★ 体力只在**落地**时回满。墙跳不刷新（见 doWallJump），
      //   否则"墙跳 → 攀爬 → 墙跳 → 攀爬"可以无限爬升，把整张图爬穿。
      this.stamina = CFG.CLIMB_STAMINA;
      this.climbStartY = null;
      this.climbing = false;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
    }

    if (input.hit('jump')) this.jumpBuffer = CFG.JUMP_BUFFER;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // ---------- 贴墙检测（用于墙跳 / 墙滑 / 攀爬） ----------
    this.updateWallState(dt, input, solids, room);

    // ---------- 跳跃输入 ----------
    const wantJump = this.jumpBuffer > 0 && (this.grounded || this.coyote > 0);
    if (wantJump) {
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.vy = -CFG.JUMP_SPEED;
      this.jumping = true;
      this.jumpHoldT = 0;
      this.jumpFx = 1;
      this.squashX = 0.78; this.squashY = 1.26;
      game.audio?.jump();
      game.fx.jumpDust(this.cx, this.cy + this.h / 2);
      if (this.coyoteFx > 0) game.fx.coyotePuff(this.cx, this.cy + this.h / 2);
    } else if (this.jumpBuffer > 0 && !this.grounded && this.wallCoyote > 0 && this.wallDir !== 0) {
      // ---------- 墙跳 ----------
      this.jumpBuffer = 0;
      this.doWallJump(-this.wallDir);
      game.audio?.jump();
      game.shake(2.2, 0.1);
    } else if (this.jumpBuffer > 0 && !this.grounded && this.coyote <= 0
               && this.wallCoyote <= 0 && this.airJumps > 0) {
      // ---------- 空中跳（取消冲刺后的空中微调手段） ----------
      // ★ 优先级最低：coyote / 墙跳都不成立时才用它，避免抢掉正常跳跃手感。
      //   高度和普通跳完全一致（同一套重力曲线），只是多给一次机会。
      this.jumpBuffer = 0;
      this.airJumps--;
      this.jumping = true;
      this.jumpHoldT = 0;
      this.vy = -CFG.AIR_JUMP_SPEED;
      this.jumpFx = 1;
      this.airJumpFx = 1;
      this.squashX = 0.82; this.squashY = 1.22;
      game.audio?.airJump();
      game.fx.airJumpPuff(this.cx, this.cy + this.h / 2);
    }

    // 松手剪切（可变跳跃高度）：按得越久跳得越高
    // 但要保证"轻点"也有一个爽快的最低跳跃高度
    if (this.jumping && !input.down('jump') && this.vy < 0) {
      // 只有在已经上升了一小段后才允许剪切，避免刚起跳就松开导致跳不起来
      const minKeep = -CFG.JUMP_END_MIN;
      if (this.vy < minKeep) this.vy = minKeep;
      else this.vy = Math.max(this.vy * CFG.JUMP_CUT, minKeep);
      this.jumping = false;
    }

    // ---------- 水平移动 ----------
    this.movementX(dt, input, game);

    // ---------- 重力 ----------
    this.applyGravity(dt, input);

    // 终端速度
    let maxFall = CFG.MAX_FALL;
    if (input.down('down') && !this.grounded) maxFall = CFG.FAST_FALL_MAX;
    if (this.wallSlide) maxFall = Math.min(maxFall, CFG.WALL_SLIDE_SPEED);
    if (this.climbing) maxFall = 0;
    if (this.vy > maxFall) this.vy = maxFall;

    // ---------- 位移 ----------
    const prevVy = this.vy;
    this.grounded = false;
    this.moveX(this.vx * dt, solids, room);

    // 传送门（水平穿墙式门在移动前检测更稳，这里放在Y之前统一处理）
    game.portals.check(this, game);

    this.moveY(this.vy * dt, solids, room);
    game.portals.check(this, game);

    // 稳定接地判定：脚下 1px 内有实心就算站在地上
    // （避免"站立时 vy 四舍五入为 0 → grounded 反复抖动"导致跳跃失效）
    if (!this.grounded && this.vy >= 0 && this.checkGround(solids, room)) {
      this.grounded = true;
      this.vy = 0;
    }

    if (this.grounded) {
      if (!this.wasGrounded) {
        // 落地：形变 + 粒子 + 音效
        const impact = clamp(Math.abs(prevVy) / CFG.MAX_FALL, 0, 1);
        if (impact > 0.18) {
          this.squashX = 1 + 0.3 * impact;
          this.squashY = 1 - 0.32 * impact;
          game.fx.landDust(this.cx, this.cy + this.h / 2, impact);
          game.audio?.land(impact);
          if (impact > 0.75) game.shake(2.4 * impact, 0.1);
        }
      }
      this.landFxV = 0;
    }

    // 轨迹（表现层）
    if (Math.hypot(this.vx, this.vy) > 300) {
      this.trail.push({ x: this.cx, y: this.cy, t: 0.22 });
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].t -= dt;
      if (this.trail[i].t <= 0) this.trail.splice(i, 1);
    }
    if (this.trail.length > 40) this.trail.splice(0, this.trail.length - 40);
  }

  doWallJump(away) {
    this.vx = away * CFG.WALL_JUMP_X;
    this.vy = -CFG.WALL_JUMP_Y;
    this.facing = away;
    this.jumping = true;
    this.jumpHoldT = 0;
    this.wallLock = CFG.WALL_JUMP_LOCK;
    this.wallSlide = false;
    this.climbing = false;
    this.squashX = 0.8; this.squashY = 1.24;
    this.wallJumpFx = 1;
    this.jumpFx = 1;
  }

  /** 贴墙状态：左右各探一次 */
  updateWallState(dt, input, solids, room) {
    this.wallCoyote = Math.max(0, this.wallCoyote - dt);
    if (this.grounded) { this.wallSlide = false; this.climbing = false; return; }

    const probe = 3;
    const leftBox = { x: this.x - probe, y: this.y + 2, w: probe, h: this.h - 4 };
    const rightBox = { x: this.x + this.w, y: this.y + 2, w: probe, h: this.h - 4 };
    let dir = 0;
    if (this.solidAt(leftBox, solids, room)) dir = -1;
    else if (this.solidAt(rightBox, solids, room)) dir = 1;

    this.wallDir = dir;
    if (dir === 0) { this.wallSlide = false; this.climbing = false; return; }

    this.wallCoyote = CFG.WALL_COYOTE;
    // 只有"朝墙推"或"什么都不按"时才贴墙下滑；反向推 = 主动离开
    const pushing = input.ax === dir;
    const holding = input.ax === 0 || pushing;

    // 攀爬：按住"上"且有体力
    // ★ 第十二版：额外加一道**硬上限** —— 一次攀爬（从松手/落地算起）
    //   总共只能上升 CLIMB_MAX_RISE 像素。即使体力没耗完也不许再往上，
    //   彻底堵死"贴着一面长墙慢慢爬到顶"的偷鸡路径。
    if (this.climbStartY === null || this.climbStartY === undefined) this.climbStartY = this.y;
    const climbed = this.climbStartY - this.y;   // 已上升了多少像素
    if (holding && input.down('up') && this.stamina > 0 && climbed < CFG.CLIMB_MAX_RISE) {
      this.climbing = true;
      this.wallSlide = false;
      this.vy = -CFG.CLIMB_SPEED;
      this.stamina -= dt;
      if (this.stamina <= 0) this.climbing = false;
    } else if (holding && this.vy > 0) {
      this.climbing = false;
      this.wallSlide = true;
    } else {
      this.climbing = false;
      this.wallSlide = false;
    }
    // 离开攀爬状态（落回地面 / 松开上键）时，重置攀爬基准点，
    // 这样"落地重新跳"是允许的（那次上升靠的是跳跃，不是爬）
    if (!this.climbing && this.vy > 0) this.climbStartY = this.y;
  }

  solidAt(box, solids, room) {
    for (const s of solids) {
      if (s && s.active && aabb(box, s)) return true;
    }
    return false;
  }

  movementX(dt, input, game) {
    const ax = this.wallLock > 0 ? 0 : input.ax;
    if (input.ax !== 0) this.facing = input.ax;

    const accel = this.grounded ? CFG.RUN_ACCEL : CFG.AIR_ACCEL;
    const decel = this.grounded ? CFG.RUN_DECEL : CFG.AIR_DECEL;

    /* ★★★ 超速保护：这是"传送门惯性经常没有"的真凶 ★★★
       ------------------------------------------------------------------
       旧实现把"按方向键"和"不按方向键"都当成普通走路处理：
           if (ax !== 0)  this.vx = approach(this.vx, ax*RUN_SPEED, ...);
           else           this.vx = approach(this.vx, 0, friction);
       问题：玩家从传送门出来时 vx 高达 620，而**按住 → 是玩家的本能操作**。
       一旦按住方向键，`target = 180`，620 就被 approach 硬拉向 180 ——
       实测 **20 帧（0.33 秒）就从 620 掉到 180**，71% 的惯性凭空消失。
       玩家的体感就是："我明明从高处冲进门了，出来却飞不远。"
       （而且"不按方向键"反而衰减更慢，导致"必须松手才有惯性"这种反直觉操作。）

       ✅ 正确做法：**超过跑速时，方向键只做"微调"，不做"刹车"。**
          · 顺着当前运动方向按 → 保持速度（不加速也不减速）
          · 逆着当前运动方向按 → 给一个**温和**的逆向加速度（可以减速，但不瞬停）
          · 松手 → 摩擦也按"超速专用"的低值走，让惯性自然持续
          参考值 PORTAL_INERTIA_KEEP = 1.2s：以这个时间尺度把超速部分
          （|vx| - RUN_SPEED）指数衰减回跑速，手感接近蔚蓝。 */
    const overSpeed = Math.abs(this.vx) > CFG.RUN_SPEED + 1;
    if (overSpeed) {
      const dirNow = sign(this.vx);
      const keepSec = CFG.PORTAL_INERTIA_KEEP || 1.2;
      if (ax === 0) {
        // 松手：惯性自然衰减（以 keepSec 为时间常数）
        const excess = Math.abs(this.vx) - CFG.RUN_SPEED;
        const decayed = excess * Math.exp(-dt / keepSec);
        this.vx = dirNow * (CFG.RUN_SPEED + decayed);
      } else if (ax === dirNow) {
        // 顺着飞 → 保持速度，不刹车（这是"惯性留住"的关键）
        const excess = Math.abs(this.vx) - CFG.RUN_SPEED;
        const decayed = excess * Math.exp(-dt / (keepSec * 1.6));
        this.vx = dirNow * (CFG.RUN_SPEED + decayed);
      } else {
        // 逆着飞 → 允许减速，但用"超速专用"的温和加速度，
        // 避免一按反方向就把 620 瞬间抹平（那也是反直觉的）
        const brake = CFG.AIR_TURN_BRAKE * dt;
        const newAbs = Math.abs(this.vx) - brake;
        this.vx = newAbs <= CFG.RUN_SPEED ? dirNow * newAbs : dirNow * newAbs;
        if (Math.abs(this.vx) < CFG.RUN_SPEED) {
          // 已经降到跑速以内 → 交回普通移动逻辑（下面 else 分支下一帧会接管）
          this.vx = approach(this.vx, ax * CFG.RUN_SPEED, accel * dt);
        }
      }
      return;
    }

    if (ax !== 0) {
      const target = ax * CFG.RUN_SPEED;
      // 反向输入时加速加成 → 转身干脆
      const turning = sign(this.vx) !== 0 && sign(this.vx) !== ax;
      const a = accel * (turning ? CFG.TURN_BOOST : 1);
      this.vx = approach(this.vx, target, a * dt);
    } else {
      if (this.grounded) {
        this.vx = approach(this.vx, 0, CFG.GROUND_FRICTION * dt);
      } else {
        // 空中保留动量：摩擦很弱，小输入仍可微调
        this.vx = approach(this.vx, 0, CFG.AIR_FRICTION_MIN * dt);
      }
    }
  }

  applyGravity(dt, input) {
    if (this.climbing) return;
    const pressingDown = input.down('down');
    const v = this.vy;

    if (v < 0) {
      // 上升
      if (this.jumping && this.jumpHoldT < CFG.JUMP_H_HOLD && input.down('jump')) {
        this.jumpHoldT += dt;
        this.vy += CFG.GRAV_JUMP_HOLD * dt;
      } else {
        this.jumping = false;
        const nearApex = Math.abs(v) < CFG.APEX_THRESH;
        this.vy += (nearApex ? CFG.GRAV_APEX : CFG.GRAV) * dt;
      }
    } else {
      // 下落
      const nearApex = Math.abs(v) < CFG.APEX_THRESH && !pressingDown;
      this.vy += (nearApex ? CFG.GRAV_APEX : CFG.GRAV_FALL) * dt;
      if (pressingDown && !this.grounded) this.vy += CFG.FAST_FALL * dt;
      // 贴墙下滑：重力大幅减弱，形成"扒住墙"的感觉
      if (this.wallSlide) this.vy -= CFG.GRAV_FALL * 0.75 * dt;
    }
    // 限制上升初速不被重力吃掉太多（防止低帧率下手感差异）
    if (this.vy < -CFG.JUMP_SPEED * 1.2) this.vy = -CFG.JUMP_SPEED * 1.2;
  }
}
