import { test, expect } from "bun:test";
import { relocate } from "../../../src/ui/backgrounds/control-state";

// Narrow DOM boundary: assert identity/focus transfer, not browser layout or pixels.
test("the same live group and dirty input move to the tuner and return home", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  class Element {
    parentElement: Element | null = null;
    children: Element[] = [];
    value = "";
    focusCalls = 0;
    isConnected = true;
    ownerDocument: { activeElement: Element | null } = { activeElement: null };
    contains(node: Element) {
      return this === node || this.children.includes(node);
    }
    focus() {
      this.focusCalls++;
      this.ownerDocument.activeElement = this;
    }
    append(node: Element) {
      if (node.parentElement)
        node.parentElement.children = node.parentElement.children.filter(
          (child) => child !== node,
        );
      this.children.push(node);
      node.parentElement = this;
      node.ownerDocument.activeElement = null; // Legacy append may blur the input.
    }
  }
  Object.defineProperty(globalThis, "HTMLElement", {
    value: Element,
    configurable: true,
  });
  try {
    const home = new Element(),
      tuner = new Element(),
      group = new Element(),
      input = new Element();
    group.children.push(input);
    group.parentElement = home;
    home.children.push(group);
    input.ownerDocument = group.ownerDocument;
    input.value = "#invalid";
    group.ownerDocument.activeElement = input;
    relocate(group as unknown as HTMLElement, tuner as unknown as HTMLElement);
    expect(tuner.children[0]).toBe(group);
    expect(group.children[0]).toBe(input);
    expect(input.value).toBe("#invalid");
    expect(input.focusCalls).toBe(1);
    expect(group.ownerDocument.activeElement).toBe(input);
    group.ownerDocument.activeElement = input;
    relocate(group as unknown as HTMLElement, home as unknown as HTMLElement);
    expect(home.children[0]).toBe(group);
    expect(group.children[0]).toBe(input);
    expect(input.value).toBe("#invalid");
    expect(input.focusCalls).toBe(2);
  } finally {
    if (prior) Object.defineProperty(globalThis, "HTMLElement", prior);
    else Reflect.deleteProperty(globalThis, "HTMLElement");
  }
});
