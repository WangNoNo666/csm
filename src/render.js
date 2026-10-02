/* ============================================================
   渲染器
   ------------------------------------------------------------
   关键：传送门 = 递归视口。
   画 A 门时，把 A 门当作一个窗口去看 B 门外的世界：
   用「从 A 门到 B 门的变换矩阵」把世界画进 A 门的裁剪区域。
   ============================================================ */

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
  }

  resize(w, h, dpr) {
    this.cv.width = w * dpr; this.cv.height = h * dpr;
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
  }

  clear() {
    const g = this.g;
    g.clearRect(0, 0, this.W, this.H);
  }

  /* ---------- 背景（房间氛围） ---------- */
  drawBackground(game, cam) {
    const g = this.g;
    const r = game.room;
    const pal = r.palette;
    const grd = g.createLinearGradient(0, 0, 0, this.H);
    grd.addColorStop(0, pal.bg1);
    grd.addColorStop(1, pal.bg2);
    g.fillStyle = grd;
    g.fillRect(0, 0, this.W, this.H);

    // 视差远景：大块几何
    g.save();
    g.globalAlpha = 0.5;
    const px = -cam.x * 0.35, py = -cam.y * 0.35;
    g.fillStyle = pal.far;
    const bw = 220, bh = 150;
    for (let i = -1; i < 8; i++) {
      const x = ((i * bw + px) % (bw * 6) + bw * 6) % (bw * 6) - bw;
      const h = bh * (0.6 + ((i * 37) % 5) / 6);
      g.fillRect(x, this.H - h + py * 0.4, bw * 0.72, h);
    }
    g.restore();

    // 中景：网格光斑
    g.save();
    g.globalAlpha = 0.16;
    g.strokeStyle = pal.accent;
    g.lineWidth = 1;
    const gs = 64, ox = -cam.x * 0.6, oy = -cam.y * 0.6;
    g.beginPath();
    for (let x = (ox % gs) - gs; x < this.W + gs; x += gs) { g.moveTo(x, 0); g.lineTo(x, this.H); }
    for (let y = (oy % gs) - gs; y < this.H + gs; y += gs) { g.moveTo(0, y); g.lineTo(this.W, y); }
    g.stroke();
    g.restore();
  }

  /* ---------- 房间几何 ---------- */
  drawRoom(game, cam, alpha = 1, clipRect = null) {
    const g = this.g;
    const room = game.room;
    const T = CFG.TILE;

    g.save();
    if (clipRect) { g.beginPath(); g.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h); g.clip(); }
    g.globalAlpha = alpha;

    // 墙块
    for (const s of room.solidsAll) {
      const x = s.x - cam.x, y = s.y - cam.y;
      if (x > this.W + 8 || y > this.H + 8 || x + s.w < -8 || y + s.h < -8) continue;
      this.drawTileBlock(g, s, cam, room.palette);
    }
    g.restore();
  }

  drawTileBlock(g, s, cam, pal) {
    const x = s.x - cam.x, y = s.y - cam.y;
    const T = CFG.TILE;
    // 主体
    g.fillStyle = pal.wall;
    g.fillRect(x, y, s.w, s.h);
    // 顶面高光（只在"露天"的顶边）
    g.fillStyle = pal.wallTop;
    g.fillRect(x, y, s.w, Math.min(4, s.h));
    // 内部砖纹
    g.save();
    g.beginPath(); g.rect(x, y, s.w, s.h); g.clip();
    g.strokeStyle = pal.wallLine;
    g.lineWidth = 1;
    g.beginPath();
    for (let yy = y + T; yy < y + s.h; yy += T) { g.moveTo(x, yy + .5); g.lineTo(x + s.w, yy + .5); }
    for (let xx = x + T; xx < x + s.w; xx += T) { g.moveTo(xx + .5, y); g.lineTo(xx + .5, y + s.h); }
    g.stroke();
    // 高光左上
    g.fillStyle = 'rgba(255,255,255,.07)';
    g.fillRect(x, y, s.w, 1); g.fillRect(x, y, 1, s.h);
    g.restore();
    // 描边
    g.strokeStyle = pal.wallEdge;
    g.lineWidth = 1;
    g.strokeRect(x + .5, y + .5, s.w - 1, s.h - 1);
  }

  /* ---------- 传送门轮廓（用于裁剪与描边） ---------- */
  portalPath(g, p, cam) {
    const x = p.x - cam.x, y = p.y - cam.y;
    const r = CFG.PORTAL_R, d = CFG.PORTAL_DEPTH;
    const n = p.dir;
    g.beginPath();
    if (p.d === 0) {        // 地面，向上
      g.moveTo(x - r, y); g.lineTo(x - r, y + d);
      g.lineTo(x + r, y + d); g.lineTo(x + r, y);
      g.closePath();
    } else if (p.d === 2) { // 天花板，向下
      g.moveTo(x - r, y); g.lineTo(x - r, y - d);
      g.lineTo(x + r, y - d); g.lineTo(x + r, y);
      g.closePath();
    } else if (p.d === 1) { // 右墙（法线朝左内）
      g.moveTo(x, y - r); g.lineTo(x - d, y - r);
      g.lineTo(x - d, y + r); g.lineTo(x, y + r);
      g.closePath();
    } else {                // 左墙
      g.moveTo(x, y - r); g.lineTo(x + d, y - r);
      g.lineTo(x + d, y + r); g.lineTo(x, y + r);
      g.closePath();
    }
  }

  /**
   * 把「另一个房间 / 同一房间的另一处」通过传送门画出来。
   * 用相似变换：从 portal 的局部坐标系映射到 other 的局部坐标系。
   */
  drawPortalView(game, cam, portal, other, depth) {
    const g = this.g;
    // 局部坐标：f = 门的"向外"方向（-normal）, u = 切向
    const fA = { x: -portal.normal.x, y: -portal.normal.y };
    const uA = portal.tangent;
    const fB = { x: other.normal.x, y: other.normal.y };       // 从 B 向外看的方向
    const uB = { x: -other.tangent.x, y: -other.tangent.y };   // 保证不镜像

    g.save();
    // 1) 裁剪到 A 门
    this.portalPath(g, portal, cam);
    g.clip();
    // 2) 填充底色（防止边缘漏光）
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, this.W, this.H);

    // 3) 变换：屏幕坐标 → 世界坐标(B 附近) → 屏幕坐标
    //    先平移回门 A 的屏幕位置，再旋转/缩放到 B
    const sA = { x: portal.x - cam.x, y: portal.y - cam.y };
    const sB = { x: other.x - cam.x, y: other.y - cam.y };

    // 构造二维矩阵：把 (fA,uA) 映射到 (-fB, uB)
    // 即：进 A 门深处 = 从 B 门出来
    // worldAtB = sB + (-fB)*a + uB*b,  其中 (a,b) = 在 A 局部下的坐标
    // 屏幕点 p 在 A 局部： a = -(p - sA)·fA ... 这样推导易错，
    // 直接用基变换矩阵更稳。
    const mA = [fA.x, fA.y, uA.x, uA.y];   // 列向量
    const mB = [-fB.x, -fB.y, uB.x, uB.y];
    // 求 mA 的逆（2x2）
    const det = mA[0] * mA[3] - mA[1] * mA[2];
    if (Math.abs(det) < 1e-6) { g.restore(); return; }
    const inv = [mA[3] / det, -mA[1] / det, -mA[2] / det, mA[0] / det];
    // M = mB * inv(A)
    const M = [
      mB[0] * inv[0] + mB[2] * inv[1], mB[1] * inv[0] + mB[3] * inv[1],
      mB[0] * inv[2] + mB[2] * inv[3], mB[1] * inv[2] + mB[3] * inv[3],
    ];
    const t = {
      x: sB.x - (M[0] * sA.x + M[2] * sA.y),
      y: sB.y - (M[1] * sA.x + M[3] * sA.y),
    };
    g.transform(M[0], M[1], M[2], M[3], t.x, t.y);

    // 4) 画出 B 门附近的世界（用 A 门的摄像机做同样的平移，这里简化：
    //    用 cam 但把视角平移到 B 门所在房间）
    const virtualCam = { x: cam.x, y: cam.y };
    const drawTargetRoom = game.rooms[other.roomId];
    const savedRoom = game.room;
    if (drawTargetRoom && drawTargetRoom !== savedRoom) {
      game.room = drawTargetRoom;
      this.drawRoom(game, virtualCam, 1, null);
      game.room = savedRoom;
    } else {
      this.drawRoom(game, virtualCam, 1, null);
    }

    // 5) 递归：A 门里能看到 B 门，B 门里又能看到 A 门……
    if (depth < CFG.PORTAL_MAX_RECURSE && other.active && portal.active) {
      // 此时坐标系是"B 门局部"，把 B 门画成通往 A 门
      this.drawPortalViewInline(game, virtualCam, other, portal, depth + 1);
    }

    g.restore();
  }

  /** 在当前（已被变换的）坐标系里画另一个门的内嵌视图 —— 递归 */
  drawPortalViewInline(game, cam, portal, other, depth) {
    const g = this.g;
    const fA = { x: -portal.normal.x, y: -portal.normal.y };
    const uA = portal.tangent;
    const fB = { x: other.normal.x, y: other.normal.y };
    const uB = { x: -other.tangent.x, y: -other.tangent.y };
    const sA = { x: portal.x - cam.x, y: portal.y - cam.y };
    const sB = { x: other.x - cam.x, y: other.y - cam.y };
    const mA = [fA.x, fA.y, uA.x, uA.y];
    const mB = [-fB.x, -fB.y, uB.x, uB.y];
    const det = mA[0] * mA[3] - mA[1] * mA[2];
    if (Math.abs(det) < 1e-6) return;
    const inv = [mA[3] / det, -mA[1] / det, -mA[2] / det, mA[0] / det];
    const M = [
      mB[0] * inv[0] + mB[2] * inv[1], mB[1] * inv[0] + mB[3] * inv[1],
      mB[0] * inv[2] + mB[2] * inv[3], mB[1] * inv[2] + mB[3] * inv[3],
    ];
    const t = { x: sB.x - (M[0] * sA.x + M[2] * sA.y), y: sB.y - (M[1] * sA.x + M[3] * sA.y) };

    g.save();
    this.portalPath(g, portal, cam);
    g.clip();
    g.transform(M[0], M[1], M[2], M[3], t.x, t.y);
    const savedRoom = game.room;
    const tr = game.rooms[other.roomId];
    if (tr) game.room = tr;
    this.drawRoom(game, cam, 0.85, null);
    game.room = savedRoom;
    if (depth < CFG.PORTAL_MAX_RECURSE) this.drawPortalViewInline(game, cam, other, portal, depth + 1);
    g.restore();
  }

  /** 门本身的外观：边缘能量、光晕 */
  drawPortalShell(game, cam, p, time) {
    const g = this.g;
    if (!p.active) return;
    const x = p.x - cam.x, y = p.y - cam.y;
    const r = CFG.PORTAL_R;

    g.save();
    // 外发光
    const grd = g.createRadialGradient(x, y, r * 0.3, x, y, r * 2.4);
    grd.addColorStop(0, hexToRgba(p.color, 0.42));
    grd.addColorStop(1, hexToRgba(p.color, 0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r * 2.4, 0, 7); g.fill();

    // 门框描边
    this.portalPath(g, p, cam);
    g.strokeStyle = p.color;
    g.lineWidth = 2.6;
    g.shadowColor = p.color;
    g.shadowBlur = 14;
    g.stroke();
    g.shadowBlur = 0;

    // 内部能量波纹
    g.save();
    this.portalPath(g, p, cam);
    g.clip();
    g.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) {
      const ph = (time * 1.5 + i * 0.33) % 1;
      const rr = ph * r * 1.7;
      g.strokeStyle = hexToRgba(p.color, (1 - ph) * 0.65);
      g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, rr, 0, 7); g.stroke();
    }
    g.restore();
    g.restore();
  }
}

function hexToRgba(hex, a) {
  if (hex[0] !== '#') return `rgba(255,255,255,${a})`;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
