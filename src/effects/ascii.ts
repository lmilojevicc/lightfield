import { requiredValue } from "./runtime/required-value";
// Meridian classic effect: ASCII — animated starfield rendered as ASCII glyphs.
// Ported from the pre-9a2092a src/scene.ts monolith.
import { applyMeridianCanvasFilter } from "./meridian-color-filter";
import { mulberry32 } from "./meridian-glsl";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

export function createAscii(context: BackgroundContext): BackgroundInstance {
  const canvas = document.createElement("canvas");
  canvas.className = "background-canvas";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  context.host.replaceChildren(canvas);
  const ctx = requiredValue(canvas.getContext("2d"));

  let palette = context.palette;
  let config = context.config;
  applyMeridianCanvasFilter(canvas, config);
  let destroyed = false;
  let visible = context.visible;
  let reducedMotion = context.reducedMotion;
  let frame = 0;
  let acc = 0;
  let time = 0;
  let w = 0;
  let h = 0;
  const cell = 14;
  const inkCss = () => palette.inkHex;
  const accentCss = () => palette.accentHex;

  const rng = mulberry32(0xa5c11);
  const stars: { x: number; y: number; z: number; seed: number }[] = [];
  for (let i = 0; i < 650; i++) {
    stars.push({ x: rng(), y: rng(), z: 0.15 + rng() * 0.85, seed: rng() });
  }
  const pointer = { x: 9999, y: 9999 };

  function resize() {
    if (destroyed) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    w = context.host.clientWidth;
    h = context.host.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${String(w)}px`;
    canvas.style.height = `${String(h)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ensure();
  }

  function draw(dt: number) {
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${String(cell - 3)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const ramp = " .·:+*";
    const px = pointer.x > 100 ? -9999 : ((pointer.x + 1) / 2) * w;
    const py = pointer.y > 100 ? -9999 : ((1 - pointer.y) / 2) * h;
    const opacity = Number(config.opacity);
    const fade = Number.isFinite(opacity) ? opacity / 0.5 : 1;

    for (const s of stars) {
      s.y += s.z * dt * 0.016;
      if (s.y > 1) {
        s.y = 0;
        s.x = (s.x + 0.618) % 1;
      }
      let gx = Math.round((s.x * w) / cell) * cell;
      let gy = Math.round((s.y * h) / cell) * cell;

      const dx = gx - px;
      const dy = gy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < 16900) {
        const d = Math.sqrt(d2) + 1e-3;
        const push = (1 - d / 130) * 16;
        gx += (dx / d) * push;
        gy += (dy / d) * push;
      }

      const twinkle = 0.5 + 0.5 * Math.sin(time * 1.6 + s.seed * 40);
      const isAccent = s.seed < 0.1;
      const idx = Math.min(
        ramp.length - 1,
        Math.floor(s.z * (ramp.length - 1) + twinkle * 1.2),
      );
      const ch = isAccent ? "*" : ramp[idx];
      const alpha = (0.16 + 0.5 * s.z + 0.18 * twinkle) * fade;
      ctx.globalAlpha = Math.min(alpha, 1);
      ctx.fillStyle = isAccent ? accentCss() : inkCss();
      ctx.fillText(requiredValue(ch), gx, gy);
    }
    ctx.globalAlpha = 1;
    context.reportPaint?.();
  }

  function tick() {
    frame = 0;
    if (destroyed || !visible) return;
    const now = performance.now();
    if (!lastTime) lastTime = now;
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (reducedMotion) {
      draw(0);
      return;
    }
    acc += dt;
    if (acc >= 0.07) {
      const step = acc;
      acc = 0;
      time += step;
      draw(step);
    }
    frame = requestAnimationFrame(tick);
  }
  let lastTime = 0;

  function ensure() {
    if (!destroyed && visible && frame === 0)
      frame = requestAnimationFrame(tick);
  }

  function update(next: {
    palette: typeof palette;
    config: typeof config;
    visible: boolean;
    reducedMotion: boolean;
  }) {
    if (destroyed) return;
    palette = next.palette;
    config = next.config;
    applyMeridianCanvasFilter(canvas, config);
    visible = next.visible;
    reducedMotion = next.reducedMotion;
    if (!visible && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    ensure();
  }

  resize();

  return {
    update,
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      canvas.remove();
    },
  };
}
