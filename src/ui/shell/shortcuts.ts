export function shortcutAction(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "defaultPrevented"
  >,
  state: { overlay: boolean; searching: boolean; editing: boolean },
): "search" | "settings" | "hide" | undefined {
  if (event.defaultPrevented || state.overlay) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
    return "search";
  if (event.metaKey || event.ctrlKey || event.altKey || state.editing) return;
  if (event.key === "/") return "search";
  if (event.key === ",") return "settings";
  if (event.key.toLowerCase() === "h" && !state.searching) return "hide";
}
