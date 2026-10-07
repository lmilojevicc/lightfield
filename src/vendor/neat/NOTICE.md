# Neat native renderer provenance

Vendored `@firecms/neat` 1.0.2, registry gitHead
`b9688dfeb491d510dc76443dd75a32543d6c0c97`:
https://github.com/FireCMSco/neat/tree/b9688dfeb491d510dc76443dd75a32543d6c0c97/lib/src
Tarball: https://registry.npmjs.org/@firecms/neat/-/neat-1.0.2.tgz

Copyright (c) 2024-present FireCMS. **MIT + Commons Clause License Condition
v1.0; source-available, not MIT-only or unrestricted open source.** The full
pinned repository LICENSE is adjacent and included in THIRD_PARTY_NOTICES.md.
The npm tarball omits LICENSE. Its NeatGradient.ts adds a versioned console
message compared with the git tree; version.ts is generated in the tarball.
`provenance.json` records tarball file hashes and local hashes. Build checks
all retained vendored files and the distributed full license without network access.
Historical barrel references in the provenance manifests are metadata only;
unconsumed index files are not retained as physical copies.

## Local modifications

Retained upstream TypeScript files have a leading `@ts-nocheck` annotation:
upstream code predates this project's strict indexed-access contract. Our
adapter/config remain strictly checked. Except NeatGradient.ts, bytes after
that annotation match the published source exactly (including shaders,
geometry/matrix math, types, key verification and version).

NeatGradient.ts: make the license.ts import extension explicit to avoid LICENSE
collision on case-insensitive filesystems; replace its render/resize/intersection/document-visibility
scheduling with one guarded owned RAF; expose render, resize, pause, resume,
and setHostState; park hidden/reduced-motion/speed-zero instances and repaint
config changes without advancing time. Resume resets the elapsed clock;
native time += elapsed seconds * speed/20 is preserved. There is no cadence
cap or alternate animation, physics, geometry, noise, color or texture algorithm.
Resize no longer creates independent RAF chains. The host owns resize and
visibility notifications. Track every GL allocation, release linked shaders,
clean up partial initialization and idempotent destruction, release the context,
and propagate shader/link failures and context loss to the existing host fallback.
Remove obsolete observer, timer, cursor and hover fields. Retain the original
canvas NEAT mark and console branding and owned generator meta; remove that
meta on destruction. Document-wide watermark click/cursor interception remains removed by the existing
lifecycle fork. The separate app-added page badge is now removed from both
adapters; Settings retains the source repository link. No global click handler/body styling.

No key is supplied, no paid verification is changed or bypassed, and marks are
not suppressed. Upstream README separately offers paid mark removal; the exact
LICENSE contains no separate watermark covenant. This integration is authorized
for free extension distribution, not a sold service/template. Commons Clause's
full definition of Sell remains authoritative; monetization needs reevaluation.

## Adapter bounds

Legacy `neat-gradient` (now labelled **Default (theme-aware)**) retains its exact
1.0.2 engine, saved IDs/overrides and preview bytes. Six stops are
mixed from active paper/accent/focus/ink roles; seed 6, textureSeed 333, plane,
fixed camera and no optional procedural texture/advanced effects. Shared CSS
opacity/brightness/saturation/contrast affect the canvas, never Settings chrome. Native controls use published editor units and clamp finite values;
colorBlending has a positive 0.1 floor to avoid equal-edge smoothstep.

Mesh detail (resolution) 0.25–1, default 0.5, controls native mesh density, not
DPR. The independent canvas budget is DPR <= 1 and <= 1920*1080 buffer pixels
(floored dimensions); CSS size/aspect stays host-sized. No runtime packages,
network scripts, permissions, accounts, or manifest CSP changes.


## Current official preset gallery

The 25 official editor presets are pinned independently at commit
`01243432489f596de47419fb39f3bf27cc82ebd4` (lib/package.json version
`1.0.3-canary.20260731173236`, not a claim about npm canary gitHead):
https://github.com/FireCMSco/neat/blob/01243432489f596de47419fb39f3bf27cc82ebd4/editor/src/components/presets.ts

Names, exact fixture hash, generated registry hashes and each current-engine
original/local hash are in `preset-provenance.json`. `official-presets.ts.fixture`
is the byte-exact editor source; `presets.ts` retains every exported PRESETS
config value and recursively freezes them. The historical stable catalog had 24;
current has 25: Forest is absent, Coral and Oil Slick are present. We do not
include unlisted exported constants or the editor's typography presets as extra
backgrounds. Neat's own Neat preset does NOT match the legacy theme-aware default.
The collection therefore contains **25 official cards plus one legacy Default**.

The current engine is shared/lazy across all 25 cards, not copied per preset.
Its 14 newer preset properties (secondaryWave*, prismEdge*, textureMode and
bakeEdgeSoftness) require this explicitly approved separate current engine.
No properties are silently dropped, and the legacy renderer is not upgraded.
The original current-engine algorithm reference is the upstream commit and
`current/NeatGradient.ts` upstream SHA-256 recorded in `preset-provenance.json`;
no redundant physical upstream-engine fixture is retained.
Current shaders/math/pattern generation/bake code and key verification remain
unaltered apart from compiler annotations. Version.ts is generated from the
pinned package version. NeatGradient.ts reapplies the lifecycle/resource changes
above, including ownership of bake framebuffers/textures/programs/VAOs, throwing
on shader errors, and removing observer/dirty-flag RAF scheduling in favor of
one host-owned callback. Dirty flags retain their original uniform semantics;
adapter updates call render only after all assignments finish. The current-only
colors setter additionally invalidates enabled procedural textures on changed
stop colors/enabled flags (not fresh identical arrays or influence-only edits).
The existing tracked replacement path releases old textures. Reused Canvas2D
canvases reset their state before regeneration so painter state such as lineCap
cannot leak from a previous palette and differ from a fresh same-seed instance.
These are intentional local source cache/lifecycle adaptations, not changes to
pattern/shader algorithms or defaults. The adapter skips native assignments and
paint for identical effective configs while still applying CSS/host-state changes;
changed configs paint once while reduced/paused scheduling remains parked.
Native adaptive
mesh density and feature-specialized shaders are retained, not backported to
legacy. Current LICENSE bytes exactly equal the adjacent full LICENSE.

New cards default to the full **official palette**, shape, textureSeed and every
other supplied parameter; no style dropdown or hand-tuned recreation. Source
presets omit the optional initial-time seed, so the host chooses deterministic
seed 6 (as legacy does); no supplied seed is replaced. All 25 source speeds are
positive, so none is falsely described as static; speed zero, hidden and reduced
motion park the renderer. Native time, rather than an independent animation,
also drives grain and rotation. Source resolution values are not forced into
the legacy 0.25–1 range: new controls allow 0.05–2, still mesh detail, not DPR.
Default controls preserve fractional source values without step quantization.
Current color blending, like legacy, has a 0.1 UI/runtime floor to avoid the
unchanged upstream shader's undefined smoothstep(0, 0, ...); direct adapter
zero overrides are clamped and nonfinite inputs use exact official defaults.
All 25 official defaults remain exact. Legacy engine/config/preview bytes are
untouched by these final fixes.
Native saturation is additive, and clear alpha is not whole-canvas opacity.
Reset removes only that selected card's namespaced overrides.

Optional **Use theme colors (replaces official palette)** defaults false. It
maps active theme colors to the original stop count while preserving enabled/
influence flags, and maps supplied clear/fresnel/procedural background colors.
Native saturation, lighting and iridescence still apply: this is theme integration,
not a guarantee of hue locking. Interface chrome always uses the active app theme.
Neat search matches the collection name as well as the official card name, so
searching Neat shows all 26 without changing remembered collapse state.

The 25 official 660×380 static previews are owned renders of exact source configs,
with `useThemeColors: false`, seed 6, reduced motion and native initial time.
They preserve original RGB in lossless WebP, without grayscale postprocessing.
This explicit Neat preview policy supersedes the collection-creation monochrome
rule for this existing gallery only. Paper and all other collections are unchanged.
No site screenshots ship, no live thumbnail canvases, and native canvas marks remain.
Legacy Default has no native palette: its accurate theme-linked monochrome preview
remains unchanged (SHA-256 `385c69793eeeb9a15a7e8a7d7b79182d4e382f5904f6ab07227e3389c1e0ba24`).
`node scripts/check-neat-presets.mjs --write-previews` regenerates only the 25
native previews, checks exact source config and upstream pixel parity, and verifies
zero decoded RGB drift from capture to WebP. `scripts/capture/run-captures.ts --neat-only`
also regenerates legacy via its existing theme-linked path. Paper/Orbs-only switches
are unchanged. No runtime dependency, permission, remote script, key or branding bypass.


### Verified source-uniform exception

Funky renders only its `#003FFF` clear color plus the native mark at 660×380
with seed 6. A bounded comparison at native initial-time seeds 0, 8, 24 and 60
also produced that same uniform field in both adapted and unmodified upstream
engines, with zero pixel differences. Its large source yOffset, ribbon/camera
parameters are retained, not “corrected.” Its faithful native-blue preview stays
uniform. Thus validation distinguishes **25 successful paints/source-parity
checks** from **24 content-varying frames**; the watermark is excluded from
content-variation statistics. This is not a GPU initialization fallback.

Off-step fractional preset values (notably Alejandra) use the existing accessible
numeric slider adapter, avoiding native range assignment's step quantization.
Arrow/pointer edits still use the declared native increments; Reset returns the
full-precision source value. Legacy controls keep their previous presentation.
