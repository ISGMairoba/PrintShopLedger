import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { validateBusinessRegistration } from '../../../src/registration.mjs';
import { deliverRegistrationMail } from '../_shared/registration-mail.ts';
const headers = {
  'Access-Control-Allow-Origin': 'https://print-shop-ledger.vercel.app',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Content-Type': 'application/json',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer '))
    return reply(401, { error: 'Sign in to the verified business email first.' });
  const url = Deno.env.get('SUPABASE_URL')!,
    key = Deno.env.get('SUPABASE_ANON_KEY')!;
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data: identity, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !identity.user?.email_confirmed_at)
    return reply(401, { error: 'Verify your business email before creating a workspace.' });
  const owner = identity.user.id,
    admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
  let createdId: string | null = null;
  try {
    const profile = validateBusinessRegistration(await req.json());
    const { data: existing, error: readError } = await admin
      .from('business_accounts')
      .select('shop_id')
      .eq('user_id', owner)
      .limit(1);
    if (readError) throw readError;
    if (existing?.length) {
      return reply(200, { shopId: existing[0].shop_id, created: false });
    }
    const { data: staff, error: staffError } = await admin
      .from('shop_members')
      .select('user_id')
      .eq('user_id', owner)
      .limit(1);
    if (staffError) throw staffError;
    if (staff?.length) return reply(403, { error: 'Staff accounts cannot register businesses.' });
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    // With DEVELOPER_DEFAULT_PASSWORD set, the Developer account starts active with that password;
    // without it, it starts disabled with a random password until the emailed activation link is used.
    const developerPassword = Deno.env.get('DEVELOPER_DEFAULT_PASSWORD') ?? '';
    const autoActivate = developerPassword.length >= 12;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: 'staff-developer-' + crypto.randomUUID() + '@staff.printshopledger.invalid',
      password: autoActivate ? developerPassword : crypto.randomUUID() + crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { full_name: 'Developer Maintenance' },
    });
    if (createError || !created.user)
      throw createError ?? Error('Could not provision the Developer account.');
    createdId = created.user.id;
    const { data: result, error: saveError } = await admin.rpc('complete_business_registration', {
      p_owner: owner,
      p_developer: createdId,
      p_name: profile.businessName,
      p_owner_name: profile.ownerName,
      p_activation_hash: hash,
      p_activation_url: 'https://print-shop-ledger.vercel.app/#developer_activation=' + token,
    });
    if (saveError) {
      // A timeout can follow a commit. Confirm ownership before deleting the identity.
      const { data: linked, error: checkError } = await admin
        .from('shop_members')
        .select('shop_id')
        .eq('user_id', createdId);
      if (checkError)
        return reply(503, {
          error: 'Setup needs verification. Sign in again to check your workspace before retrying.',
        });
      if (linked?.length) return reply(200, { shopId: linked[0].shop_id, created: true });
      await admin.auth.admin.deleteUser(createdId);
      createdId = null;
      throw saveError;
    }
    if (!result.created) {
      await admin.auth.admin.deleteUser(createdId);
      createdId = null;
    } else if (autoActivate) {
      const { error: activateError } = await admin.rpc('activate_registered_developer', {
        p_shop: result.shopId,
      });
      if (activateError) console.error('Developer auto-activation failed for a new business.');
    }
    try {
      await deliverRegistrationMail(admin, result.shopId);
    } catch {
      /* The committed outbox is retried by the worker. */
    }
    return reply(200, { shopId: result.shopId, created: result.created });
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : 'Could not create the business.' });
  }
});
