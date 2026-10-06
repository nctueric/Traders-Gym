# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

TraderGym serves members recording and reviewing their own trading activity. Guests can practice with synthetic examples. The owner manages access and retains the original identity and ledger rights.

## Product Purpose

TraderGym is a trading journal and review workspace. It supports recording funds and executed trades, maintaining strategies, and reviewing trading decisions and results. It does not place broker orders.

## Operating Context

This delivery is local development and acceptance only. Google or verified, approved Mail access leads to the same member permissions. An email-address match alone must never merge identities. Actual Google credential verification and Resend email receipt still require owner acceptance; no production deployment is asserted.

## Capabilities and Constraints

- Members own multiple independent ledgers containing their trades, funds, and strategies. They can create, switch, rename, recycle, and restore ledgers.
- Cash activities support creation, editing, deletion, and undo of the last deletion on the current page. Regular cash amounts are positive; type determines the cash direction. Opening balance correction is an explicit advanced operation.
- Changes receive local backup; available, authorized member sessions synchronize in the background every ten minutes. A backup or pending sync must not be labeled a completed server save.
- `/demo` uses memory-only synthetic data and a fixed example date. Refresh, exit, or reset returns it to the example; guest practice must not access member data or persist to member storage.
- Existing analytics structure and calculation contracts remain unchanged by the member workflow work.

## Brand Commitments

The approved name is **TraderGym**. Its vector identity is a geometric TG training loop, implemented in `app/brand.tsx`. The established light workspace, deep green actions, readable operating density, and scoped dark support are retained. The mark is a reusable SVG, not a generated raster asset.

## Evidence on Hand

- Approved member direction: `.impeccable/review/direction.md`.
- Existing visual implementation: `app/globals.css`, `app/account.css`, and `app/brand.tsx`.
- Synthetic guest runtime: `lib/demo-workspace.mjs`, fixed at `2026-09-25T20:00:00.000Z`; its quotations are synthetic and are not live market evidence.
- Identity, ledger, and cash workflows are implemented locally. Local verification details and external acceptance limits belong in `docs/member-workflow-local.md`.

## Product Principles

- Preserve identity and ledger ownership across every access method.
- Keep ledger boundaries visible and preserve recoverable user work.
- Distinguish synthetic practice, local backup, and completed synchronization.
- Explain cash effects before committing a change.
