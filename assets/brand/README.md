# Hotbox brand

The mark is an H with the nodes scattered around it. There are two color versions:

| Version | Colors | Where it is used |
| --- | --- | --- |
| **Comfy Yellow** (Alt Comfy, default) | yellow `#F2FF59` on plum `#211927` | the H in the top bar, Settings, `../hotbox-icon.png` (Registry icon), `../hotbox-logo.svg` (README) |
| **Orange** (first version, kept as an option) | orange `#E58A2E`, edge `#9C5517`, white `#FFFFFF`, ink `#141416` | Settings → Logo Colors → Orange; `hotbox-icon-orange.png` is its 400 px Registry icon |

Type: Manrope ExtraBold 800 for the name, Manrope 500 for interface text.

Files:
- `svg/hotbox-comfy-classic-*`: the Comfy Yellow chip, mark and lockup (white text, for dark backgrounds).
- `svg/hotbox-chip-*`, `svg/hotbox-mark-*`, `svg/hotbox-lockup-*`: the orange version, plus white, black and mono variants.
- `png/`: the same marks and chips at 16, 32, 64, 128 and 512 px.

To go back to orange everywhere: pick Orange in Settings → Logo Colors, and point `Icon` in `pyproject.toml` at `assets/brand/hotbox-icon-orange.png`.
