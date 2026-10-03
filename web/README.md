# PrintShopLedger

An early React + TypeScript application for businesses that manage jobs and payments. Each job owns its payment history and outstanding amount. Customer totals are derived from jobs, never used to distribute payments implicitly.

## Included in this first version

- Customers, jobs, individual job details and payment history.
- Cash/POS/transfer payments with explicit allocations across one or more jobs.
- Integer-kobo money calculations, overpayment protection and allocation validation.
- Atomic local IndexedDB saves and a persistent outbox; cross-tab refresh.
- Installable PWA app shell; first successful online load/build is required before offline use.
- Supabase email/password sign-in, business workspaces, RLS and atomic/idempotent write RPCs.
- Business isolation on the server and separate device caches for each user/business.
- Separate local trial mode that never uploads sample records.

The currency is NGN for this first version. Services are entered as text and job prices are entered manually. Material tracking, pricing rules, workflow statuses, staff invitations, receipts, refunds and payment corrections are later modules. This is not a completed production system.

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
2. Apply `supabase/migrations/202610030001_job_payments.sql` using the SQL Editor or Supabase migrations.
3. Create tester accounts through Supabase Authentication. Disable public signup if testers should be invitation-only.
4. Copy `.env.example` to `.env` and set the project URL and **publishable** key. Never place a service-role or secret key in a Vite environment variable.
5. Sign in. Create a business workspace from the app. The creator becomes its admin.
6. To let additional testers share a business, add their Auth user UUID to `shop_members` through the administrator's SQL Editor:

```sql
insert into public.shop_members(shop_id, user_id, role)
values ('BUSINESS_UUID', 'AUTH_USER_UUID', 'cashier');
```

For independent businesses, each tester creates their own workspace. Server membership checks prevent cross-business reads/writes. All three roles currently have the same customer/job/payment permissions; finer role restrictions are not implemented yet. Clients cannot modify memberships or roles.

## Offline and synchronization behavior

Sign in and sync while online before working offline. Offline access uses the previously cached session and workspace list; first-time sign-in needs internet. This is a convenience cache, not independent offline authentication. Use a trusted device/browser profile. Membership revocation takes effect on the next server call; cached records are not remotely erased.

Every local write validates and updates the ledger and outbox in one IndexedDB transaction. Sync sends commands with stable UUIDs. Supabase applies each command atomically and deduplicates retries. Payments and their allocations are written together; server serialization prevents concurrent payments from overpaying a job. Sync then downloads a consistent ledger snapshot and replays any newly queued work.

Sync is explicit with **Sync workspace**. Pending counts and last-sync times are visible. If another device already paid a job, the server rejects an incompatible queued payment and stops synchronization; it is retained locally. This first version has no conflict-resolution or reversal UI, so do not use real money until those workflows are implemented. Do not clear local storage to hide a conflict.

## Validation

`npm test` exercises job-specific payments, split allocations, exact amounts, overpayment, customer isolation and retry deduplication. `supabase/tests/ledger.sql` covers server isolation and write invariants; run it against a disposable Supabase database after applying the migration. The GitHub workflow runs domain tests and a production build.

Do not import the old Access database yet: its account-based balances must first be reconciled and assigned to individual jobs.
