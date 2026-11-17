import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { validateUser } from '../../../src/users.mjs';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-psl-branch',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in first.' });
  // The branch the app is working in (x-psl-branch): the Users list is that branch's staff, and a
  // user added there works in that branch.
  const branch = (request.headers.get('x-psl-branch') ?? '').trim();
  const branchHeaders: Record<string, string> = /^b-[a-z0-9]{6,20}$/.test(branch)
    ? { 'x-psl-branch': branch }
    : {};
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization, ...branchHeaders } },
    auth: { persistSession: false },
  });
  const { data: auth, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !auth.user) return reply(401, { error: 'Sign in again.' });
  try {
    const body = await request.json();
    if (typeof body.shopId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.shopId))
      return reply(400, { error: 'Invalid business.' });
    // Validate current business-admin access before touching authentication accounts.
    const { data: membership, error: memberError } = await client
      .from('shop_members')
      .select('rank,access_level,archived')
      .eq('shop_id', body.shopId)
      .eq('user_id', auth.user.id)
      .single();
    if (memberError || !membership || membership.access_level < 2 || membership.archived)
      return reply(403, { error: 'User management access denied.' });
    if (body.action === 'reset-password') {
      if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128)
        return reply(400, { error: 'Use a password with 12–128 characters.' });
      const { data: target, error: denied } = await client.rpc('authorize_staff_password_reset', {
        p_shop: body.shopId,
        p_id: body.id,
        p_version: body.version,
      });
      if (denied || !target) return reply(403, { error: denied?.message ?? 'Password reset denied.' });
      const server = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false },
      });
      // Supabase Auth hashes the password before persistence. No credential enters the staff table.
      const { error: failure } = await server.auth.admin.updateUserById(target, { password: body.password });
      if (failure) return reply(400, { error: failure.message });
      const { error: auditError } = await server.rpc('audit_staff_password_reset', {
        p_shop: body.shopId,
        p_user: target,
        p_actor: auth.user.id,
      });
      return reply(200, {
        success: true,
        warning: auditError ? 'Password reset succeeded; audit update needs administrator review.' : null,
      });
    }
    const profile = validateUser(body);
    if (profile.role === 'general_manager')
      return reply(403, { error: 'The General Manager is the business account and cannot be added here.' });
    if (profile.rank > membership.rank) return reply(403, { error: 'Cannot assign a rank above your own.' });
    const email = `staff-${crypto.randomUUID()}@staff.printshopledger.invalid`;
    if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128)
      return reply(400, { error: 'Use a password with 12–128 characters.' });
    const { data: existing, error: lookupError } = await client.rpc('list_shop_users', {
      p_shop: body.shopId,
    });
    if (lookupError) return reply(403, { error: lookupError.message });
    if (existing.some((item: { username: string }) => item.username === profile.username))
      return reply(400, { error: 'This username is already used in this business.' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
      global: { headers: branchHeaders },
    });
    // Authentication identifier is internal; staff use only business-scoped usernames.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: profile.name },
    });
    if (createError || !created.user)
      return reply(400, { error: createError?.message ?? 'Could not create account.' });
    const { error: saveError } = await admin.rpc('provision_shop_user', {
      p_shop: body.shopId,
      p_actor: auth.user.id,
      p_data: { ...profile, userId: created.user.id },
    });
    if (saveError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
      return reply(400, {
        error: cleanupError
          ? 'Business linking failed. An administrator must review the unused account before retrying.'
          : saveError.code === '23505'
            ? 'This username is already used in this business.'
            : saveError.message,
      });
    }
    return reply(200, { success: true });
  } catch (cause) {
    return reply(400, { error: cause instanceof Error ? cause.message : 'Could not create user.' });
  }
});
