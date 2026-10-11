# Code guide

A short map of the code, for anyone (person or AI) about to change it. Product behaviour is described in
[README.md](README.md); this file is about where things live and how to check a change.

## Where things live

| Folder / file | What it holds |
| --- | --- |
| `src/App.tsx` | The app shell: sign-in flow, sync state, the sidebar, page switching and the shared windows (job details, editors, receipts). It wires pages together; it should not grow new business rules. |
| `src/app/` | Pieces of the shell. `useSessions.ts` (business/staff sign-in and workspace loading), `AuthScreens.tsx` (sign-in, staff and supervisor screens), `pageInfo.ts` (page icons and descriptions), `shared.ts` (`Page`, `Shop`, `currency`, `dateLabel`, `shortId`, `errorMessage`). |
| `src/*Page.tsx` | One file per page in the menu (Dashboard, Reports, Jobs/Payments, Customers, Materials…). |
| `src/*Editor.tsx`, `JobDetails.tsx`, `ConflictReviews.tsx`, `ReceiptView.tsx` | Windows (modals) opened from pages. |
| `src/*.mjs` | Business rules as plain functions with no React: checkout, payments, stock, reports, receipts, permissions (`page-access.mjs`). These are what the unit tests cover. |
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
