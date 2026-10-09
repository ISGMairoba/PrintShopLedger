# Business self-registration

The public app offers email-confirmed business signup. After confirmation, register-business validates the owner session and atomically creates the business, its Manager membership, its separate Developer membership, and a private activation-email outbox entry. The Developer starts with access disabled and a random Auth password until activation.

Maintenance recipient is stored in private.registration_config (initially mairobaprints@gmail.com). It is not accepted from registration requests or per-business settings.

## Required email setup

1. Configure custom SMTP in Supabase Auth so confirmation emails can reach public business addresses. Keep email confirmation enabled and allow https://print-shop-ledger.vercel.app/ as a redirect URL.
2. Set Supabase Edge Function secrets RESEND_API_KEY and REGISTRATION_MAIL_FROM. The sender must be verified with Resend. These secrets are used by register-business and registration-mail-worker.
3. The registration-mail-retry database cron job runs every five minutes. Before sender configuration, messages remain queued. After configuration, pending notifications send automatically.

Activation links expire after seven days and may be submitted once. Tokens are hashed in the registration record; only the private outbox contains the delivery URL, and it is cleared after sending. A link load does not consume it. Activation requires a 12–128 character password.

Developer credentials are staff credentials: business sign-in is still required before staff sign-in. No business password is forwarded.

API functions use explicit user verification or a Vault-held worker key. Database service functions are not executable by anon/authenticated roles. Mail provider responses and activation links must not be printed to logs.

Validation: npm test, npm run build, scripts/check-registration.mjs, supabase/tests/business_registration.sql and the existing login/sync browser checks.
