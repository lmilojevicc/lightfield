export interface SmoothedPointer {
  x: number;
  y: number;
  lx: number;
  ly: number;
  sx: number;
  sy: number;
  vs: number;
  angle: number;
}

export function stepWavesPointer(pointer: SmoothedPointer): SmoothedPointer {
  const sx = pointer.sx + (pointer.x - pointer.sx) * 0.1;
  const sy = pointer.sy + (pointer.y - pointer.sy) * 0.1;
  const dx = pointer.x - pointer.lx;
  const dy = pointer.y - pointer.ly;
  const distance = Math.hypot(dx, dy);
  return {
    x: pointer.x,
    y: pointer.y,
    lx: pointer.x,
    ly: pointer.y,
    sx,
    sy,
    vs: Math.min(100, pointer.vs + (distance - pointer.vs) * 0.1),
    angle: Math.atan2(dy, dx),
  };
}

export function stepDotPointerSpeed(
  previous: number,
  x: number,
  y: number,
  previousX: number,
  previousY: number,
): number {
  const distance = Math.hypot(previousX - x, previousY - y);
  const speed = previous + (distance - previous) * 0.5;
  return speed < 0.001 ? 0 : speed;
}

export function dotBulgeOffset(
  anchorX: number,
  anchorY: number,
  currentX: number,
  currentY: number,
  mouseX: number,
  mouseY: number,
  cursorRadius: number,
  bulgeStrength: number,
  engagement: number,
): [number, number] {
  const dx = mouseX - anchorX;
  const dy = mouseY - anchorY;
  const distance = Math.hypot(dx, dy);
  if (distance >= cursorRadius || engagement <= 0.01) {
    return [
      currentX + (anchorX - currentX) * 0.1,
      currentY + (anchorY - currentY) * 0.1,
    ];
  }
  const amount =
    (1 - distance / cursorRadius) ** 2 * bulgeStrength * engagement;
  const angle = Math.atan2(dy, dx);
  return [
    currentX + (anchorX - Math.cos(angle) * amount - currentX) * 0.15,
    currentY + (anchorY - Math.sin(angle) * amount - currentY) * 0.15,
  ];
}
