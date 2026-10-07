import { requiredValue } from "../../runtime/required-value";
// Official 0.0.80 prop mappings; colors are explicit, never a monochrome CMYK substitution.
import { getShaderColorFromString } from "@paper-design/shaders";
import {
  effectiveImageFilter,
  PAPER_IMAGE_FILTERS,
  type PaperImageFilterId,
} from "../../../shared/image-filter-metadata";
import type { ThemePalette } from "../../runtime/contracts";
import type { LocalImageSettings } from "../../../shared/local-image";
import type { ShaderMountUniforms } from "../shader-mount";
export function imageFilterUniforms(
  id: PaperImageFilterId,
  settings: LocalImageSettings,
  image?: HTMLImageElement,
  noise?: HTMLImageElement,
  palette?: ThemePalette,
): ShaderMountUniforms {
  const definition = PAPER_IMAGE_FILTERS[id],
    config = effectiveImageFilter(id, settings.filterOverrides);
  const uniforms: ShaderMountUniforms = {
    u_image: image,
    ...(definition.noise ? { u_noiseTexture: noise } : {}),
    // Application Cover/Contain owns source crop. Do not inherit demo zoom (.6/.8).
    u_fit: settings.fit === "cover" ? 2 : 1,
    u_scale: 1,
    u_rotation: 0,
    u_originX: 0.5,
    u_originY: 0.5,
    u_offsetX: 0,
    u_offsetY: 0,
    u_worldWidth: 0,
    u_worldHeight: 0,
  };
  for (const control of definition.controls) {
    const key = control.key,
      value = requiredValue(config[key]);
    if (key === "speed" || key === "margin") continue;
    const uniform =
      id === "paper-image-image-dithering" && key === "size"
        ? "u_pxSize"
        : `u_${key}`;
    if (control.type === "color") {
      const color = getShaderColorFromString(String(value));
      // Only unoverridden semantic paper/ink roles follow theme. CMYK C/M/Y/K,
      // highlights and user colors remain official explicit colors, including alpha.
      const semantic =
        key === "colorBack"
          ? palette?.paper
          : key === "colorFront" || key === "colorShadow"
            ? palette?.ink
            : undefined;
      uniforms[uniform] =
        semantic && !Object.hasOwn(settings.filterOverrides[id] ?? {}, key)
          ? [...semantic, color[3]]
          : color;
    } else if (definition.enums[key])
      uniforms[uniform] =
        definition.enums[key].indexOf(String(value)) + definition.enumBase;
    else uniforms[uniform] = value as number | boolean;
  }
  if (id === "paper-image-fluted-glass") {
    const overrides = settings.filterOverrides[id];
    for (const side of ["Left", "Right", "Top", "Bottom"] as const) {
      uniforms[`u_margin${side}`] =
        overrides?.[`margin${side}`] ??
        overrides?.margin ??
        (config[`margin${side}`] as number);
    }
  }
  return uniforms;
}
