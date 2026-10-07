/** Source indexed uniforms/resources are required; fail the owning generation if absent. */
export function requiredValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Background resource unavailable.");
  return value;
}
