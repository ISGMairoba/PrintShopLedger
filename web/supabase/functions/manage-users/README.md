# Business user creation

Deploy the function with gateway JWT verification disabled because the handler verifies the bearer token with Supabase Auth's getUser before any account operation. The handler then checks the actor's active Admin, Manager or Developer membership. The service-role key remains exclusively in the function environment.

Staff authentication identifiers are internal random values. Staff only enter a username and password. Usernames are unique within each business. If the database rejects linking a newly created account, the function deletes only that newly created account. User editing, archiving and restoring use rank-aware database functions with optimistic version checks.

Business archiving prevents further server reads and writes, including with an existing token. It retains historical records and does not delete a global authentication account or affect access to other businesses. Previously downloaded offline data cannot be remotely erased by archiving.

Deploy:

    supabase functions deploy manage-users --no-verify-jwt

Use the included SQL workflow checks in a transaction; they roll back all fixtures. The UI test uses mocked API responses and does not create real authentication accounts.

Business sign-in uses email/password and starts as Manager (rank 3). Business and staff sessions use separate auth storage keys and independently issued refresh tokens. Switching staff preserves the business session. Rank values are Cashier 1, Admin 2, Manager 3 and Developer 4; access is either rank or 0. Only higher-ranked users or the user themselves can change a profile, except Developers can manage everyone.

Password resets call the official Supabase Auth Admin API after a database permission check. Supabase Auth hashes passwords server-side before storage; plaintext is never saved in the staff table or logs. The default business Manager currently shares the business account credential, so resetting that Manager password also changes the business email login password.
