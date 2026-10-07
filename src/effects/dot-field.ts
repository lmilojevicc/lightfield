import { requiredValue } from "./runtime/required-value";
// Adapted from React Bits DotField.jsx at c7109dccb42e06592d1d9bc50bc87204697240e2.
// Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
import { dotBulgeOffset, stepDotPointerSpeed } from "./canvas-math";
import type {
  BackgroundContext,
  BackgroundInstance,
} from "./runtime/contracts";

type Dot = {
  ax: number;
  ay: number;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};
const TWO_PI = Math.PI * 2;

export function dotRepulsionImpulse(
  dx: number,
  dy: number,
  speed: number,
  force: number,
): [number, number] {
  const distance = Math.hypot(dx, dy);
  if (!(distance > 0)) return [0, 0];
  const move = (500 / distance) * (speed * force),
    vx = Math.cos(Math.atan2(dy, dx)) * -move,
    vy = Math.sin(Math.atan2(dy, dx)) * -move;
  return Number.isFinite(vx) && Number.isFinite(vy) ? [vx, vy] : [0, 0];
}

export function createDotField(context: BackgroundContext): BackgroundInstance {
  const canvas = document.createElement("canvas");
  canvas.className = "background-canvas";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  const canvasContext = canvas.getContext("2d", { alpha: true });
  if (!canvasContext) throw new Error("Dot Field requires a 2D canvas context");
  const ctx = canvasContext;
  const wrapper = document.createElement("div");
  wrapper.className = "background-mount";
  wrapper.style.position = "relative";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"),
    gradient = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "radialGradient",
    ),
    start = document.createElementNS("http://www.w3.org/2000/svg", "stop"),
    end = document.createElementNS("http://www.w3.org/2000/svg", "stop"),
    glow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const glowId = `dot-field-glow-${Math.random().toString(36).slice(2, 9)}`;
  gradient.id = glowId;
  start.setAttribute("offset", "0%");
  end.setAttribute("offset", "100%");
  end.setAttribute("stop-color", "transparent");
  gradient.append(start, end);
  defs.append(gradient);
  glow.setAttribute("fill", `url(#${glowId})`);
  glow.setAttribute("cx", "-9999");
  glow.setAttribute("cy", "-9999");
  glow.style.opacity = "0";
  svg.append(defs, glow);
  wrapper.append(canvas, svg);
  context.host.replaceChildren(wrapper);
  let config = context.config,
    palette = context.palette,
    dots: Dot[] = [],
    w = 0,
    h = 0,
    dpr = 1,
    frame = 0,
    frameCount = 0,
    destroyed = false,
    visible = context.visible,
    reduced = context.reducedMotion,
    engagement = 0,
    glowOpacity = 0;
  const mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 };
  function build() {
    const step = Number(config.dotRadius) + Number(config.dotSpacing),
      cols = Math.floor(w / step),
      rows = Math.floor(h / step),
      padX = (w % step) / 2,
      padY = (h % step) / 2;
    dots = [];
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const ax = padX + col * step + step / 2,
          ay = padY + row * step + step / 2;
        dots.push({ ax, ay, sx: ax, sy: ay, vx: 0, vy: 0, x: ax, y: ay });
      }
  }
  function resize() {
    const rect = context.host.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${String(w)}px`;
    canvas.style.height = `${String(h)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    ensure();
  }
  function measureSpeed() {
    mouse.speed = stepDotPointerSpeed(
      mouse.speed,
      mouse.x,
      mouse.y,
      mouse.prevX,
      mouse.prevY,
    );
    mouse.prevX = mouse.x;
    mouse.prevY = mouse.y;
  }
  // Defaults have no autonomous motion. Sample pointer speed only while it decays.
  let speedInterval = 0;
  function stopSpeed() {
    if (speedInterval) clearInterval(speedInterval);
    speedInterval = 0;
  }
  function sampleSpeed() {
    if (destroyed || !visible || reduced) {
      stopSpeed();
      return;
    }
    measureSpeed();
    ensure();
    if (mouse.speed === 0) stopSpeed();
  }
  function startSpeed() {
    if (!speedInterval && visible && !reduced)
      speedInterval = window.setInterval(sampleSpeed, 20);
  }
  function unsettled() {
    return (
      mouse.speed > 0 ||
      engagement > 0 ||
      glowOpacity > 0.001 ||
      dots.some(
        (d) =>
          Math.abs(d.sx - d.ax) > 0.001 ||
          Math.abs(d.sy - d.ay) > 0.001 ||
          (!config.bulgeOnly &&
            (Math.abs(d.vx) > 0.001 || Math.abs(d.vy) > 0.001)),
      )
    );
  }
  function draw() {
    frame = 0;
    if (destroyed || !visible) return;
    frameCount++;
    const target = Math.min(mouse.speed / 5, 1);
    engagement += (target - engagement) * 0.06;
    if (engagement < 0.001) engagement = 0;
    glowOpacity += (engagement - glowOpacity) * 0.08;
    glow.setAttribute("cx", String(mouse.x));
    glow.setAttribute("cy", String(mouse.y));
    glow.style.opacity = String(glowOpacity);
    glow.setAttribute("r", String(config.glowRadius));
    start.setAttribute("stop-color", palette.paperHex);
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, palette.accentHex);
    grad.addColorStop(1, palette.focusHex);
    ctx.fillStyle = grad;
    ctx.beginPath();
    const cr = Number(config.cursorRadius),
      force = Number(config.cursorForce),
      rad = Number(config.dotRadius) / 2,
      isBulge = Boolean(config.bulgeOnly),
      t = frameCount * 0.02;
    for (let i = 0; i < dots.length; i++) {
      const d = requiredValue(dots[i]),
        dx = mouse.x - d.ax,
        dy = mouse.y - d.ay,
        distSq = dx * dx + dy * dy;
      if (isBulge) {
        [d.sx, d.sy] = dotBulgeOffset(
          d.ax,
          d.ay,
          d.sx,
          d.sy,
          mouse.x,
          mouse.y,
          cr,
          Number(config.bulgeStrength),
          engagement,
        );
      } else {
        if (distSq < cr * cr && engagement > 0.01) {
          const [vx, vy] = dotRepulsionImpulse(dx, dy, mouse.speed, force);
          d.vx += vx;
          d.vy += vy;
        }
        d.vx *= 0.9;
        d.vy *= 0.9;
        d.x = d.ax + d.vx;
        d.y = d.ay + d.vy;
        d.sx += (d.x - d.sx) * 0.1;
        d.sy += (d.y - d.sy) * 0.1;
      }
      let x = d.sx,
        y = d.sy;
      if (Number(config.waveAmplitude) > 0) {
        y += Math.sin(d.ax * 0.03 + t) * Number(config.waveAmplitude);
        x +=
          Math.cos(d.ay * 0.03 + t * 0.7) * Number(config.waveAmplitude) * 0.5;
      }
      const sparkle =
          Boolean(config.sparkle) &&
          (((i * 2654435761) ^ (frameCount >> 3)) >>> 0) % 100 < 3,
        r = sparkle ? rad * 1.8 : rad;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TWO_PI);
    }
    ctx.fill();
    context.reportPaint?.();
    if (
      !reduced &&
      (Number(config.waveAmplitude) > 0 ||
        Boolean(config.sparkle) ||
        unsettled())
    )
      frame = requestAnimationFrame(draw);
  }
  function ensure() {
    if (!destroyed && visible && frame === 0)
      frame = requestAnimationFrame(draw);
  }
  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom ||
      rect.width === 0 ||
      rect.height === 0
    )
      return;
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
    startSpeed();
    ensure();
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  resize();
  return {
    resize,
    update(next) {
      const rebuild =
        next.config.dotRadius !== config.dotRadius ||
        next.config.dotSpacing !== config.dotSpacing;
      config = next.config;
      palette = next.palette;
      visible = next.visible;
      reduced = next.reducedMotion;
      if (rebuild) build();
      if (!visible || reduced) stopSpeed();
      else if (
        mouse.speed > 0 ||
        mouse.x !== mouse.prevX ||
        mouse.y !== mouse.prevY
      )
        startSpeed();
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      ensure();
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      stopSpeed();
      window.removeEventListener("pointermove", onPointerMove);
      wrapper.remove();
    },
  };
}
