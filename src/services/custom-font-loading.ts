function requestCancelled(signal: AbortSignal): boolean {
  return signal.aborted;
}
import { requiredValue } from "../domain/required-value";
import {
  resolveFontFamily,
  type FontFamily,
  type FontRole,
} from "../domain/fonts/font-pairings";

/** Request generations own CSS, binary completion and cleanup, never active faces. */
export class FontRequestOwner {
  private generation = 0;
  private controller: AbortController | null = null;
  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }
  begin() {
    this.cancel();
    const generation = this.generation;
    const controller = (this.controller = new AbortController());
    return {
      signal: controller.signal,
      current: () =>
        generation === this.generation && !requestCancelled(controller.signal),
    };
  }
}
export interface LoadedFont {
  family: FontFamily;
  faces: FontFace[];
  dispose(): void;
}
export type FontLoadResult =
  | { state: "ready"; font: LoadedFont }
  | { state: "unavailable"; message: string };
let aliasSequence = 0;
export function googleFontUrl(family: FontFamily, emphasis = false): string {
  // An axis-free request asks Google for the available default, not assumed 400/600.
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.name)}${emphasis ? ":wght@600" : ""}`;
}
export interface RemoteFaceDescriptor {
  url: string;
  weight: string;
  unicodeRange: string;
}
/** Parse only the data we need. Remote CSS is never inserted or executed. */
export function parseGoogleFontCss(css: string): RemoteFaceDescriptor[] {
  if (css.length > 100_000) throw new Error("Font response too large.");
  const blocks = [...css.matchAll(/@font-face\s*\{([^{}]+)\}/g)];
  if (!blocks.length || blocks.length > 100)
    throw new Error("No font faces returned.");
  return blocks.map(([, block]) => {
    const property = (key: string) =>
      requiredValue(block)
        .match(new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([^;]+)`))?.[1]
        ?.trim();
    const rawWeight = property("font-weight") ?? "normal";
    const weight =
      rawWeight === "normal" ? "400" : rawWeight === "bold" ? "700" : rawWeight;
    const range = weight.split(/\s+/).map(Number);
    if (
      !/^\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?)?$/.test(weight) ||
      range.some((value) => value < 1 || value > 1000) ||
      (range.length === 2 &&
        requiredValue(range[0]) > requiredValue(range[1])) ||
      (property("font-style") ?? "normal") !== "normal"
    )
      throw new Error("Unexpected font weight or style.");
    const src = property("src") ?? "";
    const match = src.match(
      /^url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/s\/[a-zA-Z0-9_/-]+\.(?:woff2?|ttf))['"]?\s*\)(?:\s*format\(['"](?:woff2?|truetype)['"]\))?$/,
    );
    if (!match) throw new Error("Unapproved font source.");
    const unicodeRange = property("unicode-range") ?? "U+0-10FFFF";
    if (
      !/^U\+[\dA-F?]+(?:-[\dA-F]+)?(?:\s*,\s*U\+[\dA-F?]+(?:-[\dA-F]+)?)*$/i.test(
        unicodeRange,
      )
    )
      throw new Error("Invalid font range.");
    return { url: requiredValue(match[1]), weight, unicodeRange };
  });
}
function withinRequest<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      finish(() => {
        reject(new DOMException("Cancelled", "AbortError"));
      });
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error("Font request timed out."));
      });
    }, 15000);
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      callback();
    };
    if (requestCancelled(signal)) abort();
    else {
      signal.addEventListener("abort", abort, { once: true });
      work.then(
        (value) => {
          finish(() => {
            resolve(value);
          });
        },
        (error: unknown) => {
          finish(() => {
            reject(
              error instanceof Error ? error : new Error("Font unavailable."),
            );
          });
        },
      );
    }
  });
}
export interface FontEnvironment {
  fonts: FontFaceSet;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  createFace(
    family: string,
    source: string,
    descriptors: FontFaceDescriptors,
  ): FontFace;
  remoteAllowed(): boolean;
}
export async function loadCustomFont(
  raw: string,
  role: FontRole,
  signal: AbortSignal,
  env: FontEnvironment,
): Promise<FontLoadResult> {
  const faces: FontFace[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    faces.forEach((face) => env.fonts.delete(face));
  };
  try {
    const family = resolveFontFamily(raw, role);
    if (requestCancelled(signal))
      throw new DOMException("Cancelled", "AbortError");
    if (family.source === "system")
      return { state: "ready", font: { family, faces, dispose } };
    if (family.source === "included") {
      const registered = [...env.fonts].filter(
        (face) => face.family.replace(/^['"]|['"]$/g, "") === family.name,
      );
      if (!registered.length) throw new Error("Included font is missing.");
      const loaded = await withinRequest(
        Promise.all(
          family.weights.map((weight) =>
            env.fonts.load(
              `${String(weight)} 20px ${JSON.stringify(family.name)}`,
              "José −12° Today’s Focus",
            ),
          ),
        ),
        signal,
      );
      if (
        loaded.some(
          (matches) =>
            !matches.length ||
            matches.some(
              (face) => face.status !== "loaded" || !registered.includes(face),
            ),
        )
      )
        throw new Error("Included font is unavailable.");
      return { state: "ready", font: { family, faces, dispose } };
    }
    const authorize = () => {
      if (requestCancelled(signal))
        throw new DOMException("Cancelled", "AbortError");
      if (!env.remoteAllowed())
        throw new Error("Remote fonts require consent.");
    };
    authorize();
    const requestCss = async (emphasis = false) => {
      authorize();
      const response = await withinRequest(
        env.fetch(googleFontUrl(family, emphasis), {
          signal,
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        }),
        signal,
      );
      authorize();
      if (!response.ok)
        throw new Error("Google Fonts did not return this family.");
      const css = await withinRequest(response.text(), signal);
      authorize();
      return parseGoogleFontCss(css);
    };
    const descriptors = await requestCss();
    const alias = `LightfieldCustom${String(++aliasSequence)}`;
    const nearestWeight = (face: RemoteFaceDescriptor, target: number) => {
      const [min, max = min] = face.weight.split(/\s+/).map(Number) as [
        number,
        number?,
      ];
      return Math.max(min, Math.min(max, target));
    };
    const chooseWeight = (
      available: RemoteFaceDescriptor[],
      target: number,
      stronger = false,
    ) =>
      requiredValue(
        available
          .map((face) => nearestWeight(face, target))
          .sort(
            (a, b) =>
              Math.abs(a - target) - Math.abs(b - target) ||
              (stronger ? b - a : a - b),
          )[0],
      );
    // FontFace URL loading uses font-src, not connect-src. Remote descriptors
    // remain truthful (including variable ranges); registration follows decoding.
    const decode = async (available: RemoteFaceDescriptor[]) => {
      authorize();
      const pending = available.map((descriptor) =>
        env.createFace(alias, `url("${descriptor.url}")`, {
          weight: descriptor.weight,
          style: "normal",
          unicodeRange: descriptor.unicodeRange,
          display: "swap",
        }),
      );
      authorize();
      await withinRequest(
        Promise.all(
          pending.map((face) => {
            authorize();
            return face.load();
          }),
        ),
        signal,
      );
      authorize();
      if (
        requestCancelled(signal) ||
        pending.some((face) => face.status !== "loaded")
      )
        throw new Error("Font binaries unavailable.");
      return pending;
    };
    const baseWeight = chooseWeight(descriptors, 400);
    const baseDescriptors = descriptors.filter(
      (face) => nearestWeight(face, baseWeight) === baseWeight,
    );
    faces.push(...(await decode(baseDescriptors)));
    let loadedDescriptors = baseDescriptors;
    if (
      role === "body" &&
      baseWeight < 600 &&
      !baseDescriptors.some((face) => nearestWeight(face, 600) === 600)
    ) {
      try {
        const advertised = descriptors.filter(
          (face) => nearestWeight(face, 600) > baseWeight,
        );
        const optional = (
          advertised.length ? advertised : await requestCss(true)
        ).filter(
          (face) =>
            nearestWeight(face, 600) > baseWeight &&
            !baseDescriptors.some(
              (base) =>
                base.url === face.url &&
                base.weight === face.weight &&
                base.unicodeRange === face.unicodeRange,
            ),
        );
        if (optional.length) {
          const decoded = await decode(optional);
          faces.push(...decoded);
          loadedDescriptors = [...baseDescriptors, ...optional];
        }
      } catch {
        // Emphasis is optional. Failed/late optional faces were never registered;
        // do not abort the shared pair request or discard its verified base.
        authorize();
      }
    }
    authorize();
    const emphasisWeight = Math.max(
      baseWeight,
      chooseWeight(loadedDescriptors, 600, true),
    );
    faces.forEach((face) => {
      authorize();
      env.fonts.add(face);
    });
    authorize();
    const fallback = family.stack.slice(family.stack.indexOf(","));
    return {
      state: "ready",
      font: {
        family: {
          ...family,
          weights: [...new Set([baseWeight, emphasisWeight])],
          baseWeight,
          emphasisWeight,
          stack: `"${alias}"${fallback}`,
        },
        faces,
        dispose,
      },
    };
  } catch (error) {
    dispose();
    return {
      state: "unavailable",
      message: error instanceof Error ? error.message : "Font unavailable.",
    };
  }
}
