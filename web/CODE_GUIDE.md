# Code guide

A short map of the code, for anyone (person or AI) about to change it. Product behaviour is described in
[README.md](README.md); this file is about where things live and how to check a change.

## Where things live

| Folder / file | What it holds |
| --- | --- |
| `src/App.tsx` | The app shell: sign-in flow, sync state, the sidebar, page switching and the shared windows (job details, editors, receipts). It wires pages together; it should not grow new business rules. |
| `src/app/` | Pieces of the shell. `useSessions.ts` (business/staff sign-in and workspace loading), `AuthScreens.tsx` (sign-in, staff and supervisor screens), `pageInfo.ts` (page icons and descriptions), `shared.ts` (`Page`, `Shop`, `currency`, `dateLabel`, `shortId`, `errorMessage`); `useAppUpdates.ts` owns PWA update timing; `useSyncConflicts.ts` owns the six conflict states and guarded resolution handlers. |
| `src/*Page.tsx` | One file per page in the menu (Dashboard, Reports, Jobs/Payments, Customers, Materials…). |
| `src/*Editor.tsx`, `JobDetails.tsx`, `ConflictReviews.tsx`, `ReceiptView.tsx` | Windows (modals) opened from pages. |
| `src/*.mjs` | Business rules as plain functions with no React: checkout, payments, stock, reports, receipts, permissions (`page-access.mjs`). These are what the unit tests cover. |
| `src/pricing-formulas.mjs` | Restricted formula grammar and exact-decimal arithmetic. Independent of React, catalogue and persistence. |
| `src/pricing-templates.mjs` | Template definitions, costs, price/profit rules and stock calculation. Re-exports formula APIs for existing callers. |
| `src/template-transfer.mjs` | Versioned JSON transfer validation, dependency discovery, local-item mapping and additive imports. |
| `src/TemplateTransfer.tsx` | Template transfer review dialogs, browser downloads and native file sharing. |
| `docs/` | Transfer guide and manual plan. User-facing chapters should live beside the feature documentation. |
| `src/types.ts` | The ledger record shapes (Job, Payment, Customer, Material…). |
| `src/storage.ts` | Offline storage (IndexedDB): the ledger and the queue of changes waiting to sync. |
| `src/cloud.ts` | Supabase: the two sign-in clients, sync, and conflict detection/resolution. |
| `src/printing.ts`, `print-settings.mjs` | QZ Tray printing; receipts are printed as a PDF sized to the chosen paper. |
| `src/receipt-pdf.ts`, `report-pdf.ts`, `pdf-common.ts` | Branded PDFs (jsPDF). `src/fonts/` holds the embedded font and is not formatted. |
| `supabase/migrations/` | Database changes, applied in filename order. Never edit one that has already run; add a new file. |
| `supabase/functions/` | Edge functions (staff login, user management, drawer handover, registration). |
| `supabase/tests/` | SQL checks that run inside a transaction and roll back. |
| `tests/*.test.mjs` | Unit tests for the `.mjs` rules (`node --test`). |
| `scripts/check-*.mjs` | Browser checks (Playwright) that click through real screens on desktop and iPhone sizes. |

## Rules that hold everywhere

- Money is stored as whole **kobo** (integers). Format it with `currency()` only when showing it.
- Business days follow Africa/Lagos time.
- Every change is saved locally first, then synced. Write through the existing event functions in
  `App.tsx`/`storage.ts` rather than changing the ledger directly, so offline work and retries stay safe.
- Permissions are checked twice: in the screen (`canAccessPage`) and on the server (RLS and RPCs). A new
  feature needs both.
- Only the public (publishable) Supabase key belongs in the app. Never put a service-role key in a `VITE_`
  variable.

## Refactoring boundaries

Keep the app shell focused on workspace orchestration and page wiring. Staff actor labels are prepared once as `catalogueActor` and `salesActor`; preserve their label fallback order when changing authentication. Keep scoped async operations guarded by `activeScope` so results from a previous user/workspace cannot update the active screen. Conflict resolution state and its operations live together in `app/useSyncConflicts.ts`; automatic sync and remote conflict approval remain in their existing modules.

Put pure arithmetic in `pricing-formulas.mjs`, business pricing/stock rules in `pricing-templates.mjs`, and file-format/remapping rules in `template-transfer.mjs`. Do not move validation into React or evaluate imported formulas as JavaScript. Canonicalise and re-parse imported formulas, map every referenced item, validate local units/cost availability, then use the existing versioned settings save. No new transfer-specific database endpoint is required.

Prefer incremental extractions with meaningful regression checks. Remaining candidates are authentication actions and the page switch in `App.tsx`; extract by responsibility without bypassing existing offline writes or permissions. Do not create an alternative persistence path just to shorten a file.

## Adding a page

1. Add the name to the `Page` type in `src/app/shared.ts`, and its icon and description in `src/app/pageInfo.ts`
   (TypeScript will complain until both are filled in).
2. Add it to `pages` in `src/page-access.mjs`, and set who sees it in `minimumPageAccess` and
   `defaultPageAccess` (owners can still change access per rank in Business Settings).
3. Create `src/NewThingPage.tsx` and add a branch for it to the page switch in `App.tsx`.
4. Put the calculations in a `.mjs` file with a test in `tests/`.

## Checking a change

From `web/`:

```sh
npm test              # unit tests (fast)
npm run format        # format all code (Biome) — run before committing
npm run build         # type-check and build, same as Vercel
```

Every push to GitHub runs the full set in `.github/workflows/printshopledger-web.yml`: formatting, unit
tests, build, and all browser checks. Each step goes through `scripts/run-check.mjs`, so when one fails the
last lines of its output appear as an annotation on the pull request — no need to download logs.

Vercel builds a preview for each branch and publishes `main` to the live site.

## Formatting

Biome formats the code (`biome.json`: 2 spaces, single quotes, 110 characters). The commit that formatted
everything is listed in `.git-blame-ignore-revs`; run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` so `git blame` skips it.


## Documentation and manual maintenance

Update `README.md` when feature behaviour or setup changes; describe deployed configuration dependencies separately from code support. See [the transfer guide](docs/pricing-template-transfers.md) for the file contract and [the manual plan](docs/manual-plan.md) for chapter ownership and verification. Manual source is planned under `docs/manual/`; it is not yet a complete user manual.

For transfer changes run `node --test tests/template-transfer.test.mjs tests/pricing-templates.test.mjs`, the full `npm test`, build, and `scripts/check-pricing-templates.mjs` in an environment with browser dependencies. The browser check covers import review/save/reload, download and unsupported-share fallback alongside existing pricing and checkout flows.
