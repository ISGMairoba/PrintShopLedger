// Developer console: add a staff account to a business, or set a staff member's password. The
// caller must be on the console team; every action is written to the console activity log.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const ranks: Record<string, number> = { cashier: 1, admin: 2, manager: 3, developer: 4 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in to the console first.' });
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: me, error: meError } = await caller.rpc('console_whoami');
  if (meError || !me) return reply(403, { error: 'Only the console team can do this.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  try {
    const body = await request.json();
    if (typeof body.shopId !== 'string' || !uuid.test(body.shopId))
      return reply(400, { error: 'Invalid business.' });
    const password = String(body.password ?? '');
    if (password.length < 12 || password.length > 128)
      return reply(400, { error: 'Use a password of 12 to 128 characters.' });
    if (body.action === 'reset-password') {
      const { data: target, error } = await caller.rpc('console_staff_account', {
        p_shop: body.shopId,
        p_member: body.memberId,
      });
      if (error || !target) return reply(404, { error: error?.message ?? 'Staff member not found.' });
      const { error: updateError } = await admin.auth.admin.updateUserById(target, { password });
      if (updateError) return reply(400, { error: updateError.message });
      await caller.rpc('console_log_action', {
        p_shop: body.shopId,
        p_action: 'staff.password_reset',
        p_details: { id: body.memberId, staff: String(body.name ?? '') },
      });
      return reply(200, { success: true });
    }
    if (body.action === 'create') {
      const name = String(body.name ?? '').trim();
      const username = String(body.username ?? '')
        .trim()
        .toLowerCase();
      const role = String(body.role ?? '');
      if (!name || name.length > 160) return reply(400, { error: 'Enter a name of up to 160 characters.' });
      if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
        return reply(400, {
          error: 'Username must be 3–40 characters: letters, numbers, dots, underscores or hyphens.',
        });
      if (!ranks[role]) return reply(400, { error: 'Choose a role.' });
      const { data: taken } = await admin
        .from('shop_members')
        .select('id')
        .eq('shop_id', body.shopId)
        .eq('username', username)
        .limit(1);
      if (taken?.length) return reply(400, { error: 'This username is already used in this business.' });
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: `staff-${crypto.randomUUID()}@staff.printshopledger.invalid`,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (createError || !created.user)
        return reply(400, { error: createError?.message ?? 'Could not create the account.' });
      const { error: saveError } = await admin.rpc('provision_shop_user', {
        p_shop: body.shopId,
        p_actor: me.userId,
        p_data: { name, username, role, rank: ranks[role], userId: created.user.id },
      });
      if (saveError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return reply(400, { error: saveError.message });
      }
      await caller.rpc('console_log_action', {
        p_shop: body.shopId,
        p_action: 'staff.created',
        p_details: { staff: name, username, role },
      });
      return reply(200, { success: true });
    }
    return reply(400, { error: 'Unknown action.' });
  } catch (cause) {
    return reply(400, { error: cause instanceof Error ? cause.message : 'Request failed.' });
  }
});
