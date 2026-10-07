export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let step = 0; step < 100; step++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Deferred stage was not reached.");
}
