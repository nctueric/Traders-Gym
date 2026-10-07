# Member workflow

Mode: **Operate**. Scope: login, application/access status, email verification, settings, ledger management, cash entry, member workspace additions, and `/demo`.

## Approved direction

Retain the established light workbench, deep green actions, system typography, and operating density. Use the TG geometric training-loop SVG from `app/brand.tsx`. This is the approved code-led implementation; no generated raster or image composition was supplied or approved. Product truth lives in `PRODUCT.md`; shared tokens live in `DESIGN.md`.

## Entry and access

The login is a single column: brand and brief trading-review tagline, official Google control, Mail disclosure, membership/application notice and result link, guest practice, then privacy and secondary technical help. `.tg-login` caps the panel at 480px; the default heading is 27px/1.4 with `-.025em` tracking, becoming 24px at 640px. Expanded Mail stays in the same column. The application panel can reach 660px.

Google and verified, approved Mail offer the same member permissions. Email matching does not authorize identity merging. Verification secrets are transient; product copy must not imply external delivery or Google verification has passed before owner acceptance.

## Ledger and saving workflow

The workspace header keeps the active ledger, switcher, management, and save status together. Management supports create, rename, recycle, and restore while preserving ledger isolation and the owner's existing rights. The manager caps at 720px; its rows are divided by lines, and rename/recycle confirmation appears in the page. At 640px rows and creation controls stack.

Local backup precedes ten-minute background synchronization in eligible member sessions. Status must distinguish local backup, pending sync, completed sync, failure, conflict, and a recycled ledger that can no longer sync. Do not imply guest practice is remotely saved.

## Cash entry and recovery

The cash editor caps at 600px, with labeled fields and a two-column field grid; time and notes span both columns. It shows a cash delta before save. Regular types require a finite amount greater than zero; blank or invalid input displays `—`, not a plausible cash result. Type supplies the sign. Advanced opening-balance correction accepts zero or negative values and explains that it resets the baseline.

Cash editing preserves entered values on save errors. Deletion uses an adjacent page confirmation, followed by undo for that deletion on the current page. Cash tables retain account, currency, confirmation state, and source/notes; numbers use tabular figures. The empty state guides initial funds registration, then actual trade entry.

## Guest practice

`/demo` loads real public market data before building rolling one-year example trades, using real session dates and raw closes. Show “訪客練習｜真實市場資料・示範交易｜離開後重置”, the USD 50,000 example opening capital and omitted-cost disclosure. Use the real clock, quote source and actual quote times, including delayed/unknown/stale states. Initialization has progress, error and retry states. Guests may register any supported Taiwan/US security. Changes and derived performance caches remain in memory; reload, exit or reset rebuilds the example. Forward only market GET requests without member credentials; all private APIs stay blocked.

## Theme and responsive behavior

At 640px the auth page uses 20px/12px outer padding and 28px/22px panel padding; cash and ledger dialogs use 20px padding. Actions wrap, long identifiers and feedback wrap, and tables contain horizontal overflow. Preserve the existing dialog accessibility and focus management.

Dark support is scoped to authentication, cash editor, and ledger manager. Their `--surface` must resolve to the scoped card so inherited modal rules remain dark. Do not recolor analytical gain/loss semantics as a side effect. Member reduced-motion mode disables animation and transitions.

## Evidence and acceptance boundary

Authoritative source: `.impeccable/review/direction.md`, `app/account.css`, `app/brand.tsx`, `app/cash-ledger.tsx`, `app/ledger-manager.tsx`, `app/trade-workspace.tsx`, and `lib/demo-workspace.mjs`.

Delivery remains local. Real Google verification and actual Resend receipt await owner acceptance. The isolated `dev:acceptance` workflow and detailed test/build evidence belong in `docs/member-workflow-local.md`; this brief does not duplicate credentials or claim production deployment. Dark styling is source-inspected; no dark browser capture is asserted here. Existing analytics structure/calculations are outside this surface change.
