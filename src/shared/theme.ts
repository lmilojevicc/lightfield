// Authored theme/shader palettes copied from backgrounds/palette.ts; no DOM color reader here.
export interface ThemePalette {
  paper: [number, number, number];
  paperHex: string;
  ink: [number, number, number];
  inkHex: string;
  accent: [number, number, number];
  accentHex: string;
  focus: [number, number, number];
  focusHex: string;
  /** True when the paper is light enough that opaque effects must lift toward it. */
  lightTheme: boolean;
  shaderPalette?: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
}

export const BUILTIN_THEME_IDS = [
  "midnight",
  "ivory",
  "slate",
  "moss",
  "catppuccin-latte",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "gruvbox",
  "tokyonight",
  "rosepine",
  "rosepine-dawn",
  "nord",
  "solarized-dark",
  "kanagawa",
  "kanagawa-dragon",
  "kanagawa-lotus",
  "everforest",
  "everforest-light",
  "night-owl",
  "night-owl-light",
  "github-dark",
  "onedark",
  "ayu-mirage",
  "ayu-dark",
  "ayu-light",
  "dracula",
  "monokai",
  "monokai-dimmed",
  "solarized-light",
  "gruvbox-light",
  "nord-light",
  "tokyonight-storm",
  "tokyonight-moon",
  "rosepine-moon",
  "monochrome",
] as const;
export type ThemeName = (typeof BUILTIN_THEME_IDS)[number];

export interface CustomTheme {
  id: string;
  name: string;
  paper: string;
  ink: string;
  accent: string;
}

export interface CustomThemeContrastWarning {
  foreground: string;
  background: string;
  label: string;
  ratio: number;
  minimum: number;
}

export interface CustomThemeImportResult {
  themes: CustomTheme[];
  importedCount: number;
  remappedCount: number;
  warningCount: number;
}

export interface CustomThemeSemanticTokens {
  paper2: string;
  ink2: string;
  muted: string;
  accentInk: string;
  accentText: string;
  accentBoundary: string;
  control: string;
  focus: string;
}

export function hexToRgb(value: string): [number, number, number] {
  const channel = (index: number) =>
    parseInt(value.slice(index, index + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

export const ISLAND_THEME_PALETTES: Record<
  string,
  readonly [string, string, string, string]
> = {
  // 36 shipped themes:
  midnight: ["#04050b", "#141a3d", "#4a3a86", "#38bdf8"],
  ivory: ["#faf8f5", "#ede6d8", "#d4c5af", "#c25e1a"],
  slate: ["#181b20", "#28303a", "#485668", "#38bdf8"],
  moss: ["#060e08", "#0f2416", "#264e34", "#52c47a"],
  "catppuccin-latte": ["#eff1f5", "#dce0e8", "#9ca0b0", "#fe640b"],
  "catppuccin-frappe": ["#232634", "#303446", "#51576d", "#ef9f76"],
  "catppuccin-macchiato": ["#181926", "#24273a", "#494d64", "#f5a97f"],
  "catppuccin-mocha": ["#11111b", "#1e1e2e", "#45475a", "#cba6f7"],
  gruvbox: ["#1d2021", "#282828", "#665c54", "#fe8019"],
  tokyonight: ["#13141f", "#1a1b26", "#3b4261", "#7aa2f7"],
  rosepine: ["#110f1a", "#26233a", "#56526e", "#eb6f92"],
  "rosepine-dawn": ["#faf4ed", "#f2e9e1", "#cebebc", "#d7827e"],
  nord: ["#1e222a", "#2e3440", "#4c566a", "#88c0d0"],
  "solarized-dark": ["#001e26", "#002b36", "#073642", "#268bd2"],
  kanagawa: ["#121217", "#1f1f28", "#363646", "#7e9cd8"],
  "kanagawa-dragon": ["#101015", "#181820", "#54546d", "#7e9cd8"],
  "kanagawa-lotus": ["#f2ecbc", "#e7dba0", "#a29d89", "#4d699b"],
  everforest: ["#232a2e", "#2d353b", "#475258", "#a7c080"],
  "everforest-light": ["#fdf6e3", "#f0ebd4", "#bdc4a7", "#8da101"],
  "night-owl": ["#010e1a", "#011627", "#0b2942", "#82aaff"],
  "night-owl-light": ["#fbfbfb", "#eaeef3", "#b5c4d4", "#4876d6"],
  "github-dark": ["#080b0f", "#0d1117", "#21262d", "#2f81f7"],
  onedark: ["#1e2227", "#282c34", "#3e4451", "#61afef"],
  "ayu-mirage": ["#171b24", "#212733", "#3d4751", "#ffcc66"],
  "ayu-dark": ["#080b0e", "#0f1419", "#24303c", "#f29718"],
  "ayu-light": ["#fafafa", "#f0eee4", "#d2ccc4", "#ff6a00"],
  dracula: ["#1a1c23", "#282a36", "#44475a", "#bd93f9"],
  monokai: ["#1a1b16", "#272822", "#49483e", "#f92672"],
  "monokai-dimmed": ["#141414", "#1e1e1e", "#383838", "#f92672"],
  "solarized-light": ["#fdf6e3", "#eee8d5", "#d5c9b3", "#268bd2"],
  "gruvbox-light": ["#fbf1c7", "#ebdbb2", "#c2af8e", "#af3a03"],
  "nord-light": ["#eceff4", "#d8dee9", "#a3b2c6", "#5e81ac"],
  "tokyonight-storm": ["#1a1d2d", "#24283b", "#414868", "#7aa2f7"],
  "tokyonight-moon": ["#191a27", "#222436", "#444a73", "#82aaff"],
  "rosepine-moon": ["#191728", "#232136", "#44415a", "#ebbcba"],
  monochrome: ["#060606", "#1e1e1e", "#444444", "#e5e5e5"],

  // Aliases & legacy demo presets:
  "rose-pine": ["#110f1a", "#26233a", "#56526e", "#eb6f92"],
  charcoal: ["#0a0a0c", "#1e1e24", "#3a3a44", "#e2e8f0"],
  chalk: ["#f6f4ee", "#e7e3d8", "#c8bca8", "#c2410c"],
  cyberpunk: ["#050510", "#190b34", "#7700a6", "#ff007f"],
  sepia: ["#120e0a", "#2e2116", "#784b25", "#f59e0b"],
  emerald: ["#040e08", "#0b2a1a", "#1b6343", "#34d399"],
  obsidian: ["#000000", "#09090f", "#262338", "#818cf8"],
};

export type PaletteStops = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/** The native DOM adapter supplies the active theme; shared code never reads document. */
export function resolveShaderPalette(
  palette: ThemePalette,
  shaderPalettes?: { night?: readonly string[]; day?: readonly string[] },
  theme?: string,
): PaletteStops {
  if (palette.shaderPalette) {
    return [
      [...palette.shaderPalette[0]],
      [...palette.shaderPalette[1]],
      [...palette.shaderPalette[2]],
      [...palette.shaderPalette[3]],
    ];
  }
  if (theme && ISLAND_THEME_PALETTES[theme]) {
    const p = ISLAND_THEME_PALETTES[theme];
    return [hexToRgb(p[0]), hexToRgb(p[1]), hexToRgb(p[2]), hexToRgb(p[3])];
  }
  if (shaderPalettes) {
    const palHex = palette.lightTheme
      ? (shaderPalettes.day ?? shaderPalettes.night)
      : (shaderPalettes.night ?? shaderPalettes.day);
    if (palHex && palHex.length >= 4) {
      const [first, second, third, fourth] = palHex;
      if (
        first === undefined ||
        second === undefined ||
        third === undefined ||
        fourth === undefined
      ) {
        throw new TypeError("Shader palettes require four color stops");
      }
      return [
        hexToRgb(first),
        hexToRgb(second),
        hexToRgb(third),
        hexToRgb(fourth),
      ];
    }
  }
  const c0 = palette.paper;
  const c3 = palette.accent;
  return [
    [c0[0], c0[1], c0[2]],
    [
      c0[0] + (c3[0] - c0[0]) * 0.3,
      c0[1] + (c3[1] - c0[1]) * 0.3,
      c0[2] + (c3[2] - c0[2]) * 0.3,
    ],
    [
      c0[0] + (c3[0] - c0[0]) * 0.7,
      c0[1] + (c3[1] - c0[1]) * 0.7,
      c0[2] + (c3[2] - c0[2]) * 0.7,
    ],
    [c3[0], c3[1], c3[2]],
  ];
}
