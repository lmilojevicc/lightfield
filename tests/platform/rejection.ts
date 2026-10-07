import { expect } from "bun:test";
/** Bun's rejects matcher is typed void. Await the operation explicitly so cancellation tests cannot pass early. */
export async function expectRejected(
  work: Promise<unknown>,
  message?: string | RegExp,
): Promise<void> {
  let rejected = false;
  let error: unknown;
  try {
    await work;
  } catch (reason) {
    rejected = true;
    error = reason;
  }
  expect(rejected).toBe(true);
  expect(() => {
    throw error;
  }).toThrow(message);
}
