# Business user creation

Deploy the function with gateway JWT verification disabled because the handler verifies the bearer token with Supabase Auth's getUser before any account operation. The handler then checks the actor's active administrator membership. The service-role key remains exclusively in the function environment.

Existing email accounts are rejected, never reset or linked silently. If the database rejects linking a newly created account, the function deletes only that newly created account. User editing, archiving and restoring use administrator-only database functions with optimistic version checks.

Business archiving prevents further server reads and writes, including with an existing token. It retains historical records and does not delete a global authentication account or affect access to other businesses. Previously downloaded offline data cannot be remotely erased by archiving.

Deploy:

    supabase functions deploy manage-users --no-verify-jwt

Use the included SQL workflow checks in a transaction; they roll back all fixtures. The UI test uses mocked API responses and does not create real authentication accounts.
