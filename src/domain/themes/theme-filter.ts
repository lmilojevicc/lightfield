/** Match display names and legacy IDs without case, spacing or accent surprises. */
export function normalizeThemeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "")
    .trim();
}

export function themeMatchesSearch(
  query: string,
  displayName: string,
  id: string,
): boolean {
  const normalized = normalizeThemeSearch(query);
  return (
    normalizeThemeSearch(displayName).includes(normalized) ||
    normalizeThemeSearch(id).includes(normalized)
  );
}
