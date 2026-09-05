---
name: 交易復盤顧問
description: TradingView-inspired dark trading review workspace.
colors:
  accent: "#8ab8f4"
  selected: "#22334d"
  paper: "#11151c"
  chrome: "#151a22"
  card: "#1b2029"
  raised: "#242c38"
  ink: "#e1e6ef"
  muted: "#a6b0c1"
  line: "#343c49"
  positive: "#69c6a7"
  negative: "#ee918b"
  warning: "#e6b66e"
typography:
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif'
    fontSize: "1rem"
    lineHeight: 1.5
  control:
    fontSize: ".875rem"
  small:
    fontSize: ".75rem"
rounded:
  control: "4px"
  panel: "6px"
  account: "8px"
spacing:
  compact: "8px"
  split: "16px"
  panel: "18px"
  desktop-inline: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel}"
---

# Design System: 交易復盤顧問

## Overview

**Creative North Star: "TradingView dark workspace"**

A compact, evidence-oriented workspace with graphite surfaces, blue selection, tabular numbers, and persistent access to the ledger. The selected record opens beside the ledger on wide screens and replaces it on narrower screens.

Key characteristics:

- Dense records and restrained panel framing.
- Blue primary actions; green gains and red losses.
- Retained docked detail; code-rendered charts without new raster assets.

The cascade is globals.css, account.css, then react-workspace.css. More-specific inherited selectors still win in some components.

## Colors

Blue identifies principal actions and selection. Graphite tonal layers distinguish page, navigation, panels, and raised controls. Muted text and borders support scanning.

**The Meaning Rule.** Preserve gain/loss colors when changing selection or navigation styling.

Legacy green remains in disclosures, tags, section links, review indicators, and some account focus treatments. Do not assume every interactive state is blue.

## Typography

System fonts support Traditional Chinese without downloads. Metrics and ledger tables use tabular numerals.

Desktop topbar titles remain 28px through inherited specificity; generic h1 is 24px, mobile topbar titles 20px, and common section/detail headings 18px. Body is 16px, controls and rows usually 14px, metadata commonly 12px. Some feature headings retain inherited sizes.

## Layout

Desktop navigation is 164px wide. Content padding is 20px top, 24px inline, 40px bottom.

At 1200px and above the split uses minmax(0,1fr) minmax(420px,46%) with a 16px gap. Open detail and ledger can scroll independently at calc(100dvh - 220px). Expanded detail hides the ledger; collapsed detail reserves 250px without unmounting children.

Below 1200px, detail replaces the ledger; returning restores its position. At 760px and below the shell becomes a compact header, global actions use four columns, detail forms use one column, and admin tables become labeled cards.

Trading tables remain horizontally scrollable, with sticky identifiers and actions. Accepted limitations: mobile chrome occupies about 404px in the reviewed state; wide review tables scroll beneath the fixed action area. These are limitations, not targets.

## Elevation & Depth

Tonal surfaces and one-pixel borders provide depth; general panels and detail avoid floating shadows. Sidebar selection uses an inset two-pixel accent edge. Native dialogs use a dark translucent backdrop. Some inherited subnavigation shadows remain.

Button backgrounds transition over 140ms ease-out. Reduced-motion rules remove transitions, animations, and smooth scrolling.

## Shapes

New controls use gently squared four-pixel corners; panels use six and account surfaces eight. Specialized inherited surfaces retain larger radii; status badges remain pills. Nested generic panels are flattened.

## Components

Primary buttons use blue with dark text; secondary buttons use dark surfaces and visible borders. Desktop controls often have 36px minimum height, mobile global/detail actions 44px; some account utilities remain 32–40px. There is no universal 44px guarantee.

Inputs preserve labels, validation and disabled states. Common fields have 40px minimum height, admin fields 44px. More-specific inherited field styles retain some radius differences.

Position buttons expose aria-pressed. Hover and keyboard row focus provide tonal feedback.

DetailFrame is a labeled focusable section, not a modal. Opening focuses it; closing restores its opener. Escape closes from inside. Collapse uses hidden while retaining children; expand changes only presentation.

DialogFrame retains native showModal, inert background, scroll lock, focus containment, Escape and opener return. OverviewDisclosure mounts on first opening and retains children afterward. Section links focus their target.

General focus is a two-pixel blue outline offset three pixels; some account/disclosure focus remains green. Skip links, aria-current, aria-pressed, aria-expanded and reduced motion are implemented; this is not a complete WCAG certification.

## Do's and Don'ts

- Do preserve financial semantics and existing application contracts.
- Do retain chart/form state, focus return and scroll position across detail presentation changes.
- Do use dark surfaces, system fonts and tabular figures.
- Preserve the dark workspace and the user-requested light alternative; neither changes layout or financial semantics.
- Don't claim all controls are 44px or all trading tables fit without scrolling.
- Don't describe remaining inherited green treatments as already normalized.

## Light appearance (2026-09-05)

User-requested alternate appearance, not a replacement layout. The page uses #f4f6f8, panels white, text #202833, secondary text #536071, actions #245fae, gains #127353 and losses #b63838. Shared color tokens keep every existing selector consistent. `themes.css` loads last and remaps the literal palette without changing component geometry.

The global 外觀 control offers 淺色 / 深色 on workspace, login, forbidden and admin pages. Dark remains the default. A device-local `traders-gym:appearance` preference restores before paint, synchronizes between tabs, and works without persistent storage when storage is blocked. It contains no identity or ledger data. Canvas charts observe theme changes and repaint through a presentation adapter without altering calculations or coordinates.
