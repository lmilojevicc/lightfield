# Bundled font assets

These are **modified OFL 1.1 fonts** from the official Google Fonts source distribution
(`google/fonts`), not runtime Google Fonts downloads. `sources.json` pins the immutable
repository revision, source/font and exact license SHA-256 hashes, tool versions,
axis recipes, required Western-locale specimen, and coverage ranges. Exact upstream
OFL notices live byte-for-byte in `licenses/`. The production-shipped
`THIRD_PARTY_NOTICES.md` embeds their complete text with only trailing spaces/tabs
removed per line and a single EOF newline. Raw license hashes are unchanged.
None of these four notices declares a Reserved Font Name;
subsetting/instantiation/compression may retain the family names. Copyright and
license name records remain in every binary. No font is sold separately.

## Reproduce (development only)

Requires Bun and Python 3 (verified with Python 3.14). No production dependency,
font installation, browser permission, Google API, or runtime network is added.
From the repository root:

```sh
python3 -m venv "$HOME/.cache/meridian-font-tools"
"$HOME/.cache/meridian-font-tools/bin/pip" install 'fonttools[woff]==4.61.1' 'brotli==1.2.0'
export FONT_PYTHON="$HOME/.cache/meridian-font-tools/bin/python"
# Optional override; default is ~/.cache/meridian-fonts/<pinned revision>.
export FONT_CACHE="$HOME/.cache/meridian-fonts/5e35378e6bda803962ee6fd257e444a7d459660d"
bun scripts/fonts.ts
# Offline metadata/CSS/license checks (no download or generation):
bun scripts/fonts.ts --check
bun run typecheck
bun run check:ui
bun run check:backgrounds
bun run build
"$FONT_PYTHON" scripts/font-assets-check.py --dist
```

The generator fetches only pinned raw files from `google/fonts`, verifies every
source and license hash (including cached bytes), instances axes, retains all
OpenType layout features and names, subsets source-supported codepoints in the
specified ranges, then explicitly encodes WOFF2. Timestamps are preserved for
byte-reproducible output with the pinned toolchain. It never writes raw downloads
to public assets or changes CSS/pairing selections. Changes to the manifest need
matching CSS/build inventory changes; checks reject mismatches. Set `FONT_REPORT`
to a JSON output path for detailed cmap/features/weights/outline-hash evidence.
With `FONT_CACHE` set, checks also prove no source-supported coverage within the
chosen ranges was lost. Generation requires the exact tool versions above;
normal builds only copy the already generated assets.

To reproduce a license's Markdown embedding, decode the raw UTF-8 file and apply
only this normalization before enclosing it in a `text` code fence (do not change
the raw file):

```python
normalized = '\n'.join(line.rstrip(' \t') for line in raw_text.split('\n')).rstrip('\n') + '\n'
```

The checker applies the same narrow normalization when comparing the complete
license text, while continuing to verify the raw license and source SHA-256 hashes.
No wording, leading whitespace, or internal whitespace is normalized.

## Face contract and compatibility

| CSS family | Real normal weights | Source version / pinned axes |
| --- | --- | --- |
| Instrument Serif | 400 only | 1.000, static |
| Bricolage Grotesque | variable 400–800, including 600/650/700 | 1.001; opsz=14, wdth=100 |
| Fraunces | 400, 600 | 1.000; opsz=14, SOFT=0, WONK=1 |
| JetBrains Mono | 400, 600, 700 | 2.211; static instances |

Existing paths are retained. `bricolage-400-subset.woff2` now contains a genuine
weight variable face (default 400), not static Regular falsely declared variable.
Fraunces 400/600 are now correctly mapped (the old files were reversed). Mono600
is new for existing semibold UI labels. No true Instrument bold or italic exists
in this bundle; legacy serif-only UI can still synthesize emphasis. No pairing,
family-role token, remote-loader behavior, or UI style was changed.

Non-weight axes reproduce the previous Google static recipes: Bricolage400 and
Fraunces400 digit advances match the original correct-weight instances. Optical
size is deliberately fixed, not silently changed into automatic optical sizing.

## Coverage and digits: intentionally not universal

The subset retains **all source-supported** Basic/Extended Latin (including A/B,
Additional, C/D/E ranges), combining marks, ordinary punctuation, currency, arrows,
math, technical symbols and box/geometric symbols in `sources.json`. Coverage
varies by upstream family: 325 codepoints Instrument, 492 Bricolage, 606 Fraunces,
747 Mono. Standard Western accents/names, degree, real minus, multiplication sign,
curly quotes and ellipsis are asserted with nonempty outlines in every face.
Vietnamese is supported by Bricolage/Fraunces/Mono but incomplete in Instrument.
This is not complete coverage of every codepoint in those Unicode blocks.

Upstream Instrument/Fraunces lack arrows and disclosure/command symbols;
Bricolage lacks ↗/▾/⌘. Mono includes these UI symbols. Existing system fallbacks
remain responsible when a selected family lacks them. Greek, Cyrillic, Arabic,
CJK and other non-Latin scripts intentionally remain system fallback (even where
Mono's original has some of those glyphs). No invented glyphs or borrowed outlines.

Bricolage's retained `tnum` feature genuinely substitutes equal-advance digits
(602 units at 400; verified also at 600/650/700/800). Mono has inherently equal
600-unit digits, no `tnum` feature needed. Instrument and Fraunces have neither
`tnum` nor equal default digit widths. CSS `tabular-nums` cannot stabilize those
display faces: clock digit-slot/layout repair belongs to the UI lane.

## Budget

| Asset | Old bytes (mislabelled TTF) | Repaired WOFF2 bytes |
| --- | ---: | ---: |
| Instrument400 | 37,656 | 26,120 |
| Bricolage400 → variable400–800 | 31,820 | 62,260 |
| Fraunces400 (was actual600) | 26,752 | 28,416 |
| Fraunces600 (was actual400) | 26,756 | 28,676 |
| Mono400 | 45,732 | 29,928 |
| Mono600 (new) | — | 31,084 |
| Mono700 | 45,648 | 30,812 |
| **Total** | **214,364** | **237,296** |

The total grows 22,932 bytes (10.7%), buying substantially expanded coverage,
real variable Bricolage weights and Mono600. The deficient 126–132-codepoint old
subsets are **not equivalent coverage**. Editorial display+body is 88,380 bytes
(86.3 KiB), excluding optional Mono. Fraunces400+Bricolage is 90,676 bytes
(88.6 KiB). Do not preload all seven faces. Future picker work should resolve
included family names locally, avoid competing remote CSS, and use this actual
weight/coverage contract; remote loading correctness remains a separate task.
