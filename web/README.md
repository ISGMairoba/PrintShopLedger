# PrintShopLedger

A React + TypeScript app for businesses that manage materials, services, customers, jobs and payments. Every payment allocation belongs to a job; customer accounts combine their job records and wallet movements.

## Included

- Material, service and customer catalogues with editing, archiving, audit fields, search and sorting.
- Stock adjustments and per-job material usage history; negative stock is allowed.
- Point of Service with a simple cart, size-based pricing, customer name/phone suggestions and customer creation at checkout.
- Cash/POS/transfer payments allocated oldest unpaid job first, with manual override across multiple jobs.
- Excess payment becomes wallet credit, usable on later jobs. Credit limits warn without blocking orders.
- Atomic checkout saves jobs, allocations, wallet, stock and audit records together. Retrying the same checkout never duplicates records.
- My Sales shows the signed-in user’s checkout/payment transactions, sortable/searchable with date and closed-status filters, saved receipts and drawer history.
- Online drawer handover verifies both staff passwords and active business access. It atomically closes all the current user’s unclosed transactions (including overnight), records actual cash, counted cash and any discrepancy, then signs in the receiving user while preserving business sign-in. Incoming counted cash becomes the receiver’s opening cash. POS/transfer/wallet usage are reported separately.
- Production workflow: Added → In Queue → Printing → Completed → Collected. Next Action, Set Action and Mark as Complete record every intervening stage in order; completion remains separate from collection.
- Point of Service and Jobs share service-first job details, customer phone numbers, payment breakdowns, stage progress and dates. Mobile lists retain three primary columns.
- Receipts retain their original per-job payment snapshots. Inconsistent job amounts or totals are flagged, hidden and blocked from printing until verified.
- Receipts use saved QZ Tray printer settings. Printing failure leaves the saved checkout intact and supports manual retry.
- IndexedDB offline saves and automatic cloud sync on reconnection. Concurrent price, account or workflow changes require review before confirmation.
- Supabase staff sign-in, business workspaces, ranks, access controls and isolated business records.
- Responsive modal editors, sortable lists, installable PWA and a separate local trial.

Currency is NGN and financial amounts are stored as integer kobo. Refunds and payment corrections are not implemented yet.

## Run locally

Use Node 22.12+ (or a supported newer release):

```sh
cd web
npm install
npm test
npm run build
npm run dev
```

Development without Supabase variables opens in a local trial. Production builds use the configured public Supabase URL and publishable key in `.env.production`. These browser-visible values are not database secrets. Override them with `.env.production.local` when testing a different backend. For offline app-shell testing, use the production build (`npm run preview`) over localhost, load once online, then disconnect and reload. IndexedDB contents are stored in this browser profile; clearing site data removes local records and pending work. Keep unsynced business work until it has synced successfully.

## Connect Supabase

1. Create a Supabase project.
2. Apply the SQL files in `supabase/migrations` in filename order to a fresh database. Existing deployments must apply any migrations they have not already applied.
3. Create tester accounts through Supabase Authentication. Disable public signup if testers should be invitation-only.
4. Copy `.env.example` to `.env` and set the project URL and **publishable** key. Never place a service-role or secret key in a Vite environment variable.
5. Sign in to the business, create a workspace, then use its default Manager staff account. Manage additional staff through the Users page.
6. Add staff from the Users page; access is isolated by business and validated on the server.

For independent businesses, each tester creates their own workspace. Server membership checks prevent cross-business reads/writes. All three roles currently have the same customer/job/payment permissions; finer role restrictions are not implemented yet. Clients cannot modify memberships or roles.

## Offline and synchronization behavior

Sign in and sync while online before working offline. Offline access uses the previously cached session and workspace list; first-time sign-in needs internet. This is a convenience cache, not independent offline authentication. Use a trusted device/browser profile. Membership revocation takes effect on the next server call; cached records are not remotely erased.

Every local write validates and updates the ledger and outbox in one IndexedDB transaction. Sync sends commands with stable UUIDs. Supabase applies each command atomically and deduplicates retries. Payments and their allocations are written together; server serialization prevents concurrent payments from overpaying a job. Sync then downloads a consistent ledger snapshot and replays any newly queued work.

Sync runs automatically when connected. The status and pending count remain visible; there is no manual sync button. When a price, customer account or job status changed elsewhere, the pending transaction stays saved locally and the app opens a review dialog. Confirm revised allocations without collecting the same money again. Offline receipts are marked pending until cloud confirmation.

## Validation

`npm test` exercises job-specific payments, split allocations, exact amounts, overpayment, customer isolation and retry deduplication. `supabase/tests/ledger.sql` covers server isolation and write invariants; run it against a disposable Supabase database after applying the migration. The GitHub workflow runs domain tests and a production build.

Do not import the old Access database yet: its account-based balances must first be reconciled and assigned to individual jobs.

## Printer defaults

Print Settings saves printer, paper, font, margins, copies and an automatic-printing preference per signed-in user/business on the current device. Install QZ Tray on the printing computer, connect printers, save defaults and send a test print. Settings and the QZ client are available offline after the PWA has loaded.

QZ submits HTML directly without a browser print preview. Unsigned requests still show QZ security prompts. Trusted signing is not configured yet; see https://qz.io/docs/signing. Native printer properties and custom driver paper forms must be managed in the operating system. A selected font/tray must exist in the printer computer's driver.

`src/printing.ts` prints only after checkout is durably saved. Sync, refresh and event replay do not trigger another print. Printing errors are separate from checkout persistence, and a submitted spool job is not proof of physical output. Use the receipt dialog to retry a failed print.

### Responsive list pages

Use `src/ResponsiveTable.tsx` for every new list page. Pass the desktop table as its child and declare up to three mobile `columns`: each identifies its source cell index, heading, related `details` cell indices, and whether it contains `actions`. Use `-1` for the last cell (actions), so toggling audit fields does not move the action mapping. Unassigned fields automatically appear as prefixed details below the first main value, including audit fields. `labels` can shorten prefixes such as ID and Unit. SortHeader controls become one mobile sort dropdown and direction button; `extraSortOptions` adds fields absent from the desktop headers. Keep all handlers and permission checks in the original cells. The shared component displays one table at a time and uses the 740px sidebar breakpoint (1024px for touch devices, including iPhone landscape). The Sidebar component provides the mobile menu drawer with keyboard focus handling, Escape and scroll locking.


## Checkout validation

`npm test` checks calculation precision, allocation, wallet, stock, retries and conflict review. Browser checks include `node scripts/check-checkout.mjs`, existing modal checks, user switching and iPhone layouts. `supabase/tests/checkout.sql` uses fixtures inside a rollback-only transaction to test the real database RPCs without leaving records behind.

## Expenses and purchases

Expenses remain independent of jobs. Add/edit expenses, record partial or full payments, void with a reason, search/filter/sort and inspect full audit/change history. Admins and higher manage records; cashiers can view them. Money is integer kobo. The optional material purchase lines update stock and expense in one local IndexedDB transaction and one guarded database RPC. Editing applies quantity differences; voiding reverses only purchase contributions, allowing negative stock and preserving job consumption. Each stock change links to its expense. Retries are idempotent, and concurrent expense edits require review. Material unit changes block quantity corrections until the original unit is restored.

The summary shows sales less expenses by incurred date, paid out by payment date, and remaining expense balances. Bulk purchases count as period expenses, including unused stock; this is not inventory-based net profit. Voiding excludes the expense from costs and reverses stock, but retains actual payments in paid-out totals; it does not record a refund. Payment source records where money came from. Expense payments are independent of cashier drawer handover calculations.

Receipt/invoice references and notes are supported; receipt-file uploads and refunds are not included in this first version. `tests/expenses.test.mjs`, `supabase/tests/expenses.sql` and `scripts/check-expenses.mjs` cover stock correction, retry, payment, void, business isolation, offline saving and desktop/mobile forms. The SQL fixtures roll back all changes.

## Services without materials

Select **No material — service only** in the service editor for customer-supplied pressing, binding or other work without shop stock. Price is quantity × service price; size inputs and stock deductions do not apply. A checkout can mix these services with material-linked services. Existing service links can be added or removed; previous job snapshots stay unchanged. A service can also be created before any materials exist. Explicit null represents the optional link; invalid or missing material IDs remain errors.

The optional-service-material migration updates the service and checkout RPCs together. Unit tests, `scripts/check-materialless-services.mjs` (desktop and mobile WebKit), and rollback-only `supabase/tests/materialless_services.sql` cover setup, linking/unlinking, mixed checkouts, payments, stock isolation and retries.

## Amount entry and payment summaries

The shared CurrencyInput groups digits during entry, strips redundant leading zeros on blur and displays two decimal places for completed valid amounts. Invalid signs, text, exponent notation, extra decimal places and excessive amounts block form submission with visible errors. Pasted commas must form valid thousands groups; malformed pasted amounts are not silently converted. Money parsing normalizes valid incomplete decimal endings before exact integer-kobo conversion.

Expense payments default to total cost (or the outstanding balance for a later payment). Total changes update this suggestion until the cashier enters a partial amount. Re-enabling Record money paid now restores the suggestion; payments above the expense balance are invalid. Checkout allocation rows show service, outstanding balance, an ellipsized description with the full text available on hover, and job ID. Manual allocation labels include all three job identifiers. Browser checks cover these behaviors, including identical descriptions across different services.
