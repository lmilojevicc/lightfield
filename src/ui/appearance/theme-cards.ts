import type { ThemeName } from "../../shared/theme";

/** Source display order and labels; swatches use authored data-theme-card CSS. */
export const THEME_CARDS: readonly {
  id: ThemeName;
  name: string;
  tone: string;
}[] = [
  {
    id: "midnight",
    name: "Midnight",
    tone: "Dark",
  },
  {
    id: "monochrome",
    name: "Monochrome",
    tone: "Dark",
  },
  {
    id: "ivory",
    name: "Ivory",
    tone: "Light",
  },
  {
    id: "slate",
    name: "Slate",
    tone: "Dark",
  },
  {
    id: "moss",
    name: "Moss",
    tone: "Dark",
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    tone: "Light",
  },
  {
    id: "catppuccin-frappe",
    name: "Catppuccin Frappé",
    tone: "Dark",
  },
  {
    id: "catppuccin-macchiato",
    name: "Catppuccin Macchiato",
    tone: "Dark",
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    tone: "Dark",
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    tone: "Dark",
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    tone: "Light",
  },
  {
    id: "tokyonight",
    name: "Tokyo Night",
    tone: "Dark",
  },
  {
    id: "tokyonight-storm",
    name: "Tokyo Night Storm",
    tone: "Dark",
  },
  {
    id: "tokyonight-moon",
    name: "Tokyo Night Moon",
    tone: "Dark",
  },
  {
    id: "rosepine",
    name: "Rosé Pine",
    tone: "Dark",
  },
  {
    id: "rosepine-moon",
    name: "Rosé Pine Moon",
    tone: "Dark",
  },
  {
    id: "rosepine-dawn",
    name: "Rosé Pine Dawn",
    tone: "Light",
  },
  {
    id: "nord",
    name: "Nord",
    tone: "Dark",
  },
  {
    id: "nord-light",
    name: "Nord Light",
    tone: "Light",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    tone: "Dark",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    tone: "Light",
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    tone: "Dark",
  },
  {
    id: "kanagawa-dragon",
    name: "Kanagawa Dragon",
    tone: "Dark",
  },
  {
    id: "kanagawa-lotus",
    name: "Kanagawa Lotus",
    tone: "Light",
  },
  {
    id: "everforest",
    name: "Everforest",
    tone: "Dark",
  },
  {
    id: "everforest-light",
    name: "Everforest Light",
    tone: "Light",
  },
  {
    id: "night-owl",
    name: "Night Owl",
    tone: "Dark",
  },
  {
    id: "night-owl-light",
    name: "Night Owl Light",
    tone: "Light",
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    tone: "Dark",
  },
  {
    id: "onedark",
    name: "One Dark",
    tone: "Dark",
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    tone: "Dark",
  },
  {
    id: "ayu-mirage",
    name: "Ayu Mirage",
    tone: "Dark",
  },
  {
    id: "ayu-light",
    name: "Ayu Light",
    tone: "Light",
  },
  {
    id: "dracula",
    name: "Dracula",
    tone: "Dark",
  },
  {
    id: "monokai",
    name: "Monokai",
    tone: "Dark",
  },
  {
    id: "monokai-dimmed",
    name: "Monokai Dimmed",
    tone: "Dark",
  },
];

export function themeMatchesSearch(
  query: string,
  name: string,
  id: string,
): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[\s-]+/g, "")
      .trim();
  return (
    normalize(name).includes(normalize(query)) ||
    normalize(id).includes(normalize(query))
  );
}
