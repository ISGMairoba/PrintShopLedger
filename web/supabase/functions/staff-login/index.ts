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
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in to the business first.' });
  const url = Deno.env.get('SUPABASE_URL')!,
    key = Deno.env.get('SUPABASE_ANON_KEY')!;
  const business = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: auth, error: authError } = await business.auth.getUser(authorization.slice(7));
  if (authError || !auth.user) return reply(401, { error: 'Sign in to the business again.' });
  try {
    const body = await request.json();
    const username = String(body.username ?? '')
      .trim()
      .toLowerCase();
    if (
      typeof body.shopId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(body.shopId) ||
      !username ||
      typeof body.password !== 'string'
    )
      return reply(400, { error: 'Enter your username and password.' });
    const { data: account, error: businessError } = await business
      .from('business_accounts')
      .select('shop_id')
      .eq('shop_id', body.shopId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (businessError || !account) return reply(403, { error: 'Sign in to this business first.' });
    const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
    const { data: member, error: memberError } = await server
      .from('shop_members')
      .select('user_id,archived,access_level')
      .eq('shop_id', body.shopId)
      .eq('username', username)
      .maybeSingle();
    if (memberError || !member || member.archived || member.access_level === 0)
      return reply(401, { error: 'Username or password incorrect, or access is unavailable.' });
    const { data: identity, error: identityError } = await server.auth.admin.getUserById(member.user_id);
    if (identityError || !identity.user.email)
      return reply(401, { error: 'Username or password incorrect, or access is unavailable.' });
    const login = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await login.auth.signInWithPassword({
      email: identity.user.email,
      password: body.password,
    });
    if (error || !data.session)
      return reply(401, { error: 'Username or password incorrect, or access is unavailable.' });
    // Access may have changed while password verification was running.
    const { data: current, error: currentError } = await server
      .from('shop_members')
      .select('archived,access_level')
      .eq('shop_id', body.shopId)
      .eq('user_id', member.user_id)
      .single();
    if (currentError || !current || current.archived || current.access_level === 0) {
      await login.auth.signOut({ scope: 'local' });
      return reply(401, { error: 'Username or password incorrect, or access is unavailable.' });
    }
    return reply(200, { access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch {
    return reply(400, { error: 'Could not sign in. Try again.' });
  }
});
