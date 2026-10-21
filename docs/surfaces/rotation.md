# 板塊輪動

Operate mode. A new independent research page in the existing TraderGym workbench. The approved plan fixes the composition: controls, rotation plot and reading panel, timeline, ranking table. Uses public USD market data only; no ledger writes. Member preferences use existing authenticated preference storage; guest settings remain in memory.

## Direction contract

THESIS: Make sector direction and its evidence readable together. The plot is the working surface; no decorative metric-card grid.

OWN-WORLD: Inherit DESIGN.md and the existing light workbench: system Traditional Chinese type, green actions, restrained lines, tabular values. Four semantic quadrant backgrounds carry the data.

STORY: Start with eleven sectors, select a sector, inspect its path and Chinese evidence, overlay a theme, then replay the completed history. Separate relative strength from absolute returns.

FIRST VIEWPORT: Compact settings above a dominant left plot, 320px reading panel on the right; dates and refresh status remain visible. Playback sits directly beneath the plot, ranking below. On narrow screens these stack in reading order.

FORM: User-approved analytical workspace composition, code-led extension. No seed: precise approved plan, not an open visual-world exercise. Signature interaction: selecting the same ETF connects point, trail, reading evidence and ranking row.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implemented surface specification

This is an extension of the established world. `app/rotation-workspace.tsx` and `app/rotation.css` are the implementation sources; the values below are surface-specific observations, not new global tokens. `DESIGN.md` and `.impeccable/design.json` remain unchanged.

### Composition and responsive layout

The settings row wraps above the freshness line. The white, bordered main panel has 12px corners and a flexible plot beside a 320px reading column; at 1100px and below the reading column becomes 280px. Plot padding is 20px, then 16px at 1100px, then 12px vertically / 6px horizontally at 480px. The reading column uses 24px / 20px padding, reducing to 20px at 480px. Quadrant filters and playback remain beneath the plot. Ranking follows the main panel with 28px separation.

At 800px and below, the plot, filters, playback and Chinese reading evidence stack in that DOM order; ranking follows. The graph retains its 610 × 570px canvas inside a named, keyboard-focusable horizontal scrolling region, with a visible swipe hint. This preserves labels and point targets instead of shrinking the graph. Ranking scrolls inside its existing table wrapper. Theme choices use four columns, three at 1100px, and two at 800px.

### Colors and type

The four chart states use text as well as color. Circles identify sectors; diamonds identify themes. Hollow points and dashed trail segments identify incomplete periods.

| State | Point / trail ink | Quadrant background |
| --- | --- | --- |
| 領先 | `#176b50` | `#eaf4ee` |
| 轉弱 | `#866012` | `#faf5e7` |
| 落後 | `#a8463b` | `#fbefed` |
| 改善 | `#296a94` | `#edf4fa` |

Boundary values use muted ink (`#53645c`). The center axes use `#82928a`; grid lines use the shared line color. Selected ranking rows use `#edf4ef`, and text selection uses `#d8eadd`. Warnings use a pale amber background (`#faf5e7`), dark amber ink (`#705116`) and amber border (`#ddd0a9`). Errors and preference-save feedback use the incumbent alert colors. These chart colors express relative states, not a promise of positive or negative absolute returns.

System Traditional Chinese fonts and tabular numerals are inherited. The page title is 28px, reducing to 24px at 480px; section titles and numeric readings are 19px, reader symbol 24px, state 27px and minor headings 15px. Controls/body details are mostly 14px, with 12px secondary text and 13px timeline/filter labels. Plot labels and axes are 12px, selected symbols and quadrant names 14px. Comparison-chart date labels remain 10px. Mobile select text becomes 16px. These observed surface overrides do not revise the global mobile type policy.

### Interaction and accessible behavior

The reader’s labeled native “指定標的” select lists all sectors and enabled themes, grouped by kind. Removing a selected theme returns selection to XLK. Selecting from this control, a graph point or ranking symbol connects the selected trail, Chinese evidence, state, comparison chart and ranking highlight. Graph points are tab stops with descriptive labels and pressed state; Enter or Space selects them. Their transparent hit circle has a 44px diameter in the unscaled mobile canvas. Selected trails are thicker and more opaque. Native disclosures expose the reading method, evidence and recent transitions. Sortable table headers expose `aria-sort`; quadrant filters expose pressed state. Loading/save feedback uses status semantics and fetch failures use an alert with retry.

Controls have a 40px minimum height, increasing buttons/selects to 44px at 480px and below. Focus uses a two-pixel green outline with three-pixel offset; focused graph points use an ink circle. This does not establish a 44px minimum for every disclosure, checkbox label or range control. The timeline range exposes the selected trading date through `aria-valuetext`. Previous/next, play/pause and return-to-latest controls accompany it. Playback uses completed periods; the latest preview is explicitly marked temporary. Reduced-motion styling disables CSS transitions/animations and slows playback from 800ms to 2000ms per frame. Hiding the document stops playback.

## Evidence and verification limits

Documented from the current implementation, the direction contract, `PRODUCT.md`, `DESIGN.md`, the supplied desktop/mobile screenshots in `.impeccable/review/rotation/`, and `browser-results.json`. The screenshots show local synthetic acceptance data; they establish composition, not market-data accuracy. No generated raster is shipped by this surface.

The supplied browser results record 23 comparable rows, replay date `2024-11-08`, a 390px viewport with 390px document width, a 14px selected mobile graph label, a 44px point target, and an empty failures array. These are recorded checks, not a complete accessibility or device audit. Source inspection also confirms the named graph scrolling region and date-valued timeline range. The two finish-review corrections reported to this documentation pass concern mobile graph legibility/targets and the timeline's accessible value; the final review verdict remains a separate reviewer responsibility.

The supplied detector snapshot (`/tmp/rotation-design-findings.json`) contains 16 advisory findings and no primary findings. It flags surface type steps and additional colors; several label findings refer to the earlier 11px graph labels, so this snapshot is not a post-fix detector rerun. The specification above records current values without suppressing findings or declaring whole-surface approval.

Existing context drift remains outside this surface's scope: `PRODUCT.md` says scoped dark support is retained, while `DESIGN.md` specifies light surfaces regardless of system theme. This page follows the latter and explicitly uses the light color scheme. Global documentation was preserved for a separate reconciliation.

Final bounded reviewer verdict: **Ship**. Both listed corrections were scored resolved (mobile chart readability/touch targets; playback date accessibility). This does not certify the complete surface or constitute an independent assistive-technology audit.
