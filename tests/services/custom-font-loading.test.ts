import { deferred, waitUntil } from "./deferred";
import type { FontEnvironment } from "../../src/services/custom-font-loading";
import { requiredValue } from "../../src/domain/required-value";
import { browserFontEnvironment } from "../../src/platform/browser";
/// <reference types="bun" />
import { afterEach, expect, test } from "bun:test";
import {
  FontRequestOwner,
  googleFontUrl,
  loadCustomFont as load,
  parseGoogleFontCss,
} from "../../src/services/custom-font-loading";
import { resolveFontFamily } from "../../src/domain/fonts/font-pairings";
const css = (
  weight: number | string = 400,
  url = "https://fonts.gstatic.com/s/inter/v1/test.woff2",
) =>
  `@font-face { font-family: 'Betania Patmos'; font-style: normal; font-weight: ${String(weight)}; src: url(${url}) format('woff2'); unicode-range: U+0000-00FF; }`;
const original = {
  fetch: globalThis.fetch,
  document: globalThis.document,
  FontFace: globalThis.FontFace,
};
afterEach(() => {
  Object.assign(globalThis, original);
});
test("CSS is parsed as constrained data, never passed through", () => {
  expect(parseGoogleFontCss(css())).toEqual([
    {
      weight: "400",
      url: "https://fonts.gstatic.com/s/inter/v1/test.woff2",
      unicodeRange: "U+0000-00FF",
    },
  ]);
  for (const url of [
    "https://evil.test/test.woff2",
    "https://fonts.gstatic.com/other/test.woff2",
    "https://fonts.gstatic.com/s/../test.woff2",
    "https://fonts.gstatic.com/s/inter/a.woff2?text=secret",
    "data:font/woff2,test",
  ])
    expect(() => parseGoogleFontCss(css(400, url))).toThrow();
  for (const weight of ["0", "1001", "900 100", "400 600 700", "garbage"])
    expect(() => parseGoogleFontCss(css(weight))).toThrow();
  expect(requiredValue(parseGoogleFontCss(css("100 900"))[0]).weight).toBe(
    "100 900",
  );
  expect(requiredValue(parseGoogleFontCss(css("normal"))[0]).weight).toBe(
    "400",
  );
  const url = new URL(googleFontUrl(resolveFontFamily("Inter", "body")));
  expect([...url.searchParams.keys()]).toEqual(["family"]);
  expect(url.searchParams.get("family")).toBe("Inter");
});
test("request ownership cancels A, never B, and permits same-key retry", () => {
  const owner = new FontRequestOwner();
  const a = owner.begin(),
    b = owner.begin();
  expect(a.signal.aborted).toBe(true);
  expect(a.current()).toBe(false);
  expect(b.current()).toBe(true);
  owner.cancel();
  expect(b.current()).toBe(false);
  expect(owner.begin().current()).toBe(true);
});
function mockBinary(fails: boolean) {
  const registered = new Set<unknown>();
  Object.assign(globalThis, {
    document: {
      fonts: {
        add: (face: unknown) => registered.add(face),
        delete: (face: unknown) => registered.delete(face),
      },
    },
    FontFace: class {
      status = "unloaded";
      constructor(
        public family: string,
        public source: string,
        public descriptors: unknown,
      ) {}
      load() {
        return Promise.resolve().then(() => {
          this.status = fails ? "error" : "loaded";
          if (fails) throw Error("Binary blocked");
          return this;
        });
      }
    },
    fetch: () => Promise.resolve(new Response(css())),
  });
  return registered;
}
test("mock CSS200 + binary failure is Unavailable; identical request can retry", async () => {
  const owner = new FontRequestOwner();
  const failed = mockBinary(true);
  expect(
    (await loadCustomFont("Inter", "display", owner.begin().signal)).state,
  ).toBe("unavailable");
  expect(failed.size).toBe(0);
  const registered = mockBinary(false);
  const result = await loadCustomFont("Inter", "display", owner.begin().signal);
  expect(result.state).toBe("ready");
  expect(registered.size).toBe(1);
  if (result.state === "ready") {
    expect(result.font.family.stack).toMatch(
      /^"LightfieldCustom\d+", Georgia, serif$/,
    );
    result.font.dispose();
  }
  expect(registered.size).toBe(0);
});
test("abort while CSS is pending never registers stale faces", async () => {
  const registered = mockBinary(false);
  let finish!: (value: Response) => void;
  globalThis.fetch = (() =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    })) as unknown as typeof fetch;
  const owner = new FontRequestOwner();
  const pending = loadCustomFont("Inter", "display", owner.begin().signal);
  owner.cancel();
  requiredValue(finish)(new Response(css()));
  expect((await pending).state).toBe("unavailable");
  expect(registered.size).toBe(0);
});
test("system choices do not fetch, and unregistered included family is not falsely Ready", async () => {
  let calls = 0;
  Object.assign(globalThis, {
    fetch: () => {
      return Promise.resolve().then(() => {
        calls++;
        throw Error("No external call allowed");
      });
    },
    document: { fonts: [] },
  });
  const signal = new AbortController().signal;
  expect((await loadCustomFont("system-ui", "body", signal)).state).toBe(
    "ready",
  );
  expect(
    (await loadCustomFont("Bricolage Grotesque", "body", signal)).state,
  ).toBe("unavailable");
  expect(calls).toBe(0);
});
test("abort during binary load cannot register a late decoded face", async () => {
  const registered = mockBinary(false);
  let complete: (() => void) | undefined;
  Object.assign(globalThis, {
    FontFace: class {
      status = "unloaded";
      load() {
        return new Promise((resolve) => {
          complete = () => {
            this.status = "loaded";
            resolve(this);
          };
        });
      }
    },
  });
  const owner = new FontRequestOwner();
  const pending = loadCustomFont("Inter", "display", owner.begin().signal);
  // Let the mocked fetch and response body continuations reach binary loading.
  for (let index = 0; index < 20 && !complete; index++) await Promise.resolve();
  expect(typeof complete).toBe("function");
  owner.cancel();
  requiredValue(complete)();
  expect((await pending).state).toBe("unavailable");
  expect(registered.size).toBe(0);
});
test("HTTP errors and invalid names remain retryable failures", async () => {
  mockBinary(false);
  const signal = new AbortController().signal;
  Object.assign(globalThis, {
    fetch: () =>
      Promise.resolve(new Response("Unknown family", { status: 400 })),
  });
  expect((await loadCustomFont("Unknown", "body", signal)).state).toBe(
    "unavailable",
  );
  Object.assign(globalThis, {
    fetch: () => Promise.resolve(new Response(css(400))),
  });
  expect((await loadCustomFont("Inter", "body", signal)).state).toBe("ready");
  expect((await loadCustomFont("Inter; Arial", "body", signal)).state).toBe(
    "unavailable",
  );
});

test("Betania Patmos regression: former required 400/600 check rejected a usable default", async () => {
  const descriptors = parseGoogleFontCss(css(400));
  expect(
    [400, 600].some(
      (weight) => !descriptors.some((face) => Number(face.weight) === weight),
    ),
  ).toBe(true);
  const registered = mockBinary(false);
  const requests: string[] = [];
  globalThis.fetch = ((url: string) => {
    return Promise.resolve().then(() => {
      requests.push(url);
      return url.includes(":wght@600")
        ? new Response("Unavailable weight", { status: 400 })
        : new Response(css(400));
    });
  }) as typeof fetch;
  const result = await loadCustomFont(
    "Betania Patmos",
    "body",
    new AbortController().signal,
  );
  expect(result.state).toBe("ready");
  if (result.state === "ready") {
    expect(result.font.family).toMatchObject({
      name: "Betania Patmos",
      baseWeight: 400,
      emphasisWeight: 400,
      weights: [400],
    });
    expect(result.font.faces).toHaveLength(1);
    result.font.dispose();
  }
  expect(requests).toEqual([
    "https://fonts.googleapis.com/css2?family=Betania%20Patmos",
    "https://fonts.googleapis.com/css2?family=Betania%20Patmos:wght@600",
  ]);
  expect(registered.size).toBe(0);
});
for (const fixture of [
  {
    label: "static400",
    base: css(400),
    extra: "",
    baseWeight: 400,
    emphasisWeight: 400,
    faceWeights: ["400"],
  },
  {
    label: "static400+600",
    base: css(400),
    extra: css(600),
    baseWeight: 400,
    emphasisWeight: 600,
    faceWeights: ["400", "600"],
  },
  {
    label: "default advertises both",
    base: css(400) + css(600),
    extra: "",
    baseWeight: 400,
    emphasisWeight: 600,
    faceWeights: ["400", "600"],
  },
  {
    label: "variable100900",
    base: css("100 900"),
    extra: "",
    baseWeight: 400,
    emphasisWeight: 600,
    faceWeights: ["100 900"],
  },
  {
    label: "static500only",
    base: css(500),
    extra: "",
    baseWeight: 500,
    emphasisWeight: 500,
    faceWeights: ["500"],
  },
  {
    label: "static700only",
    base: css(700),
    extra: "",
    baseWeight: 700,
    emphasisWeight: 700,
    faceWeights: ["700"],
  },
  {
    label: "static500+700",
    base: css(500) + css(700),
    extra: "",
    baseWeight: 500,
    emphasisWeight: 700,
    faceWeights: ["500", "700"],
  },
  {
    label: "range500700",
    base: css("500 700"),
    extra: "",
    baseWeight: 500,
    emphasisWeight: 600,
    faceWeights: ["500 700"],
  },
  {
    label: "normal default",
    base: css("normal"),
    extra: "",
    baseWeight: 400,
    emphasisWeight: 400,
    faceWeights: ["400"],
  },
  {
    label: "absent descriptor default",
    base: css().replace("font-weight: 400;", ""),
    extra: "",
    baseWeight: 400,
    emphasisWeight: 400,
    faceWeights: ["400"],
  },
])
  test(`verified capabilities: ${fixture.label}`, async () => {
    const registered = mockBinary(false);
    let requests = 0;
    globalThis.fetch = ((url: string) => {
      return Promise.resolve().then(() => {
        requests++;
        return new Response(
          url.includes(":wght@600") ? fixture.extra : fixture.base,
        );
      });
    }) as typeof fetch;
    const result = await loadCustomFont(
      "Betania Patmos",
      "body",
      new AbortController().signal,
    );
    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.font.family.baseWeight).toBe(fixture.baseWeight);
      expect(result.font.family.emphasisWeight).toBe(fixture.emphasisWeight);
      expect(
        result.font.faces.map(
          (face) =>
            (face as unknown as { descriptors: { weight: string } }).descriptors
              .weight,
        ),
      ).toEqual(fixture.faceWeights);
      result.font.dispose();
    }
    expect(requests).toBeLessThanOrEqual(2);
    expect(registered.size).toBe(0);
  });
for (const advertised of [false, true])
  test(`optional binary failure preserves base, advertised=${String(advertised)}`, async () => {
    const registered = mockBinary(false);
    Object.assign(globalThis, {
      FontFace: class {
        status = "unloaded";
        constructor(
          public family: string,
          public source: string,
          public descriptors: { weight: string },
        ) {}
        load() {
          return Promise.resolve().then(() => {
            this.status =
              this.descriptors.weight === "600" ? "error" : "loaded";
            if (this.status === "error") throw Error("Optional binary blocked");
            return this;
          });
        }
      },
      fetch: (url: string) =>
        Promise.resolve(
          new Response(
            url.includes(":wght@600")
              ? css(600)
              : css(400) + (advertised ? css(600) : ""),
          ),
        ),
    });
    const result = await loadCustomFont(
      "Betania Patmos",
      "body",
      new AbortController().signal,
    );
    expect(result.state).toBe("ready");
    expect(registered.size).toBe(1);
    if (result.state === "ready") {
      expect(result.font.family.emphasisWeight).toBe(400);
      expect(result.font.faces).toHaveLength(1);
      result.font.dispose();
    }
    expect(registered.size).toBe(0);
  });
test("abort between verified base and optional response registers neither; other owner survives", async () => {
  const registered = mockBinary(false);
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = (async (url: string) =>
    url.includes(":wght@600")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : new Response(css())) as typeof fetch;
  const owner = new FontRequestOwner(),
    other = new FontRequestOwner().begin();
  const pending = loadCustomFont(
    "Betania Patmos",
    "body",
    owner.begin().signal,
  );
  for (let i = 0; i < 50 && !finish; i++) await Promise.resolve();
  expect(typeof finish).toBe("function");
  owner.cancel();
  requiredValue(finish)(new Response(css(600)));
  expect((await pending).state).toBe("unavailable");
  expect(registered.size).toBe(0);
  expect(other.current()).toBe(true);
});
test("included genuine registered weights never request Google", async () => {
  const faces = [
    { family: "Bricolage Grotesque", status: "loaded", weight: "400 800" },
  ];
  let calls = 0;
  Object.assign(globalThis, {
    document: {
      fonts: Object.assign(faces, { load: () => Promise.resolve(faces) }),
    },
    fetch: () => {
      return Promise.resolve().then(() => {
        calls++;
        throw Error("No fetch");
      });
    },
  });
  const result = await loadCustomFont(
    "bricolage grotesque",
    "body",
    new AbortController().signal,
  );
  expect(result.state).toBe("ready");
  if (result.state === "ready")
    expect(result.font.family.weights).toEqual([400, 600]);
  expect(calls).toBe(0);
});

test("abort during optional binary decode drops late enhancement and verified draft base", async () => {
  const registered = mockBinary(false);
  let complete: (() => void) | undefined;
  Object.assign(globalThis, {
    FontFace: class {
      status = "unloaded";
      constructor(
        public family: string,
        public source: string,
        public descriptors: { weight: string },
      ) {}
      load() {
        if (this.descriptors.weight === "400") {
          this.status = "loaded";
          return Promise.resolve(this);
        }
        return new Promise((resolve) => {
          complete = () => {
            this.status = "loaded";
            resolve(this);
          };
        });
      }
    },
    fetch: (url: string) =>
      Promise.resolve(new Response(css(url.includes(":wght@600") ? 600 : 400))),
  });
  const owner = new FontRequestOwner();
  const pending = loadCustomFont(
    "Betania Patmos",
    "body",
    owner.begin().signal,
  );
  for (let i = 0; i < 50 && !complete; i++) await Promise.resolve();
  expect(typeof complete).toBe("function");
  owner.cancel();
  requiredValue(complete)();
  expect((await pending).state).toBe("unavailable");
  expect(registered.size).toBe(0);
});
test("same family retries have unique aliases and disposing a draft never removes active faces", async () => {
  const registered = mockBinary(false),
    signal = new AbortController().signal;
  const active = await loadCustomFont("Betania Patmos", "display", signal);
  const draft = await loadCustomFont("Betania Patmos", "display", signal);
  expect(active.state).toBe("ready");
  expect(draft.state).toBe("ready");
  if (active.state === "ready" && draft.state === "ready") {
    expect(active.font.family.stack).not.toBe(draft.font.family.stack);
    draft.font.dispose();
    expect(registered.size).toBe(1);
    expect(registered.has(active.font.faces[0])).toBe(true);
    active.font.dispose();
    expect(registered.size).toBe(0);
  }
});

function loadCustomFont(
  raw: string,
  role: "display" | "body",
  signal: AbortSignal,
) {
  return load(
    raw,
    role,
    signal,
    browserFontEnvironment(() => true),
  );
}
for (const stage of ["css", "body", "binary", "emphasis"] as const)
  test(`font revocation at deferred ${stage} stage never adopts faces or starts the next remote stage`, async () => {
    let allowed = true,
      requests = 0,
      reads = 0,
      created = 0;
    const responseGate = deferred<Response>(),
      textGate = deferred<string>(),
      binaryGate = deferred<undefined>();
    const registered = new Set<FontFace>();
    const env: FontEnvironment = {
      remoteAllowed: () => allowed,
      fonts: registered as unknown as FontFaceSet,
      fetch: () => {
        requests++;
        if (stage === "css") return responseGate.promise;
        const response = new Response(css(requests === 2 ? 600 : 400));
        if (stage === "body" || (stage === "emphasis" && requests === 2))
          response.text = () => {
            reads++;
            return textGate.promise;
          };
        return Promise.resolve(response);
      },
      createFace: () => {
        created++;
        const face = {
          status: "unloaded",
          load: () => {
            if (stage === "binary")
              return binaryGate.promise.then(() => {
                face.status = "loaded";
                return face as unknown as FontFace;
              });
            face.status = "loaded";
            return Promise.resolve(face as unknown as FontFace);
          },
        };
        return face as unknown as FontFace;
      },
    };
    const work = load(
      "Inter",
      stage === "emphasis" ? "body" : "display",
      new AbortController().signal,
      env,
    );
    await waitUntil(() =>
      stage === "css"
        ? requests === 1
        : stage === "binary"
          ? created === 1
          : reads === 1,
    );
    allowed = false;
    if (stage === "css") responseGate.resolve(new Response(css()));
    else if (stage === "binary") binaryGate.resolve(undefined);
    else textGate.resolve(css(stage === "emphasis" ? 600 : 400));
    expect((await work).state).toBe("unavailable");
    expect(registered.size).toBe(0);
    expect(requests).toBe(stage === "emphasis" ? 2 : 1);
    expect(created).toBe(stage === "binary" || stage === "emphasis" ? 1 : 0);
  });
