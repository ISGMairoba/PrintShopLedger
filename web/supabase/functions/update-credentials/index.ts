import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const url = Deno.env.get('SUPABASE_URL')!,
    key = Deno.env.get('SUPABASE_ANON_KEY')!;
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) return reply(401, { error: 'Sign in again.' });
  try {
    const body = await request.json();
    if (body.userId !== auth.user.id)
      return reply(409, { error: 'Your signed-in user changed. Reopen My Account.' });
    if (
      typeof body.shopId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(body.shopId) ||
      !['username', 'password'].includes(body.action)
    )
      return reply(400, { error: 'Invalid request.' });
    if (
      typeof body.currentPassword !== 'string' ||
      !body.currentPassword ||
      body.currentPassword.length > 128
    )
      return reply(400, { error: 'Enter your current password.' });
    const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
    const { data: member, error: memberError } = await server
      .from('shop_members')
      .select('user_id,archived,access_level')
      .eq('shop_id', body.shopId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (memberError || !member || member.archived || member.access_level < 1)
      return reply(403, { error: 'Business access denied.' });
    if (!auth.user.email) return reply(400, { error: 'Account credentials unavailable.' });
    const verifier = createClient(url, key, { auth: { persistSession: false } });
    const { data: verified, error: invalid } = await verifier.auth.signInWithPassword({
      email: auth.user.email,
      password: body.currentPassword,
    });
    if (invalid || verified.user?.id !== auth.user.id)
      return reply(401, { error: 'Current password is incorrect.' });
    try {
      if (body.action === 'username') {
        const username = String(body.username ?? '')
          .trim()
          .toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
          return reply(400, { error: 'Username must be 3–40 characters, starting with a letter or number.' });
        const { error } = await server.rpc('update_self_username', {
          p_shop: body.shopId,
          p_actor: auth.user.id,
          p_username: username,
        });
        if (error)
          return reply(400, {
            error: error.code === '23505' ? 'This username is already used in this business.' : error.message,
          });
        return reply(200, { message: 'Username saved.' });
      }
      if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128)
        return reply(400, { error: 'Use a password with 12–128 characters.' });
      // Recheck current access immediately before updating Auth. Supabase hashes the password.
      const { data: current, error: denied } = await server
        .from('shop_members')
        .select('archived,access_level')
        .eq('shop_id', body.shopId)
        .eq('user_id', auth.user.id)
        .single();
      if (denied || !current || current.archived || current.access_level < 1)
        return reply(403, { error: 'Business access denied.' });
      const { error } = await server.auth.admin.updateUserById(auth.user.id, { password: body.password });
      if (error) return reply(400, { error: error.message });
      const { error: auditError } = await server.rpc('audit_staff_password_reset', {
        p_shop: body.shopId,
        p_user: auth.user.id,
        p_actor: auth.user.id,
      });
      return reply(200, {
        message: auditError
          ? 'Password saved. Audit details could not be updated; contact your manager.'
          : 'Password saved.',
      });
    } finally {
      await verifier.auth.signOut({ scope: 'local' });
    }
  } catch {
    return reply(400, { error: 'Could not update credentials. Try again.' });
  }
});
