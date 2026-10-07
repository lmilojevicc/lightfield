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
