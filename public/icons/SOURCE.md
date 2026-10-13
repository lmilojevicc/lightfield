# Extension and favicon artwork

The supplied shader design adapts the Catppuccin VS Code shader icon, pinned to
commit `b6915da9f6889b683a110aa747de96c2820a537d`.

- [Upstream glyph](https://raw.githubusercontent.com/catppuccin/vscode-icons/b6915da9f6889b683a110aa747de96c2820a537d/icons/macchiato/shader.svg), retained unchanged as [sources/shader.svg](sources/shader.svg).
- [Upstream MIT license](https://raw.githubusercontent.com/catppuccin/vscode-icons/b6915da9f6889b683a110aa747de96c2820a537d/LICENSE), retained verbatim in [LICENSE.txt](LICENSE.txt).
- Adapted master: [icon.svg](icon.svg).

The original path geometry, no fill, and round caps/joins are unchanged. The
stroke is recolored from `#c6a0f6` to `#242523`, and thickened 25% from the
upstream default width of 1 to `stroke-width="1.25"`. The 16×16 glyph is centered in a 256×256 canvas using
`translate(48 48) scale(10)`. The added warm-white `#F4F3EE` background has
`rx="56"`; outer corners remain transparent.

The supplied master retains its geometry, transform, palette and background;
only its stroke width is increased. The installed PNGs (16, 32, 48 and 128
pixels) are rerendered directly from this thicker master with
`rsvg-convert --width SIZE --height SIZE icon.svg`. No new geometry, shadow,
gradient or generated artwork is introduced. Additional store-size exports
remain in the external artwork archive, not the extension package.

Copyright (c) 2023 Catppuccin and (c) 2023 thang-nm; MIT. This is license
attribution, not a claim of endorsement or trademark clearance.

Source SHA-256: `733aaaec5ce613aeffb4c4ca57136fadc3149dd2a87c96026d8d4ca3c9e90bdc`.
License SHA-256: `dab37945e3097e43c74c08437196152a50f8d5d5e1d0335f469b203e183e21b8`.

Shipped asset hashes are recorded in `tooling/effects-provenance.json` and
verified during the standard test/build gates.
