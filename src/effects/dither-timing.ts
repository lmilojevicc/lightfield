export function ditherElapsedTime(
  startTime: number,
  now: number,
  enabled: boolean,
  frozenTime: number,
) {
  return enabled ? (now - startTime) / 1000 : frozenTime;
}
