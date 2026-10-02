/* ============================================================
   传送门系统
   ------------------------------------------------------------
   核心：出门时把"入射速度"在入射门局部坐标系下分解，再映射到
   出口门的局部坐标系。这样：
     垂直冲进地板上的门  →  从墙上的门水平射出
     高处坠落获得的 vy     →  完整变成 vx（惯性保留，不会衰减）
   数学上：v_out = fwd_out * (-n_in·v_in) + right_out * (t_in·v_in)
   ============================================================ */

class Portal {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;      // 门中心（世界坐标）
    this.d = 0;                  // 朝向：0上 1右 2下 3左（法线方向）
    this.roomId = null;          // 所属房间（支持跨房间）
    this.color = '#4ee2ff';
    this.wobble = 0;             // 视觉抖动
    this.spin = 0;
  }
  get dir() { return DIR[this.d]; }
  get normal() { return DIR[this.d]; }           // 法线（指向房间内侧）
  get tangent() { return { x: -DIR[this.d].y, y: DIR[this.d].x }; } // 沿门面的切向

  /** 门在局部坐标下的半宽半高 */
  get halfW() { return this.d === 0 || this.d === 2 ? CFG.PORTAL_R : 3; }
  get halfH() { return this.d === 0 || this.d === 2 ? 3 : CFG.PORTAL_R; }

  /** 门框矩形 */
  get rect() {
    return { x: this.x - this.halfW, y: this.y - this.halfH, w: this.halfW * 2, h: this.halfH * 2 };
  }

  place(x, y, d, roomId) {
    this.active = true;
    this.x = x; this.y = y; this.d = d; this.roomId = roomId;
    this.wobble = 1;
  }

  /** 判断某实体（圆近似为 AABB 重叠）是否正压在门面上 */
  overlaps(box, pad = 0) {
    const r = this.rect;
    const p = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    return aabb(box, p);
  }
}

class PortalPair {
  constructor() {
    this.a = new Portal();
    this.b = new Portal();
    this.a.color = '#4ee2ff';   // 青
    this.b.color = '#ff9f43';   // 橙
  }

  /** 找出口 */
  other(p) { return p === this.a ? this.b : this.a; }

  /** 两个门是否都激活且不重叠 */
  get ready() { return this.a.active && this.b.active; }

  clear() { this.a.active = false; this.b.active = false; }

  /** 清除属于某房间的门（房间切换时可选调用） */
  clearRoom(rid) {
    if (this.a.active && this.a.roomId === rid) this.a.active = false;
    if (this.b.active && this.b.roomId === rid) this.b.active = false;
  }

  /**
   * 传送一个实体。
   *
   * ★ 第十二版：出门速度做「增益 + 保底」，让传送门成为真正的位移主力
   *   （玩家的原话：「冲刺太强了导致传送门都没用了」「可以加强传送」）。
   *   · 增益 PORTAL_EXIT_BOOST = 1.2：同一段坠落高度，从门射出去比冲刺远得多，
   *     而且高度越高收益越大 —— 这正是"惯性玩法"应有的正反馈。
   *   · 保底 PORTAL_EXIT_MIN = 150：慢悠悠蹭进门也不会"出门即落地"，
   *     保证门的可操作性（否则低速进门 = 白穿一次）。
   *   · 保底只作用在**法线方向**（真正的"射出去"分量），
   *     切向分量照旧 —— 不然过门会变成"自动加速"，手感变怪。
   *
   * @returns true 表示发生了传送
   */
  transport(actor, entry, exit, game) {
    const nIn = entry.normal, tIn = entry.tangent;
    const nOut = exit.normal, tOut = exit.tangent;

    // 1) 入射速度在入射门坐标系下的分量
    const vn = actor.vx * nIn.x + actor.vy * nIn.y;   // 沿法线（进门的深度分量）
    const vt = actor.vx * tIn.x + actor.vy * tIn.y;   // 沿门面（横向滑过分量）

    // 2) 出射速度 = 出口法线方向 * (-vn) + 出口切向 * vt
    //    -vn：进门时是"向内"，出门时变成"向外"
    //    ★ 增益 + 保底只加在法线上，且增益随入射速度**线性增长**：
    //      慢进门 → 小幅增益（不会突然弹飞）
    //      快进门 → 大幅增益（深井坠落收益爆炸，"下落越久射得越远"）
    //      之所以要"随速度增长"，是因为 MAX_FALL 终端速度会把深井的收益抹平
    //      （实测：坠落 ≥3 格进门速度全都是 552），必须靠倍率拉开差距。
    const boost = CFG.PORTAL_EXIT_BOOST *
      (1 + clamp(Math.abs(vn) / CFG.MAX_FALL, 0, 1) * CFG.PORTAL_EXIT_BOOST_RAMP);
    let speedN = -vn * boost;
    if (speedN < CFG.PORTAL_EXIT_MIN) speedN = CFG.PORTAL_EXIT_MIN;
    // 上限保护：避免极端速度穿墙（贴着墙出门会瞬移出门框）
    if (speedN > CFG.PORTAL_EXIT_MAX) speedN = CFG.PORTAL_EXIT_MAX;
    actor.vx = nOut.x * speedN + tOut.x * vt;
    actor.vy = nOut.y * speedN + tOut.y * vt;

    // 3) 位置：沿出口法线推出到门外
    /* ★★★ 出门位置必须"清空出口门自己的判定圈"，否则会无限弹射 ★★★
       ------------------------------------------------------------------
       血泪史（房间6「箱子过门」整关报废）：
         出口位置原本固定 = PORTAL_EXIT_PUSH(14px)。但出口门的判定半宽
         halfGate = max(4, PORTAL_R - w/2)。对箱子（w=20）→ halfGate = 11，
         而箱子半宽 10，于是箱子中心只要落在出口门中心 ±21px 内，
         **它自己就骑在出口门的判定圈里**。
         PORTAL_COOLDOWN = 0.12s 一过，箱子 vy 被重力拉起来一点点，
         立刻满足速度闸 → 又被同一扇门吸回去 → 从入口门重新出来。
         实测轨迹：x = 12.77 ↔ 15.37 每 12 帧弹射一次，永远压不到压力板。
         `_lastEntry` 位置屏蔽只能"拖住"它，不能解决 ——
         因为箱子被 pushCrates 顶推时的 topPush 会绕过 **_lastEntry 之前的**
         那些闸门判定（pushIn 分支），屏蔽形同虚设。

       ✅ 唯一可靠的做法：**把实体放到出口门判定圈之外**。
          距离 = halfGate + 实体半厚度 + 余量(PORTAL_EXIT_CLEAR)。
          这样它出门后天然离门面足够远，既不会被回吸，
          也符合"从门里被喷出来"的直觉。 */
    const exitHalfGate = Math.max(4, CFG.PORTAL_R - actor.w * 0.5);
    // 出口门法线方向的"实体半厚度"：地板/天花板门看半高，墙面门看半宽
    const exitFloorish = exit.d === 0 || exit.d === 2;
    const thick = exitFloorish ? actor.h / 2 : actor.w / 2;
    const pushOut = Math.max(
      CFG.PORTAL_EXIT_PUSH + 1,
      exitHalfGate + thick + (CFG.PORTAL_EXIT_CLEAR || 0)
    );

    // 但"沿切向保持相对偏移"可能把实体横向甩到门框边缘之外，
    // 那样即使法向距离够了，切向仍在判定圈里 → 同样会被回吸。
    // 所以再夹一次：切向偏移最多到「判定半宽 - 余量」。
    const latCap = Math.max(0, exitHalfGate - 6);
    const relT = (actor.cx - entry.x) * tIn.x + (actor.cy - entry.y) * tIn.y;
    const relTc = clamp(relT, -latCap, latCap);

    const outCx = exit.x + tOut.x * relTc + nOut.x * pushOut;
    const outCy = exit.y + tOut.y * relTc + nOut.y * pushOut;

    actor.x = outCx - actor.w / 2;
    actor.y = outCy - actor.h / 2;
    actor.remX = 0; actor.remY = 0;
    actor.portalCd = CFG.PORTAL_COOLDOWN;

    // 4) 出门喷射：把实体在一帧内推出出口门的判定圈
    /* 为什么必须显式给速度，而不是只靠位置：
       - 箱子被 pushCrates 顶推时的 `vx` 平衡点只有 ~4（见 PushBox.pushBy 注释），
         靠它自己几乎不动。位置虽然被放到了圈外，但只要它原地不动、
         重力又把 vy 拉起来一点点，下一帧的速度闸就会重新成立 → 回吸。
       - 所以给出门法向一个**最低速度**：ejectSpeed = 清空距离 / 0.06s，
         保证 0.06 秒内真正离开门口。
       ⚠️ 关键：这一步必须放在「位置已经确定」之后，并且**只对法向正向补差**，
          绝不能整体覆盖速度 —— 否则会把上面算好的法向保底/上限/增益全冲掉，
          慢速进门也会被弹成高速（手感变成"门在推人"）。 */
    const ejectSpeed = (CFG.PORTAL_EXIT_CLEAR || 0) / 0.06;
    const vnOut = actor.vx * nOut.x + actor.vy * nOut.y;
    if (vnOut < ejectSpeed) {
      const add = ejectSpeed - vnOut;
      actor.vx += nOut.x * add;
      actor.vy += nOut.y * add;
    }

    // 5) 记录刚穿过的门，避免立刻被反向吸回（作为第二道保险）
    actor._lastEntry = exit;

    if (game) {
      game.fx.portalBurst(exit.x, exit.y, exit.color, exit.d, Math.hypot(actor.vx, actor.vy));
      game.shake(Math.min(7, Math.hypot(actor.vx, actor.vy) * 0.016), 0.16);
      game.audio?.portal();
      // 如果穿的是玩家，同步摄像机所在房间
      if (actor === game.player) {
        const toRoom = exit.roomId;
        if (toRoom && toRoom !== game.roomId) game.switchRoom(toRoom, true);
      }
    }
    return true;
  }

  /**
   * 每步检测：实体是否该被传走。
   *
   * 设计目标（手感优先）：**必须"朝着门内"真正运动到门口才传送**，
   * 站在门上、从门面上跑过、或者贴着门面轻微挪动都不该触发。
   *
   * 因此有三道闸门：
   *   ① 位置闸：上一步必须在门面内侧（没越过去），这一步必须到达门口
   *   ② 速度闸：沿法线方向必须**明显朝门内**（有实际进门速度，不是蹭一下）
   *   ③ 横向闸：穿越瞬间的中心横向偏移必须落在门口宽度内
   */
  check(actor, game) {
    if (!this.ready) return false;
    if (actor.portalCd > 0) return false;

    const prevX = actor._prevCx ?? actor.cx;
    const prevY = actor._prevCy ?? actor.cy;

    // 进门速度阈值：玩家略宽松（保证高速坠落/冲刺顺畅），箱子要求更明确
    const isPlayer = actor === (game && game.player);
    const minSpeed = isPlayer ? 26 : 40;
    // 门口横向有效半宽：挤压掉一点实体半宽，避免"擦着门边被吸走"
    // ★ PORTAL_R 21 → halfGate = max(4, 21 - 5.5) = 15.5px
    const halfGate = Math.max(4, CFG.PORTAL_R - actor.w * 0.5);
    // ★ 吸附圈：比判定圈再宽 PORTAL_SNAP，用于"下落对准辅助"
    const snapGate = halfGate + (CFG.PORTAL_SNAP || 0);

    // ★★★ 下落吸附辅助（解决"很难精准向下掉到传送门里"）
    //   只在**玩家、正在下落、且本步没有任何水平输入**时生效 —— 不能干扰主动走位。
    //   做法：如果横向偏移落在吸附圈内但超出判定圈，就沿着门口的切向把玩家
    //   轻推一点（每帧上限 2px），几帧之内就会滑到门口正上方。
    //   这是"手感宽容度"，不是"自动传送"：速度闸、位置闸一个都没放宽。
    let snapped = false;
    if (isPlayer && (CFG.PORTAL_SNAP || 0) > 0 && actor.vy > 0 && game && game.input) {
      const ax = game.input.ax, ay = game.input.ay;
      if (ax === 0 && ay === 0) {
        for (const e of [this.a, this.b]) {
          if (!e.active || e.roomId !== game.room.id) continue;
          const n = e.normal, t = e.tangent;
          const dx = actor.cx - e.x, dy = actor.cy - e.y;
          const along = dx * n.x + dy * n.y;
          const lat = dx * t.x + dy * t.y;
          // 必须已经贴近门面（在门面外侧一点点，正在往下掉进门）
          const floorish = e.d === 0 || e.d === 2;
          const surfTol = (floorish ? actor.h / 2 : actor.w / 2) + 6;
          if (along < 0 || along > surfTol + 4) continue;
          if (Math.abs(lat) <= halfGate || Math.abs(lat) > snapGate) continue;
          // 往门中心轻推（沿切向），每帧最多 2px
          const pull = clamp(-lat, -2, 2);
          actor.x += t.x * pull;
          actor.y += t.y * pull;
          snapped = true;
        }
      }
    }
    if (snapped) actor.separateFromSolids(game.room.collisionSolids(), game.room);

    for (const entry of [this.a, this.b]) {
      if (entry.roomId !== game.room.id) continue;
      /* ★ 刚从这扇门出来 → 只要还压在它的门口范围内，就不再把它当入口。
         ------------------------------------------------------------------
         为什么不能只靠 `portalCd`（时间冷却）：
           实体出门后会被放在门口外侧 ~15px 处，但**它自己就骑在门口上**
           （门口判定半宽 15.5px + 实体半宽）。冷却 0.12s 一过，
           实体还站在原地，于是立刻被同一扇门吸回去 ——
           实测箱子在 x=12.77 ↔ 15.37 之间高频弹射，永远压不到压力板。
         改成"位置条件"：只要实体中心还落在该门切向 ±(halfGate + 半宽 + 8)
         范围、且贴在门面上，就跳过它。等实体真正走开，这扇门自然恢复可用。
         （玩家不受影响：玩家出门后有速度，一下就离开了门口。） */
      if (actor._lastEntry === entry) {
        const n2 = entry.normal, t2 = entry.tangent;
        const ddx = actor.cx - entry.x, ddy = actor.cy - entry.y;
        const aN = ddx * n2.x + ddy * n2.y;
        const aT = ddx * t2.x + ddy * t2.y;
        const f2 = entry.d === 0 || entry.d === 2;
        const tol = (f2 ? actor.h / 2 : actor.w / 2) + 10;
        const latLim = halfGate + (f2 ? actor.w / 2 : actor.h / 2) + 8;
        if (aN >= -tol && aN <= tol && Math.abs(aT) <= latLim) continue;
        actor._lastEntry = null;   // 已经离开门口 → 解除屏蔽
      }

      const n = entry.normal, t = entry.tangent;

      // 该门朝向对应的"实体半厚度"：地板/天花板门看半高，墙面门看半宽
      const floorish = entry.d === 0 || entry.d === 2;
      const halfSpread = floorish ? actor.h / 2 : actor.w / 2;
      /* 允许"贴在门面上" —— 门面平面到实体中心的最大距离。
         ★★★ 必须随速度放大（"高速坠落反而掉不进门"的真凶）★★★
         ------------------------------------------------------------------
         血泪史（房间9 整关报废）：
           原本 `surfTol = halfSpread + 6` 是个**固定值**（玩家 = 7.5+6 = 13.5px）。
           但实体每帧位移 = |v|*dt。玩家从高处坠落的终端速度 MAX_FALL = 460，
           一帧就走 460/60 ≈ 7.7px。落地瞬间 `moveY` 会把他**停在门面上**，
           于是 `alongNow` 序列可能是 22.5 → 14.5 → 7.5：
             · 22.5 > 13.5 → 被"还没到门口"拒掉
             · 14.5 > 13.5 → 又被拒掉（差 1px！）
             · 7.5 ≤ 13.5 → 但这帧已经 grounded，vy 被清零 → 速度闸又拒掉
           结果就是"明明砸在门上了却没进去"，玩家体感 = 传送门时灵时不灵。
         修法：把容差扩到"这一步实际可能走过的距离"，即加上 |vAlong|*dt。
           这样只要实体这一帧的**起点或终点**够得着门面，就算"到达门口"。
           位置闸仍然存在（不会隔空吸人），只是不再因为速度太快而漏判。
         上限 3 格：再快也不能隔着一堵墙把人吸走。 */
      const stepDist = Math.min(3 * CFG.TILE, Math.abs(actor.vy) * CFG.DT + Math.abs(actor.vx) * CFG.DT);
      const surfTol = halfSpread + 6 + stepDist;

      // ---- ① 位置闸（先算位置，速度闸要用它来判断"是否贴着门面横推"）----
      const pdx = prevX - entry.x, pdy = prevY - entry.y;
      const alongPrev = pdx * n.x + pdy * n.y;
      const dx = actor.cx - entry.x, dy = actor.cy - entry.y;
      const alongNow = dx * n.x + dy * n.y;

      if (alongPrev < -surfTol) continue;    // 上一步已经在门外侧了（只允许贴面或内侧）
      if (alongNow > surfTol) continue;      // 还没真正到门口
      if (alongNow < -40) continue;          // 一步跨得太远，已经完全穿过去了

      // 当前横向偏移（速度闸里的"横推"判定要用）
      const latNow = dx * t.x + dy * t.y;

      // ---- ② 速度闸 ----
      // 常规路径：沿门法线方向明显朝门内运动（坠落 / 冲刺 / 撞门）。
      // 特例路径：**贴着门面横向推挤**。箱子被水平推着从地板门上蹭过去时 vy≈0，
      // 法线速度天然为 0，但那属于「主动推进去」，必须放行 ——
      // 需求原文：「不要被误吸，主动推进去可以」。
      // 只对**被推的实体（箱子）**开这个口子：玩家在门面上左右跑动依然不传送，
      // 否则会出现"在地板门上横跑一步就被吸走"的糟糕手感。
      const vAlong = actor.vx * n.x + actor.vy * n.y;
      let pushIn = false;
      if (!isPlayer && vAlong > -minSpeed) {
        /* ⚠️ 横推速度必须用 `topPush`（玩家顶推速度），**不能**用 `vLat`。
           ------------------------------------------------------------------
           原因见 `PushBox.pushSpeed` 与 `pushBy` 的注释：
           箱子被横推时 `vx` 的平衡点只有 ~4（`pushBy` 每帧 +4、
           `approach` 每帧抹 -15），而传送门要求 `|vLat| > minSpeed*0.4`：
             玩家在**地板门**上横推箱子：t 是水平轴 → vLat ≈ vx = 4
             玩家在**墙面门**上横推箱子：t 是竖直轴 → vLat ≈ vy = 0
           两种情况都过不了 16 的阈值，于是"把箱子顶到门上"永远不传送，
           箱子只会贴着门面滑过去（实测：贴到门前 8px 停住、portalCd 恒为 0）。
           ✅ 改用 `topPush` —— 它是玩家这一帧**真实顶推速度**（可达 180），
              且只要玩家一松手立刻归零，不会让箱子"松手后继续飞"。 */
        const pushVel = actor.topPush || 0;
        pushIn = Math.abs(alongNow) <= surfTol &&            // 身体压在门面上
          pushVel > minSpeed * 0.4 &&                         // 玩家正在顶推
          Math.abs(latNow) <= halfGate;                       // 且正对门口
      }
      if (vAlong > -minSpeed && !pushIn) continue;   // 不朝门内、也不是横推 → 不传送

      // ---- ③ 横向闸：用插值求"穿过门面那一刻"的位置 ----
      const usePrev = Math.abs(alongNow - alongPrev) > 1e-6;
      const k = usePrev ? clamp((0 - alongPrev) / (alongNow - alongPrev), 0, 1) : 1;
      const hx = prevX + (actor.cx - prevX) * k;
      const hy = prevY + (actor.cy - prevY) * k;
      const lat = (hx - entry.x) * t.x + (hy - entry.y) * t.y;
      if (Math.abs(lat) > halfGate) continue;
      const exit = this.other(entry);
      if (!exit.active) continue;
      return this.transport(actor, entry, exit, game);
    }
    return false;
  }

  /** 记录上一步中心（在物理步开始时调用） */
  recordPrev(actors) {
    for (const a of actors) {
      if (!a) continue;
      a._prevCx = a.cx; a._prevCy = a.cy;
    }
  }}
