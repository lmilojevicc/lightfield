export type SettingsCategory =
  "search" | "appearance" | "background" | "fonts" | "time-date";
export type SettingsPresentation = "modal" | "drawer";
const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  "search",
  "appearance",
  "background",
  "fonts",
  "time-date",
];

/** A single projection owns both modal tabs and the drawer's unfiltered stack. */
export function projectSettingsPresentation(
  sheet: HTMLElement,
  items: readonly HTMLButtonElement[],
  sections: ReadonlyMap<SettingsCategory, HTMLElement>,
  mode: SettingsPresentation,
  category: SettingsCategory,
): void {
  sheet.dataset.presentation = mode;
  for (const [id, section] of sections) {
    const selected = id === category;
    const visible = mode === "drawer" || selected;
    section.hidden = !visible;
    section.toggleAttribute("inert", !visible);
    section.setAttribute("aria-hidden", String(!visible));
    section.classList.toggle("is-active", selected);
    section.setAttribute("role", mode === "modal" ? "tabpanel" : "region");
    const heading = section.querySelector<HTMLElement>(".panel__title");
    if (heading) {
      heading.id ||= `${section.id}-heading`;
      heading.tabIndex = -1;
      section.setAttribute(
        "aria-labelledby",
        mode === "drawer"
          ? heading.id
          : (items.find((item) => item.dataset.settingsNav === id)?.id ??
              heading.id),
      );
    }
  }
  for (const item of items) {
    const selected = item.dataset.settingsNav === category;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-selected", String(selected));
    item.setAttribute("aria-current", String(selected));
    const section = sections.get(item.dataset.settingsNav as SettingsCategory);
    if (section) item.setAttribute("aria-controls", section.id);
    item.classList.toggle("is-active", selected);
    item.tabIndex = selected ? 0 : -1;
  }
}

export function categoryForKey(
  category: SettingsCategory,
  key: string,
): SettingsCategory | undefined {
  const index = SETTINGS_CATEGORIES.indexOf(category);
  if (key === "Home") return SETTINGS_CATEGORIES[0];
  if (key === "End") return SETTINGS_CATEGORIES.at(-1);
  if (key === "ArrowDown" || key === "ArrowRight")
    return SETTINGS_CATEGORIES[(index + 1) % SETTINGS_CATEGORIES.length];
  if (key === "ArrowUp" || key === "ArrowLeft")
    return SETTINGS_CATEGORIES[
      (index + SETTINGS_CATEGORIES.length - 1) % SETTINGS_CATEGORIES.length
    ];
}
