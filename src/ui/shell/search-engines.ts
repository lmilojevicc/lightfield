import type { SearchEngine } from "../../domain/settings/schema";
export const SEARCH_ENGINES: readonly {
  id: SearchEngine;
  name: string;
  badge: string;
}[] = [
  { id: "google", name: "Google", badge: "Default" },
  { id: "duckduckgo", name: "DuckDuckGo", badge: "Privacy first" },
  { id: "bing", name: "Bing", badge: "Microsoft" },
  { id: "brave", name: "Brave", badge: "Independent" },
  { id: "ecosia", name: "Ecosia", badge: "Eco-positive" },
  { id: "kagi", name: "Kagi", badge: "Account req." },
  { id: "startpage", name: "Startpage", badge: "No logs" },
  { id: "qwant", name: "Qwant", badge: "EU hosted" },
];

/** Shipped brand mark for an engine; the only place the asset path is defined. */
export function engineIconPath(id: SearchEngine): string {
  return `icons/engines/${id}.svg`;
}

/** Upstream collection entry each shipped mark came from, for provenance and tests. */
export function engineIconSource(id: SearchEngine): string {
  if (id === "kagi") return "selfhst:kagi";
  // The plain brave mark is a dark cut-out; the browser variant is the orange/white one.
  return id === "brave" ? "thesvg-color:brave-browser" : `thesvg-color:${id}`;
}
