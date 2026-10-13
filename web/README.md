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

The shared CurrencyInput groups digits during entry, strips redundant leading zeros on blur and displays two decimal places for completed valid amounts. Invalid signs, text, exponent notation, extra decimal places and excessive amounts are blocked during entry, preserving the previous valid amount. Values invalidated by a changed limit reset to zero on blur. Pasted commas must form valid thousands groups; malformed pasted amounts are not silently converted. Money parsing normalizes valid incomplete decimal endings before exact integer-kobo conversion.

Expense payments default to total cost (or the outstanding balance for a later payment). Total changes update this suggestion until the cashier enters a partial amount. Re-enabling Record money paid now restores the suggestion; payments above the expense balance are invalid. Checkout allocation rows show service, outstanding balance, an ellipsized description with the full text available on hover, and job ID. Manual allocation labels include all three job identifiers. Browser checks cover these behaviors, including identical descriptions across different services.

Customer search and Add new customer are always visible at the top of the checkout Payment section, after jobs and their total. Suggestions appear only while typing; selecting a customer keeps the search field visible and shows phone/wallet details.

### Sales adjustments and extra material use

Admin (access 2), Manager (3) and Developer (4) can use **Sale Adjustments** and **Material Waste**. These operations require an online, fully synced workspace. Cashiers continue using POS and their own sales; they cannot approve adjustments or waste.

- Charge/description corrections and cancellations revise the current job, increment its version and save an immutable reason/approver/before/after audit. Original checkout receipts and original cash amounts remain unchanged. Excess allocations move into customer credit; each changed payment allocation and wallet addition has a before/after snapshot.
- Cancelling sets the charge to zero and stops production. Stock stays consumed unless the supervisor explicitly returns unused, reusable material. The return cannot exceed the actual stock deduction recorded for that job (including physical-count review decisions).
- Refunds record money already returned, dated today, consuming available customer credit. Reducing/cancelling a paid charge and refunding are separate actions. A refund uses the configured payment methods, is clearly marked in account history, and belongs to the approving user's drawer. Cash refunds reduce expected cash. Handover verifies the exact refund IDs as well as checkout IDs and opening cash, so stale totals cannot silently close a drawer.
- Waste, damage and reprints deduct **additional** material usage, optionally linked to a job. They leave jobs, customer payments and original checkout usage unchanged. Negative stock is allowed with a red warning.
- Supervisor writes use `apply_supervised_event`, an invoker API wrapper around an explicitly authorized private database transaction. A business lock, job/account/material version checks and event IDs protect concurrent changes and retries. Audit tables are read-only to staff and isolated by business RLS.
- Original receipt printouts/PDFs include subsequent adjustments as a labelled appendix without rewriting the original totals.

Validation: `npm test`, `npm run build`, rollback-only `supabase/tests/sale_adjustments.sql`, and `node scripts/check-sale-adjustments.mjs` (Chromium/WebKit, desktop/mobile; run in CI with the other UI checks). The close-drawer Edge Function must be deployed with the refund-aware migration.


## Batch progress and checkout groups

Point of Service and Jobs allow selecting multiple visible items and applying Next Action, Set Action or Mark as Complete. The confirmation previews the forward stages for each item and explains skipped items (cancelled, finished or incompatible workflows). Local save writes the entire event batch in one IndexedDB transaction; cloud synchronization retains per-item events, permissions, version checks and conflict review. Cloud sync is not one atomic transaction across the entire batch. Completed remains separate from Collected.

Group by checkout adds a second view using the recorded checkout ID. Each group shows customer, totals and current items with group actions. Filters still apply: hidden items are not selected or changed, and a partial group shows its visible/total count. Older items without a checkout ID remain individual.

Business Settings → Jobs & payments → Job description entry supports Required (existing default), Optional or Hidden. Checkout and quotations use the service name when an optional/hidden description is blank. Existing descriptions are retained. The generated description preserves compatibility with stored records, receipts and server validation.

Validation: `tests/job-batches.test.mjs` and `scripts/check-job-batches.mjs` cover grouping, mixed stages, skipped items, stale versions, description modes, settings persistence and desktop/iPhone layouts.


### Pricing templates

Developer maintenance users can enable **Business Settings → Pricing templates**, create a template or start with the editable Book preset. Link each component to an existing retail item or service, define numeric inputs (or named options with numeric values), and use quantity formulas with optional reusable calculations. The formula editor inserts variables, arithmetic and `ceil`, `floor`, `round`, `min`, `max`; preview the result before saving. Quantity is the order quantity and is never multiplied twice. Component formulas round to three decimal places; intermediate arithmetic uses twelve decimal places on both client and server. A zero component quantity is optional and posts no charge or stock use.

Templates appear in the existing service picker in Quotations and Checkout. They add existing selling prices; they do not apply an additional profit percentage. A quotation posts no stock or payments. Checkout saves one parent job, one payment balance and an immutable version/input/component-price snapshot; each linked material is deducted once per component in the same server transaction. Materialless components deduct no stock. The component breakdown is expandable in checkout, quotations and job details; customer receipts retain the one parent item. Archived/disabled templates cannot be used for new sales, and existing job snapshots are retained.

Apply `supabase/migrations/20261013074911_pricing_templates.sql` before deploying this feature. `supabase/tests/pricing_templates.sql` is a rollback-only authenticated integration check, and `scripts/check-pricing-templates.mjs` checks desktop/light and phone/dark flows. Template definitions are saved with the existing versioned, Developer-only business settings RPC. Catalogue changes and intervening stock counts require review before an offline template checkout can sync.

The first version uses catalogue selling prices. Cost-based expenses, additional profit rules and Compare Options are later extensions. To change a saved template order's component quantities, cancel it and create a replacement; any returned component materials are recorded separately using the existing stock-adjustment tools. Charge, description and payment corrections remain available.
