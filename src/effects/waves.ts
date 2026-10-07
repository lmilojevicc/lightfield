import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits Waves.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { stepWavesPointer } from "./canvas-math";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

class Grad {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}
  dot2(x: number, y: number) {
    return this.x * x + this.y * y;
  }
}

class Noise {
  private readonly grad3 = [
    new Grad(1, 1, 0),
    new Grad(-1, 1, 0),
    new Grad(1, -1, 0),
    new Grad(-1, -1, 0),
    new Grad(1, 0, 1),
    new Grad(-1, 0, 1),
    new Grad(1, 0, -1),
    new Grad(-1, 0, -1),
    new Grad(0, 1, 1),
    new Grad(0, -1, 1),
    new Grad(0, 1, -1),
    new Grad(0, -1, -1),
  ];
  private readonly p = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140,
    36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120,
    234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33,
    88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71,
    134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133,
    230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161,
    1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130,
    116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250,
    124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227,
    47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44,
    154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98,
    108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34,
    242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14,
    239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121,
    50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243,
    141, 128, 195, 78, 66, 215, 61, 156, 180,
  ];
  private readonly perm = new Array<number>(512);
  private readonly gradP = new Array<Grad>(512);
  constructor(seed: number) {
    if (seed > 0 && seed < 1) seed *= 65536;
    seed = Math.floor(seed);
    if (seed < 256) seed |= seed << 8;
    for (let i = 0; i < 256; i++) {
      const v =
        i & 1
          ? requiredValue(this.p[i]) ^ (seed & 255)
          : requiredValue(this.p[i]) ^ ((seed >> 8) & 255);
      this.perm[i] = this.perm[i + 256] = v;
      this.gradP[i] = this.gradP[i + 256] = requiredValue(this.grad3[v % 12]);
    }
  }
  perlin2(x: number, y: number) {
    let X = Math.floor(x),
      Y = Math.floor(y);
    x -= X;
    y -= Y;
    X &= 255;
    Y &= 255;
    const n00 = requiredValue(this.gradP[X + requiredValue(this.perm[Y])]).dot2(
        x,
        y,
      ),
      n01 = requiredValue(this.gradP[X + requiredValue(this.perm[Y + 1])]).dot2(
        x,
        y - 1,
      ),
      n10 = requiredValue(this.gradP[X + 1 + requiredValue(this.perm[Y])]).dot2(
        x - 1,
        y,
      ),
      n11 = requiredValue(
        this.gradP[X + 1 + requiredValue(this.perm[Y + 1])],
      ).dot2(x - 1, y - 1);
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10),
      lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b,
      u = fade(x);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), fade(y));
  }
}

type Point = {
  x: number;
  y: number;
  wave: { x: number; y: number };
  cursor: { x: number; y: number; vx: number; vy: number };
};

export function createWaves(context: BackgroundContext): BackgroundInstance {
  const canvas = document.createElement("canvas");
  canvas.className = "background-canvas";
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) throw new Error("Waves requires a 2D canvas context");
  const ctx = canvasContext;
  context.host.replaceChildren(canvas);
  const noise = new Noise(Math.random());
  let lines: Point[][] = [];
  let bounds = context.host.getBoundingClientRect();
  let config = context.config,
    palette = context.palette;
  let visible = context.visible,
    reduced = context.reducedMotion,
    destroyed = false,
    frame = 0,
    lastTime = 0;
  const mouse = {
    x: -10,
    y: 0,
    lx: 0,
    ly: 0,
    sx: 0,
    sy: 0,
    vs: 0,
    angle: 0,
    set: false,
  };
  function rebuild() {
    bounds = context.host.getBoundingClientRect();
    const dpr = 1;
    canvas.width = bounds.width * dpr;
    canvas.height = bounds.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const xGap = 10,
      yGap = 32,
      totalLines = Math.ceil((bounds.width + 200) / xGap),
      totalPoints = Math.ceil((bounds.height + 30) / yGap),
      xStart = (bounds.width - xGap * totalLines) / 2,
      yStart = (bounds.height - yGap * totalPoints) / 2;
    lines = [];
    for (let i = 0; i <= totalLines; i++) {
      const points: Point[] = [];
      for (let j = 0; j <= totalPoints; j++)
        points.push({
          x: xStart + xGap * i,
          y: yStart + yGap * j,
          wave: { x: 0, y: 0 },
          cursor: { x: 0, y: 0, vx: 0, vy: 0 },
        });
      lines.push(points);
    }
    ensure();
  }
  const moved = (p: Point, withCursor = true) => ({
    x: Math.round((p.x + p.wave.x + (withCursor ? p.cursor.x : 0)) * 10) / 10,
    y: Math.round((p.y + p.wave.y + (withCursor ? p.cursor.y : 0)) * 10) / 10,
  });
  function draw(time: number) {
    frame = 0;
    if (destroyed || !visible) return;
    lastTime = reduced ? lastTime : time;
    const stepped = stepWavesPointer(mouse);
    Object.assign(mouse, stepped);
    for (const points of lines)
      for (const p of points) {
        const move =
          noise.perlin2(
            (p.x + lastTime * Number(config.waveSpeedX)) * 0.002,
            (p.y + lastTime * 0.005) * 0.0015,
          ) * 12;
        p.wave.x = Math.cos(move) * 32;
        p.wave.y = Math.sin(move) * 16;
        const dx = p.x - mouse.sx,
          dy = p.y - mouse.sy,
          dist = Math.hypot(dx, dy),
          l = Math.max(175, mouse.vs);
        if (dist < l) {
          const s = 1 - dist / l,
            f = Math.cos(dist * 0.001) * s;
          p.cursor.vx += Math.cos(mouse.angle) * f * l * mouse.vs * 0.00065;
          p.cursor.vy += Math.sin(mouse.angle) * f * l * mouse.vs * 0.00065;
        }
        p.cursor.vx += (0 - p.cursor.x) * 0.005;
        p.cursor.vy += (0 - p.cursor.y) * 0.005;
        p.cursor.vx *= 0.925;
        p.cursor.vy *= 0.925;
        p.cursor.x = Math.min(
          100,
          Math.max(-100, p.cursor.x + p.cursor.vx * 2),
        );
        p.cursor.y = Math.min(
          100,
          Math.max(-100, p.cursor.y + p.cursor.vy * 2),
        );
      }
    ctx.clearRect(0, 0, bounds.width, bounds.height);
    ctx.beginPath();
    ctx.strokeStyle = palette.inkHex;
    for (const points of lines) {
      let p1 = moved(requiredValue(points[0]), false);
      ctx.moveTo(p1.x, p1.y);
      points.forEach((p, index) => {
        const last = index === points.length - 1;
        p1 = moved(p, !last);
        const p2 = moved(
          points[index + 1] ?? requiredValue(points[points.length - 1]),
          !last,
        );
        ctx.lineTo(p1.x, p1.y);
        if (last) ctx.moveTo(p2.x, p2.y);
      });
    }
    ctx.stroke();
    context.reportPaint?.();
    if (!reduced) frame = requestAnimationFrame(draw);
  }
  function ensure() {
    if (!destroyed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  function pointer(x: number, y: number) {
    mouse.x = x - bounds.left;
    mouse.y = y - bounds.top;
    if (!mouse.set) {
      mouse.sx = mouse.lx = mouse.x;
      mouse.sy = mouse.ly = mouse.y;
      mouse.set = true;
    }
    ensure();
  }
  const onMouse = (e: MouseEvent) => {
      pointer(e.clientX, e.clientY);
    },
    onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) pointer(t.clientX, t.clientY);
    };
  window.addEventListener("mousemove", onMouse, { passive: true });
  window.addEventListener("touchmove", onTouch, { passive: true });
  rebuild();
  return {
    resize: rebuild,
    update(next) {
      config = next.config;
      palette = next.palette;
      visible = next.visible;
      reduced = next.reducedMotion;
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      ensure();
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchmove", onTouch);
      canvas.remove();
    },
  };
}
