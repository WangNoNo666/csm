/* ============================================================
   Actor —— 物理主体（玩家 / 箱子共用）
   碰撞：分轴推进 + 角落修正（corner correction）
   手感核心：coyote time / jump buffer / 可变跳跃高度 / 顶点缓冲
   ============================================================ */

class Actor {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.remX = 0; this.remY = 0;

    // 手感状态
    this.grounded = false;
    this.wasGrounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumping = false;        // 处于"按住可变高度"窗口
    this.jumpHoldT = 0;
    this.facing = 1;

    this.portalCd = 0;
    this.deadTimer = 0;
    this.squashX = 1; this.squashY = 1;   // 形变（表现层）
    this.onGroundThisStep = false;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  /** 水平推进：处理与实心格的碰撞 + 角落自动修正 */
  moveX(amount, solids, room) {
    this.remX += amount;
    const move = Math.round(this.remX);
    if (move === 0) return;
    this.remX -= move;
    const s = sign(move);

    // 逐像素推（保证不穿墙；量小所以性能可接受）
    let steps = Math.abs(move);
    while (steps-- > 0) {
      if (!this.collideAt(this.x + s, this.y, solids, room, 'x', s)) {
        this.x += s;
      } else {
        // ---- 角落修正：只差一点点就自动顶上去 ----
        let fixed = false;
        for (let d = 1; d <= CFG.CORNER_X; d++) {
          // 向上修正
          if (!this.collideAt(this.x + s, this.y - d, solids, room, 'x', s) &&
              this.collideAt(this.x, this.y - d, solids, room, 'y', 0)) {
            this.y -= d; this.x += s; fixed = true; break;
          }
          // 向下修正
          if (!this.collideAt(this.x + s, this.y + d, solids, room, 'x', s) &&
              this.collideAt(this.x, this.y + d, solids, room, 'y', 0)) {
            this.y += d; this.x += s; fixed = true; break;
          }
        }
        if (!fixed) { this.vx = 0; this.remX = 0; break; }
      }
    }
  }

  /** 垂直推进：落地/顶头检测 + 角落修正 */
  moveY(amount, solids, room) {
    this.remY += amount;
    const move = Math.round(this.remY);
    if (move === 0) return;
    this.remY -= move;
    const s = sign(move);
    const axisState = s > 0 ? 'ground' : 'ceil';

    let steps = Math.abs(move);
    while (steps-- > 0) {
      if (!this.collideAt(this.x, this.y + s, solids, room, 'y', s)) {
        this.y += s;
      } else {
        let fixed = false;
        for (let d = 1; d <= CFG.CORNER_Y; d++) {
          if (!this.collideAt(this.x - d, this.y + s, solids, room, 'y', s) &&
              this.collideAt(this.x - d, this.y, solids, room, 'x', 0)) {
            this.x -= d; this.y += s; fixed = true; break;
          }
          if (!this.collideAt(this.x + d, this.y + s, solids, room, 'y', s) &&
              this.collideAt(this.x + d, this.y, solids, room, 'x', 0)) {
            this.x += d; this.y += s; fixed = true; break;
          }
        }
        if (fixed) continue;

        if (axisState === 'ground') {
          this.grounded = true; this.onGroundThisStep = true;
        } else {
          this.jumping = false;
        }
        this.vy = 0; this.remY = 0; break;
      }
    }
  }

  /** 检查脚下 1px 处是否有实心（用于稳定 grounded 状态） */
  checkGround(solids, room) {
    const probe = { x: this.x, y: this.y + 1, w: this.w, h: this.h };
    for (const s of solids) {
      if (!s.active) continue;
      if (aabb(probe, s)) return true;
    }
    if (room && room.boundsLoose) {
      const bd = room.boundsLoose;
      if (probe.y + probe.h > bd.y + bd.h) return true;
    }
    return false;
  }

  /** 检测给定位置上是否与实心或已关闭的门相交 */
  collideAt(x, y, solids, room, axis, dir) {
    const b = { x, y, w: this.w, h: this.h };
    for (const s of solids) {
      if (!s.active) continue;
      if (aabb(b, s)) return true;
    }
    if (room && room.boundsLoose) {
      const bd = room.boundsLoose;
      if (b.x < bd.x || b.x + b.w > bd.x + bd.w || b.y < bd.y || b.y + b.h > bd.y + bd.h) return true;
    }
    return false;
  }

  /** 与一组方块做重叠分离（用于石墙移动、箱子被夹住等情况） */
  separateFromSolids(solids, room) {
    for (const s of solids) {
      if (!s.active) continue;
      if (!aabb(this.box, s)) continue;
      const dx1 = s.x - (this.x + this.w);   // 向左推出量（负）
      const dx2 = (s.x + s.w) - this.x;      // 向右推出量（正）
      const dy1 = s.y - (this.y + this.h);
      const dy2 = (s.y + s.h) - this.y;
      const px = Math.abs(dx1) < Math.abs(dx2) ? dx1 : dx2;
      const py = Math.abs(dy1) < Math.abs(dy2) ? dy1 : dy2;
      if (Math.abs(px) < Math.abs(py)) { this.x += px; this.vx = 0; }
      else { this.y += py; this.vy = 0; if (py < 0) { this.grounded = true; this.onGroundThisStep = true; } }
    }
  }
}
