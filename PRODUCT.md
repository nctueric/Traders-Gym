# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

TraderGym serves members recording and reviewing their own trading activity. Guests practice with example trades using real securities, market prices and FX. The owner manages access and retains the original identity and ledger rights.

## Product Purpose

TraderGym is a trading journal and review workspace. It supports recording funds and executed trades, maintaining strategies, and reviewing trading decisions and results. It does not place broker orders.

## Operating Context

This delivery is local development and acceptance only. Google or verified, approved Mail access leads to the same member permissions. An email-address match alone must never merge identities. Actual Google credential verification and Resend email receipt still require owner acceptance; no production deployment is asserted.

## Capabilities and Constraints

- Members own multiple independent ledgers containing their trades, funds, and strategies. They can create, switch, rename, recycle, and restore ledgers.
- Cash activities support creation, editing, deletion, and undo of the last deletion on the current page. Regular cash amounts are positive; type determines the cash direction. Opening balance correction is an explicit advanced operation.
- Formal ledgers have one storage source: cloud D1 ownership/version metadata and verified private R2 snapshots. Explicit actions save immediately; draft edits debounce for one second. Only server acknowledgement counts as saved. Failures retain changes in page memory, with retry/export/discard protection; no browser ledger or private analysis persistence. Local development uses isolated D1/R2 emulation, with no file fallback.
- `/demo` loads real market data before generating rolling one-year example trades. Its USD 50,000 opening capital is explicitly illustrative. Holdings and performance are computed from those fills and real prices; no dividends or strategies are invented. System time advances normally. Refresh, exit or reset rebuilds the example; guest changes remain memory-only and cannot access member data or storage.
- A shared USD/TWD valuation preference applies to all workspaces and entry modes. On overview it sits beside the Assets title, in the same row as Add funds. Current amounts use valid current FX; historical cash, positions and adjusted QQQ/SPY benchmarks use each day’s real FX. Realized P&L uses closing-day FX; execution prices, costs, trade percentages and R multiples retain their original definitions. Missing prices/rates remain gaps.
- Member valuation currency, entry mode, onboarding completion, review column order and holding color preference sync through authenticated cloud preferences. Guests keep independent in-memory preferences. JSON/CSV import preview/confirmation and JSON export formats are preserved. Legacy owned data is read-only and transfers only through explicit import confirmation.

## Brand Commitments

The approved name is **TraderGym**. Its vector identity is a geometric TG training loop, implemented in `app/brand.tsx`. The established light workspace, deep green actions, readable operating density, and scoped dark support are retained. The mark is a reusable SVG, not a generated raster asset.

## Evidence on Hand

- Approved member direction: `.impeccable/review/direction.md`.
- Existing visual implementation: `app/globals.css`, `app/account.css`, and `app/brand.tsx`.
- Guest runtime: `lib/demo-workspace.mjs`; anonymous, credential-free requests use `/api/market/quotes` and `/api/market/history`, sharing the member market adapter. Data may be delayed; missing data and timestamps are never fabricated.
- Identity, ledger, and cash workflows are implemented locally. Local verification details and external acceptance limits belong in `docs/member-workflow-local.md`.

## Product Principles

- Preserve identity and ledger ownership across every access method.
- Keep ledger boundaries visible and preserve recoverable user work.
- Distinguish example trades from real market data, local backup, and completed synchronization.
- Explain cash effects before committing a change.
