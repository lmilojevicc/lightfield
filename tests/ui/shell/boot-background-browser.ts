import { expect } from "bun:test";

/**
 * Regression: a new tab must never mount the built-in default background while
 * the persisted selection is still loading. The pre-load snapshot is always the
 * defaults ("ink"), so any renderer started from it is destroyed moments later
 * and shows up as a background flicker.
 */
export async function assertBootBackground(
  browser: {
    command(method: string, params?: Record<string, unknown>): Promise<unknown>;
    evaluate<T>(expression: string): Promise<T>;
  },
  selected = "aurora",
) {
  const wait = (ms: number) =>
    new Promise<void>((done) => setTimeout(done, ms));
  const recorder = `(() => {
    window.__bootTrace = [];
    const t0 = performance.now();
    const at = () => Math.round(performance.now() - t0);
    const seen = new WeakSet();
    const record = (kind) => {
      const host = document.getElementById('background-host');
      const canvases = host ? [...host.querySelectorAll('canvas')] : [];
      window.__bootTrace.push({ t: at(), kind,
        docBackground: document.documentElement.dataset.background ?? null,
        preview: host ? host.querySelectorAll('.background-preview').length : -1 });
      for (const canvas of canvases)
        if (!seen.has(canvas)) {
          seen.add(canvas);
          window.__bootTrace.push({ t: at(), kind: 'canvas-first-seen', width: canvas.width });
        }
    };
    const attach = () => {
      const host = document.getElementById('background-host');
      if (!host) return void setTimeout(attach, 5);
      record('attached');
      new MutationObserver(() => record('host-mutated')).observe(host, {
        childList: true, subtree: true });
      new MutationObserver(() => record('doc-attr')).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-background'] });
    };
    attach();
  })()`;
  interface Entry {
    t: number;
    kind: string;
    docBackground: string | null;
    preview: number;
    width?: number;
  }
  const state = () =>
    browser.evaluate<{ id: string; canvas: boolean }>(
      `(() => { const host = document.querySelector('#background-host');
        const canvas = host.querySelector('canvas');
        return { id: document.documentElement.dataset.background ?? '',
          canvas: !!canvas && canvas.width > 0 && canvas.height > 0 }; })()`,
    );
  // Seed the saved selection on the already-loaded origin, then reload under
  // the recorder so the whole bootstrap is observed.
  await browser.evaluate(
    `localStorage.setItem('lightfield:settings', JSON.stringify({ background: ${JSON.stringify(selected)} }))`,
  );
  await browser.command("Page.addScriptToEvaluateOnNewDocument", {
    source: recorder,
  });
  await browser.command("Page.reload");
  const deadline = Date.now() + 8000;
  let current = await state();
  while (
    (current.id !== selected || !current.canvas) &&
    Date.now() < deadline
  ) {
    await wait(50);
    current = await state();
  }
  expect(current).toEqual({ id: selected, canvas: true });
  const trace = await browser.evaluate<Entry[]>("window.__bootTrace");
  expect(trace.length).toBeGreaterThan(0);
  // The old behaviour synchronously wrote the default background and could
  // mount its renderer before the saved selection arrived.
  expect(trace.filter((entry) => entry.docBackground === "ink")).toEqual([]);
  expect(
    trace.filter((entry) => entry.kind === "canvas-first-seen"),
  ).toHaveLength(1);
  expect(trace.filter((entry) => entry.preview > 0)).toEqual([]);
  console.log(
    `Boot background evidence: ${JSON.stringify({ selected, trace })}`,
  );
}
