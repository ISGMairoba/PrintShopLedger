# PrintShopLedger

PrintShopLedger manages print-shop selling, production, stock and customer balances. It is a React + TypeScript PWA backed by Supabase, with IndexedDB storage for offline work. Currency is NGN; financial records store whole integer kobo. Business dates use Africa/Lagos time.

## Documentation

- [Code guide](CODE_GUIDE.md): module boundaries, invariants and validation commands.
- [Pricing template transfers](docs/pricing-template-transfers.md): import, export, sharing and file compatibility.
- [App manual plan](docs/manual-plan.md): audiences, chapter outline and writing/verification milestones. This is a plan, not a completed user manual.
- [Interactive charts](CHARTS.md): chart behaviour and accessibility requirements.
- [Registration deployment](supabase/functions/register-business/README.md) and [staff management](supabase/functions/manage-users/README.md).

## Current features

| Area | Included behaviour |
| --- | --- |
| Selling | Point of Service, quick sale, retail items, material-linked and materialless services, customer creation at checkout, discounts and receipts. |
| Jobs | Individual job balances, production stages, collected/completed separation, batch actions and checkout grouping. |
| Payments | Cash/POS/transfer, manual or oldest-first allocations, excess payment as customer wallet credit, customer statements and payment reminders. |
| Stock | Materials, units, size-based usage, minimum levels, stock history, purchases, physical-count reviews, waste and reprints. Negative stock is allowed and highlighted. |
| Quotations | Save/share quotations without moving stock or money; convert to checkout with current-price review. |
| Pricing templates | Editable variables, material choices, computed quantities, cost and selling-price formulas, private costs, markup/margin, profit floors, rounding and option comparison. Import/export/share reusable templates. |
| Corrections | Audited job/payment corrections, cancellations, credit and refunds; original checkout snapshots remain intact. |
| Expenses | Purchases, partial payments, corrections and voids; purchase lines adjust stock atomically. |
| Reporting | Dashboard and Reports with interactive Recharts, date filters and PDF/CSV outputs where provided. |
| Operations | Staff access, business branding/theme/terminology, printer defaults, drawer handover and conflict review. |

## Run and check locally

Use Node 22.12+ or a supported newer release:

```sh
cd web
npm ci
npm test
npm run build
npm run dev
```

Without Supabase variables the app opens in the separate local trial. Production uses the public URL and publishable key in `.env.production`; these values are browser-visible, not database secrets. Use `.env.production.local` to target a different backend. Never put a service-role key in a `VITE_` variable.

The production build and local trial are useful for UI checks, but do not prove that the deployed database and Edge Functions match the source. GitHub Actions separately runs formatting, unit tests, build, backend checks and desktop/mobile browser workflows. Browser checks use scripts under `scripts/`; see the workflow for the complete list. SQL integration checks under `supabase/tests/` are rollback-only fixtures and should run against a disposable database with all migrations applied.

## Supabase setup

1. Configure the project URL and publishable key from `.env.example`.
2. Apply every migration in `supabase/migrations/` in filename order. On an existing database, apply only unapplied migrations; never edit a migration that has run.
3. Deploy the Edge Functions required by the installed features: registration and its mail worker, Developer activation, staff login/user management, credentials, drawer closing and print signing. Follow each function's deployment instructions and keep private keys/secrets on the server.
4. Configure email confirmation, approved app redirect URLs and SMTP. Public self-registration needs signup enabled; invitation-only deployments can restrict signup intentionally. Configure the registration sender before expecting maintenance notifications.
5. Register/confirm a business email, sign in and complete workspace setup. The first staff membership is Manager; staff subsequently use username/password after business sign-in.

A separate Developer maintenance account is provisioned per business. When `DEVELOPER_DEFAULT_PASSWORD` is configured with at least 12 characters, registration attempts immediate activation using that server secret; otherwise the account remains disabled until the emailed single-use activation link sets its password. No business password is forwarded. See the registration guide for delivery retries and expiry. Actual availability depends on deployed configuration.

## Access and staff accounts

Ranks are Cashier (1), Admin (2), Manager (3), Developer (4). Access 0 disables access. Business email/password sign-in and staff username/password sign-in use separate sessions; switching staff preserves the business session.

Pages have defaults, configurable rank access, and minimum ranks enforced in both client and server. Developer has full page access and controls Page access. Business Settings is Developer-only by default, but selected Admin/Manager access and settings tabs can be enabled. Do not infer permission from rank alone: use `page-access.mjs` and server checks. Template management follows Business Settings access; cost visibility additionally follows pricing audit settings.

Higher ranks can manage lower ranks, users can manage their own allowed profile fields, and Developers can manage everyone; Manager peers remain protected. Password reset permissions are checked on the server and Supabase Auth hashes passwords. The default Manager can share the business account identity, so changing that credential can also affect business sign-in. See the staff management guide.

## Saving, offline work and synchronization

Every local ledger write saves the event and pending queue in one IndexedDB transaction. Stable event IDs and atomic database handlers prevent duplicate application on retry. Sync runs automatically; the status and pending count remain visible. There is no manual Sync button.

Sign in and sync online before going offline. First-time authentication, online-only supervisor actions and settings saves require a connection. Cached offline access is a convenience on a trusted device; revocation is enforced on the next server call and does not remotely erase downloaded records. Clearing site data removes local records and pending work. Do not clear pending business work.

Sync downloads a consistent ledger snapshot and replays newly queued events. Conflicting catalogue prices, account balances, stock counts or job stages require review; the pending work remains saved. Confirm revised allocations without collecting the same payment again. Offline receipts remain pending until cloud confirmation. Batch production actions save together locally, but sync as individual guarded events rather than one cloud-wide batch transaction.

## Orders, stock, expenses and corrections

- Checkout atomically saves jobs, payments, allocations, wallet movements, stock use and audit records. Materialless services use quantity × price. Size-based services use their material's measurement rules.
- A template order saves one parent job and its immutable inputs, formulas, prices and stock breakdown. Each computed stock contribution is deducted once. Material choices, private costs and service selling prices can participate in pricing. Quotations post neither stock nor payments.
- Editing a template does not rewrite saved orders. To change a saved template order's component quantities, cancel and replace it; record returned component materials separately with the stock tools. Supported charge/description/payment corrections remain available.
- Corrections require the appropriate page access and an online, fully synced workspace. They save approver, reason and before/after audit. Cancelling a charge does not automatically return material or refund money. Returned material cannot exceed eligible recorded consumption.
- Reducing a paid charge can move excess allocation to customer credit. Refunds record money already returned and consume available credit. Cash refunds reduce expected drawer cash. Receipts retain original totals with labelled adjustment information.
- Expense purchases apply stock changes in the same guarded operation. Edits apply quantity differences; voids reverse purchase contributions while retaining payment history. An expense void is not a refund.
- Sales less incurred expenses is a period cost measure: unused purchased stock still counts as expense. It is not inventory-based net profit. Expense payments are separate from cashier drawer handover.

## Pricing templates

Enable Pricing templates in Business Settings, then open its separate menu page. Price & compare is for calculations; Templates manages definitions; Costs lists available formula sources according to permission. Owners can set which ranks see internal costs/profit.

Templates support number/options/material/yes-no inputs, computed formulas, expenses and markup or margin. Formula evaluation uses a restricted arithmetic grammar and exact-decimal calculations with 12-place intermediate rounding. Supported functions are `CEILING`, `FLOOR`, `ROUNDUP`, `ROUND`, `SUM`, `ABS`, `MIN`, `MAX` and `IF`. Formula names refer to local item costs; `<name>_price` uses an item's selling price. Preview default inputs and representative order sizes before making a template available to staff.

Use **Templates → Import** for a `.json` transfer, **Export active/all** for the displayed collection, or **Export / Share** on a card for one template. Transfers create new active version-1 copies, preserve the receiving shop's catalogue and require compatible item matching. They do not copy catalogue prices or stock balances. Fixed amounts inside formulas and profit rules are included; review the export dialog before sharing. [Full transfer guide](docs/pricing-template-transfers.md).

## Printing and sharing

Print Settings stores printer, paper, font, margins, copies and automatic-print preference per user/business on the current device. QZ Tray must be installed and connected on the printing computer. Receipts are generated as PDFs for the selected paper; checkout is saved before printing, and sync/replay does not trigger another print. A failed print can be retried without recreating the sale. Spool submission does not prove physical output.

Trusted signing is implemented through the `print-signing` Edge Function and per-business keys; the private key stays on the server. The business certificate must be installed as QZ Tray's trusted override on the printing computer. Without correct trust/signing setup, QZ approval prompts may remain. Do not promise silent offline signing: server signing requires connectivity. Native printer properties and custom paper forms are managed in the operating system.

Customer documents can use device file sharing when supported, with download/attachment fallbacks. Template sharing uses a JSON file and does not create a public template link.

## Current limits

- No legacy Access database import until balances have been reconciled and assigned to jobs.
- No receipt-file uploads in the expense workflow.
- Template transfer files support format version 1 and a 2 MB maximum. They are definitions, not business backups; no quotes, receipts, payments, historical snapshots or catalogue records are transferred.
- Default-input checks do not prove that every possible input combination is valid. Test normal and boundary cases before staff use.
- Printer trust, email delivery, database migrations and Edge Functions need deployment configuration beyond the frontend build.
