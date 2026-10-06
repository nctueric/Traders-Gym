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
  "dark-ink": "#e5ece8"
  "dark-muted": "#acbdb2"
  "dark-paper": "#15221c"
  "dark-card": "#1c2d24"
  "dark-line": "#42554a"
  "dark-green": "#8ccdaf"
  "dark-surface-muted": "#263c30"
  "dark-action-ink": "#14261d"
  "dark-alert-bg": "#3d2826"
  "dark-alert-ink": "#f0c2bb"
  "dark-alert-line": "#78524b"
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
    "backgroundColor": "{colors.nav-active}"
    "textColor": "{colors.card}"
    "typography": "{typography.control}"
    "rounded": "{rounded.nav}"
    "padding": "10px 14px"
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

The established identity is a light, deep-green trading workbench. System typography, compact controls, native fields, restrained borders, and tabular values make recording and reviewing work legible. The TG training loop supplies the brand detail without competing with the data.

This is an extraction of approved incumbent code, not a replacement visual world. No creative metaphor or broader identity claim has been invented. Source priority is the effective shared workbench rules in `app/globals.css`, then member-specific rules in `app/account.css`; the surface brief owns composition.

**Key Characteristics:**
- Deep green actions on light neutral surfaces.
- Readable system type with tabular numeric data.
- Flat panels and purposeful overlays.
- A geometric SVG training loop as the brand signature.

## Colors

Deep green identifies actions and positive values; pale green-gray surfaces separate working areas, and lime marks the dark navigation identity. Red retains its established loss/destructive meaning. Status text accompanies color.

The frontmatter contains the normative values. Root `--surface` aliases `--card`; `--focus` uses the green value. `--review-chart-text` and `--review-chart-line` alias muted and line. Aliases are documented here rather than creating competing color primitives.

`dark-*` values apply only to `.auth-page`, `.cash-editor`, and `.ledger-manager` under `prefers-color-scheme: dark`. These scopes override `--ink`, `--muted`, `--paper`, `--card`, `--line`, `--green`, and `--surface-muted`; `--surface` must resolve to the scoped card. Primary actions and alerts also have scoped dark colors. This is not a claim that every historical analytics surface is dark-themed.

## Typography

Use the system and Traditional Chinese fallback stack in the frontmatter. Shared headings use compact negative tracking; body text is 16px/1.5 and controls are 14px. Tables use tabular numerals and mostly 14px values with 12px secondary labels. Page-specific heading overrides remain in the surface brief.

TraderGym is 24px, weight 750, tracking `-.035em`; the sidebar wordmark is 21px. The SVG mark inherits `currentColor` and stays sharp at its 40px default size.

## Layout

The desktop shell uses a 230px navigation rail and a flexible content column. Content uses `24px clamp(20px,2vw,56px) 48px` padding. Shared panels use 20px padding, 12px corners, and 24px bottom separation. Spacing tokens list observed steps; they do not impose a new proportional scale.

At 760px and below the workspace adapts navigation and content to a single column. Member surfaces have a further 640px adjustment. Keep `min-width: 0` on flexible children and contain table overflow in `.table-wrap`; desktop density must not widen the document. Surface widths and form arrangements belong in `docs/surfaces/member-workflow.md`.

## Elevation & Depth

Shared panels are flat, separated by a one-pixel line and tonal surfaces. The workspace tools menu uses `0 8px 24px #0002`. The legacy modal shadow is `0 25px 80px #0005`, while a modal inside `.workspace-dialog` deliberately has no shadow. Do not spread the legacy shadow to ordinary cards.

Layer roles are sticky content 10, sticky navigation/header 20, dialog 30, and tooltip 40. Motion is limited to button color transitions at 160ms ease-out; member reduced-motion rules disable transitions and animation.

## Shapes

Controls normally use 8px corners, with 6px member ledger/cash field variants. Panels use 12px and authentication containers 16px. Status chips are fully rounded. The mark uses a partial circular loop, T and G strokes, and a terminal dot; preserve its open geometric silhouette rather than boxing it into a new icon tile.

## Components

- **Buttons:** green primary, white secondary, 14px inherited control type, 8px corners. Shared controls have a 40px minimum height; common actions, mobile controls, and member fields use 44px or more. Hover applies the incumbent brightness treatment; keyboard focus uses a two-pixel outline with three-pixel offset. Surface overrides may strengthen that ring.
- **Inputs:** visible labels, white/card background, line border, 8px corners, and persistent entered values on errors. Placeholder text uses muted ink and does not replace labels.
- **Panels:** card background, line border, 12px corners, 20px padding. Use separators for rows and groups within a panel.
- **Navigation:** dark ink rail, muted light inactive text, deep green active background, white selected text, and lime keyboard focus. Preserve current navigation grouping and behavior.
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
- Don't extend the member dark palette to unrelated analytics without checking their semantic colors.
- Don't replace the official Google control with a styled imitation.
- Don't add generated raster artwork to this approved member workflow.
