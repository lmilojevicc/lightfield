import { expect } from "bun:test";

/** Uses the settings smoke's owned browser and production page; never focuses the search input. */
export async function assertSearchFocus(browser: {
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
}) {
  const wait = (ms: number) =>
    new Promise<void>((done) => setTimeout(done, ms));
  const shortcuts = [
    { name: "/", key: "/", code: "Slash", modifiers: 0, text: "/" },
    { name: "Cmd+K", key: "k", code: "KeyK", modifiers: 4, text: "" },
    { name: "Ctrl+K", key: "k", code: "KeyK", modifiers: 2, text: "" },
  ];
  const press = async (key: string, code = key, modifiers = 0, text = "") => {
    await browser.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      modifiers,
      text,
      windowsVirtualKeyCode: key === "Enter" ? 13 : undefined,
    });
    await browser.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      modifiers,
    });
  };
  const state = () =>
    browser.evaluate<{
      focus: string;
      value: string;
      searching: boolean;
      inert: boolean;
      ariaHidden: string;
    }>(`(() => {
      const form = document.querySelector('#search-form');
      return {focus: document.activeElement.id,
        value: document.querySelector('#search-input').value,
        searching: document.querySelector('#island').classList.contains('is-searching'),
        inert: form.inert, ariaHidden: form.getAttribute('aria-hidden')};
    })()`);
  const reload = async () => {
    await browser.command("Page.reload");
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      ready = await browser.evaluate<boolean>(
        `document.readyState === 'complete' && !!document.querySelector('#search-input')`,
      );
      if (!ready) await wait(50);
    }
    expect(ready).toBe(true);
    await browser.evaluate("document.fonts.ready.then(() => true)");
    await wait(300);
  };
  const pointerClick = async (id: string) => {
    const center = () =>
      browser.evaluate<{ x: number; y: number }>(
        `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
        return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`,
      );
    await browser.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...(await center()),
    });
    // Hover expands the date and moves Search; aim at its settled position.
    await wait(400);
    const point = await center();
    for (const type of ["mousePressed", "mouseReleased"])
      await browser.command("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
  };
  const failures: unknown[] = [];
  for (const motion of ["no-preference", "reduce"]) {
    await browser.command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: motion }],
    });
    for (const shortcut of shortcuts) {
      // Each shortcut gets its own first activation, with fully settled collapsed CSS.
      await reload();
      await browser.evaluate(`window.__searchActivation = null;
        window.addEventListener('keydown', event => {
          if (event.key !== '/' && event.key !== 'k') return;
          const form = document.querySelector('#search-form');
          window.__searchActivation = {focus: document.activeElement.id,
            visibility: getComputedStyle(form).visibility, inert: form.inert,
            prevented: event.defaultPrevented};
        });`);
      await press(
        shortcut.key,
        shortcut.code,
        shortcut.modifiers,
        shortcut.text,
      );
      // Native text input goes to the current focus, with no polling, fill(), or focus repair.
      await press("a", "KeyA", 0, "a");
      await press("b", "KeyB", 0, "b");
      const activation = await browser.evaluate<unknown>(
        "window.__searchActivation",
      );
      const typed = await state();
      console.log(
        `Search first activation ${shortcut.name} (${motion}): ${JSON.stringify({ activation, typed })}`,
      );
      const expectedActivation = {
        focus: "search-input",
        visibility: "visible",
        inert: false,
        prevented: true,
      };
      if (
        JSON.stringify(activation) !== JSON.stringify(expectedActivation) ||
        typed.value !== "ab" ||
        typed.focus !== "search-input"
      ) {
        failures.push({ shortcut: shortcut.name, motion, activation, typed });
        continue;
      }
      expect(typed).toEqual({
        focus: "search-input",
        value: "ab",
        searching: true,
        inert: false,
        ariaHidden: "false",
      });
      // Escape clears first, then collapses and restores the fallback clock target.
      await press("Escape");
      expect(await state()).toEqual({ ...typed, value: "" });
      await press("Escape");
      expect(await state()).toEqual({
        focus: "island-time-btn",
        value: "",
        searching: false,
        inert: true,
        ariaHidden: "true",
      });
      // Reverse the collapse immediately, then cancel before the morph can finish.
      await press(
        shortcut.key,
        shortcut.code,
        shortcut.modifiers,
        shortcut.text,
      );
      await press("c", "KeyC", 0, "c");
      expect((await state()).value).toBe("c");
      await press("Escape");
      await press("Escape");
      await wait(450);
      expect(await state()).toEqual({
        focus: "island-time-btn",
        value: "",
        searching: false,
        inert: true,
        ariaHidden: "true",
      });
      expect(
        await browser.evaluate<string>(
          `getComputedStyle(document.querySelector('#search-form')).visibility`,
        ),
      ).toBe("hidden");
    }
    for (const trigger of ["island-search-hint", "island-time-btn"]) {
      await reload();
      // Real pointer activation focuses the trigger before it becomes inert.
      // Failed input focus can otherwise queue focusout's collapse microtask.
      await pointerClick(trigger);
      await press("a", "KeyA", 0, "a");
      await press("b", "KeyB", 0, "b");
      const typed = await state();
      console.log(
        `Search pointer activation ${trigger} (${motion}): ${JSON.stringify(typed)}`,
      );
      if (
        typed.focus !== "search-input" ||
        typed.value !== "ab" ||
        !typed.searching
      ) {
        failures.push({ trigger, motion, typed });
        continue;
      }
      expect(typed).toEqual({
        focus: "search-input",
        value: "ab",
        searching: true,
        inert: false,
        ariaHidden: "false",
      });
      await wait(450);
      expect(await state()).toEqual(typed);
      await press("Escape");
      await press("Escape");
      const collapsed = {
        focus: trigger,
        value: "",
        searching: false,
        inert: true,
        ariaHidden: "true",
      };
      expect(await state()).toEqual(collapsed);
      await wait(450);
      await pointerClick(trigger);
      await press("c", "KeyC", 0, "c");
      expect((await state()).value).toBe("c");
      await press("Escape");
      await wait(450);
      await browser.evaluate(
        `document.querySelector('#search-collapse-btn').focus()`,
      );
      expect((await state()).focus).toBe("search-collapse-btn");
      await press("Enter", "Enter", 0, "\r");
      expect(await state()).toEqual(collapsed);
      await wait(450);
      expect(await state()).toEqual(collapsed);
    }
  }
  expect(failures).toEqual([]);
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 20,
    y: 20,
  });
  await browser.command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  const click = async (selector: string) => {
    await browser.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await wait(350);
  };
  await click("#settings-open");
  await browser.evaluate(`document.querySelector('#settings-close').focus()`);
  for (const shortcut of shortcuts) {
    await press(shortcut.key, shortcut.code, shortcut.modifiers, shortcut.text);
    expect((await state()).searching).toBe(false);
    expect((await state()).focus).toBe("settings-close");
  }
  await click('[data-settings-nav="search"]');
  await click('[data-setting="showSearch"]');
  await click("#settings-close");
  for (const shortcut of shortcuts) {
    await press(shortcut.key, shortcut.code, shortcut.modifiers, shortcut.text);
    expect((await state()).searching).toBe(false);
    expect((await state()).inert).toBe(true);
    expect((await state()).focus).not.toBe("search-input");
  }
  await click("#settings-open");
  await click('[data-setting="showSearch"]');
  await click('[data-settings-nav="appearance"]');
  await click('input[name="islandMode"][value="hidden"]');
  await click("#settings-close");
  for (const shortcut of shortcuts) {
    expect(
      await browser.evaluate<boolean>(
        `document.querySelector('#island').inert`,
      ),
    ).toBe(true);
    await press(shortcut.key, shortcut.code, shortcut.modifiers, shortcut.text);
    await press("x", "KeyX", 0, "x");
    expect(await state()).toEqual({
      focus: "search-input",
      value: "x",
      searching: true,
      inert: false,
      ariaHidden: "false",
    });
    await press("Escape");
    await press("Escape");
    expect((await state()).focus).toBe("island-reveal");
    expect((await state()).inert).toBe(true);
    await wait(450);
    expect((await state()).focus).toBe("island-reveal");
  }
  console.log(
    "Search guards: overlay, disabled search, Hidden-mode reveal and focus restoration passed",
  );
}
