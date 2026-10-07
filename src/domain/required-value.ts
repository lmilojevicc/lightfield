/** Checked access for bounded headers/tuples; malformed input never becomes an unchecked cast. */
export function requiredValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required value is missing.");
  return value;
}
