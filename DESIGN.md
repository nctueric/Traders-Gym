---
"name": "TraderGym"
"description": "Trading journal and review workbench; extracted from the incumbent implementation."
"colors":
  "green": "#176b50"
  "ink": "#17211f"
  "muted": "#53645c"
  "paper": "#f4f6f5"
  "card": "#ffffff"
  "line": "#d8e0db"
  "surface-muted": "#edf2ef"
  "lime": "#d9f36b"
  "red": "#a8463b"
  "nav-active": "#2a4037"
  "field-line": "#aab8b0"
  "disabled-bg": "#edf0ee"
  "disabled-text": "#64736b"
  "success-bg": "#e1f2e9"
  "alert-bg": "#fff1ef"
  "alert-ink": "#80362d"
  "alert-line": "#dbb6b0"
"typography":
  "headline":
    "fontFamily": "system-ui, -apple-system, BlinkMacSystemFont, \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    "fontSize": "28px"
    "lineHeight": 1.35
    "letterSpacing": "-.02em"
  "title":
    "fontFamily": "system-ui, -apple-system, BlinkMacSystemFont, \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    "fontSize": "22px"
    "lineHeight": 1.35
    "letterSpacing": "-.02em"
  "body":
    "fontFamily": "system-ui, -apple-system, BlinkMacSystemFont, \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    "fontSize": "16px"
    "lineHeight": 1.5
  "control":
    "fontFamily": "system-ui, -apple-system, BlinkMacSystemFont, \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    "fontSize": "14px"
    "lineHeight": 1.4
  "label":
    "fontFamily": "system-ui, -apple-system, BlinkMacSystemFont, \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    "fontSize": "12px"
    "lineHeight": 1.5
  "brand":
    "fontFamily": "system-ui, -apple-system, BlinkMacSystemFont, \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    "fontSize": "24px"
    "fontWeight": 750
    "lineHeight": 1.2
    "letterSpacing": "-.035em"
"rounded":
  "compact": "6px"
  "control": "8px"
  "nav": "9px"
  "notice": "10px"
  "panel": "12px"
  "auth": "16px"
  "pill": "999px"
"spacing":
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "28": "28px"
  "32": "32px"
"components":
  "button-primary":
    "backgroundColor": "{colors.green}"
    "textColor": "{colors.card}"
    "typography": "{typography.control}"
    "rounded": "{rounded.control}"
    "padding": "8px 12px"
  "button-ghost":
    "backgroundColor": "{colors.card}"
    "textColor": "{colors.ink}"
    "typography": "{typography.control}"
    "rounded": "{rounded.control}"
    "padding": "8px 12px"
  "input":
    "backgroundColor": "{colors.card}"
    "textColor": "{colors.ink}"
    "typography": "{typography.control}"
    "rounded": "{rounded.control}"
    "padding": "8px 10px"
  "panel":
    "backgroundColor": "{colors.card}"
    "textColor": "{colors.ink}"
    "rounded": "{rounded.panel}"
    "padding": "20px"
  "nav-active":
    "backgroundColor": "{colors.surface-muted}"
    "textColor": "{colors.green}"
    "typography": "{typography.control}"
    "rounded": "{rounded.control}"
    "padding": "10px 12px"
  "chip-success":
    "backgroundColor": "{colors.success-bg}"
    "textColor": "{colors.green}"
    "typography": "{typography.label}"
    "rounded": "{rounded.pill}"
    "padding": "5px 9px"
  "account-alert":
    "backgroundColor": "{colors.alert-bg}"
    "textColor": "{colors.alert-ink}"
    "rounded": "{rounded.notice}"
    "padding": "14px 18px"
---

# Design System: TraderGym

## Overview

The established identity is a light, deep-green trading workbench. System typography, compact controls, native fields, restrained borders, and tabular values make recording and reviewing work legible. The open TG training loop with three ascending candlesticks supplies the brand detail without competing with the data.

This is an extraction of approved incumbent code, not a replacement visual world. No creative metaphor or broader identity claim has been invented. Shared primitives come from `app/globals.css` and member-specific rules from `app/account.css`; `app/workbench.css` owns the approved workbench overrides. The surface brief owns composition.

**Key Characteristics:**
- Deep green actions on light neutral surfaces.
- Readable system type with tabular numeric data.
- Flat panels and purposeful overlays.
- An open geometric TG loop with three ascending SVG candlesticks as the brand signature.

## Colors

Deep green identifies actions and positive values; pale green-gray surfaces separate working areas, and selected workbench navigation uses green ink on a muted surface. Red retains its established loss/destructive meaning. Status text accompanies color.

The frontmatter contains the normative values. Root `--surface` aliases `--card`; `--focus` uses the green value. `--review-chart-text` and `--review-chart-line` alias muted and line. Aliases are documented here rather than creating competing color primitives.

All application surfaces use the established light palette and `color-scheme: light`, regardless of the system theme. Deep-green quote strips and the selectable gain/loss palettes remain unchanged.

## Typography

Use the system and Traditional Chinese fallback stack in the frontmatter. Shared headings use compact negative tracking; body text is 16px/1.5 and controls are 14px. Tables use tabular numerals and mostly 14px values with 12px secondary labels. Page-specific heading overrides remain in the surface brief.

TraderGym is 24px, weight 750, tracking `-.035em`; the workbench header wordmark is 21px and reduces to 18px below 640px. The SVG mark inherits `currentColor` and stays sharp at its 40px default size.

## Layout

The approved workbench shell uses a sticky horizontal header and a full-width content column. Workbench content uses `20px 24px 32px` padding; below 640px it uses `16px 12px 24px`. Legacy shells retain their existing layout outside this scope. Shared panels use 20px padding, 12px corners, and 24px bottom separation. Spacing tokens list observed steps; they do not impose a new proportional scale.

Workbench navigation is expanded at 1100px and above, and uses an explicit disclosure below 1100px. At widths below 640px, header identity becomes compact and disclosed navigation wraps into two columns. The legacy 760px workspace rule and member 640px adjustment remain scoped to their existing surfaces. Keep `min-width: 0` on flexible children and contain table overflow in `.table-wrap`; desktop density must not widen the document. Surface composition belongs in `docs/surfaces/workbench.md`; member form arrangements remain in `docs/surfaces/member-workflow.md`.

## Elevation & Depth

Shared panels are flat, separated by a one-pixel line and tonal surfaces. Workspace tools and the account dropdown use `0 8px 24px #0002`. The legacy modal shadow is `0 25px 80px #0005`, while a modal inside `.workspace-dialog` deliberately has no shadow. Do not spread the legacy shadow to ordinary cards.

Layer roles are sticky content 10, sticky navigation/header 20, dialog 30, and tooltip 40. Motion is limited to button color transitions at 160ms ease-out; member reduced-motion rules disable transitions and animation.

## Shapes

Controls normally use 8px corners, with 6px member ledger/cash field variants. Panels use 12px and authentication containers 16px. Status chips are fully rounded. The mark combines an open circular TG stroke with three ascending candlesticks; preserve its open geometric silhouette and readable wick/body spacing rather than boxing it into a new icon tile.

## Components

- **Buttons:** green primary, white secondary, 14px inherited control type, 8px corners. Shared controls have a 40px minimum height; common actions, mobile controls, and member fields use 44px or more. Hover applies the incumbent brightness treatment; keyboard focus uses a two-pixel outline with three-pixel offset. Surface overrides may strengthen that ring.
- **Inputs:** visible labels, white/card background, line border, 8px corners, and persistent entered values on errors. Placeholder text uses muted ink and does not replace labels.
- **Panels:** card background, line border, 12px corners, 20px padding. Use separators for rows and groups within a panel.
- **Navigation:** sticky card-colored topbar with a line divider, muted inactive text, and green selected text/border on a muted surface. Workbench focus uses a two-pixel green outline with three-pixel offset. The avatar trigger opens account actions, keeps owner-only management access conditional, and returns focus on Escape. At compact widths, a labeled disclosure controls the navigation; ledger and backup actions share one destination.
- **Chips and feedback:** compact, text-bearing status chips; account errors use the alert background/ink/line tokens and wrap long content. Cash values use tabular numerals. Confirmation and undo actions stay adjacent to the affected content.
- **Brand:** `app/brand.tsx` is the authoritative reusable SVG. Compact mode removes the wordmark while retaining an accessible mark label.

## Do's and Don'ts

### Do
- Do use the root semantic palette and preserve trading-signal meanings.
- Do show text labels, inline errors, keyboard focus, and save state near the related controls.
- Do preserve the SVG TG mark and the established system font stack.
- Do let dense tables scroll within their panels.

### Don't
- Don't equate local backup with completed synchronization.
- Keep all surfaces light; check semantic gain/loss colors on every surface.
- Don't replace the official Google control with a styled imitation.
- Don't add generated raster artwork to this approved member workflow.


## Mobile workbench (2026-10-06)
- Below 640px: 18px page/section titles, 26px primary totals, 22px secondary totals, 16px body and inputs, 14px labels. Use rem values, system fonts and tabular numerals. Chart labels alone may use 12–13px.
- Mobile gutter 12px; primary targets at least 44px. The header shows the brand mark, current page and navigation disclosure; account links remain permission-filtered inside that menu.
- Mobile holdings render the same computed rows as desktop. Symbol, direction, account, quantity, market value/allocation and daily/unrealized P&L remain visible; plan fields and fills live under one detail disclosure. Desktop retains its original table and whole-section disclosure.
- `InfoPopover` opts into a native modal bottom sheet with `mobilePresentation="sheet"`. Escape closes the help only; focus returns to its trigger. Short definitions retain the floating popover. Sheets never change the page's content height.
- `MobileDetails` retains mounted contents across viewport changes. Do not put errors, unsynchronized state or stop warnings behind secondary disclosures.
- Long amounts keep their precision; at text enlargement, use local numeric scrolling rather than cutting digits or reducing font size. Long ticker names wrap in the risk grid.
- Local acceptance evidence: `docs/mobile-acceptance.html`. Real iOS/Android keyboard and assistive-technology acceptance remains separate from browser viewport simulation.
