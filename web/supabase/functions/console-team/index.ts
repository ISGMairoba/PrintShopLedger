// Developer console team accounts: an owner adds a team member (a new sign-in account, never a
// business's) or sets a member's password. The caller must be a console owner.
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
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in to the console first.' });
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: me, error: meError } = await caller.rpc('console_whoami');
  if (meError || !me) return reply(403, { error: 'Only the console team can do this.' });
  if (me.role !== 'owner') return reply(403, { error: 'Only a console owner can manage the team.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  try {
    const body = await request.json();
    const password = String(body.password ?? '');
    if (password.length < 12 || password.length > 128)
      return reply(400, { error: 'Use a password of 12 to 128 characters.' });
    if (body.action === 'add') {
      const email = String(body.email ?? '')
        .trim()
        .toLowerCase();
      const name = String(body.name ?? '').trim();
      const role = body.role === 'owner' ? 'owner' : 'support';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid email.' });
      if (!name || name.length > 80) return reply(400, { error: 'Enter a name.' });
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name, console: true },
      });
      if (createError || !created.user)
        return reply(400, {
          error: /already/i.test(createError?.message ?? '')
            ? 'That email already has an account. Use a separate email for the console.'
            : (createError?.message ?? 'Could not create the account.'),
        });
      const { error: setError } = await caller.rpc('console_set_member', {
        p_user: created.user.id,
        p_name: name,
        p_role: role,
        p_disabled: false,
      });
      if (setError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return reply(400, { error: setError.message });
      }
      return reply(200, { userId: created.user.id });
    }
    if (body.action === 'reset-password') {
      const { data: members, error: listError } = await caller.rpc('console_team');
      if (listError) return reply(400, { error: listError.message });
      const target = (members as { userId: string }[]).find((m) => m.userId === body.userId);
      if (!target) return reply(404, { error: 'Not a console team member.' });
      const { error: updateError } = await admin.auth.admin.updateUserById(target.userId, { password });
      if (updateError) return reply(400, { error: updateError.message });
      return reply(200, { userId: target.userId });
    }
    return reply(400, { error: 'Unknown action.' });
  } catch (cause) {
    return reply(400, { error: cause instanceof Error ? cause.message : 'Request failed.' });
  }
});
