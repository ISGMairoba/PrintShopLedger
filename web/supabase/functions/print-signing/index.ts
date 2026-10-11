// Trusted printing for QZ Tray. Staff of a business can fetch the business certificate and have
// QZ Tray requests signed with the business key. The private key never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import forge from 'npm:node-forge@1.3.1';
import { createPrintSigningKey, importSigningKey, signForQz } from '../../../src/print-signing.mjs';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const url = Deno.env.get('SUPABASE_URL')!;
const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const keys = new Map<string, Promise<CryptoKey>>(); // per business, kept while the function is warm

async function businessKey(shopId: string, userId: string) {
  const { data, error } = await server.rpc('print_signing_key', { p_shop: shopId });
  if (error || !data) throw Error('Business not found.');
  if (data.certificate) return data as { certificate: string; private_key: string };
  const created = await createPrintSigningKey(forge, { businessName: data.name });
  const { data: saved, error: saveError } = await server.rpc('save_print_signing_key', {
    p_shop: shopId,
    p_certificate: created.certificate,
    p_private_key: created.privateKey,
    p_user: userId,
  });
  if (saveError || !saved?.certificate) throw Error('Could not save the printing certificate.');
  return saved as { certificate: string; private_key: string };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) return reply(401, { error: 'Sign in again.' });
  let body: { shopId?: unknown; action?: unknown; toSign?: unknown };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: 'Invalid request.' });
  }
  const shopId = body.shopId;
  if (
    typeof shopId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(shopId) ||
    !['certificate', 'sign'].includes(String(body.action))
  )
    return reply(400, { error: 'Invalid request.' });
  if (
    body.action === 'sign' &&
    (typeof body.toSign !== 'string' || !body.toSign || body.toSign.length > 4096)
  )
    return reply(400, { error: 'Invalid request.' });
  const { data: member, error: memberError } = await server
    .from('shop_members')
    .select('archived,access_level')
    .eq('shop_id', shopId)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (memberError || !member || member.archived || member.access_level < 1)
    return reply(403, { error: 'Business access denied.' });
  try {
    const record = await businessKey(shopId, auth.user.id);
    if (body.action === 'certificate') return reply(200, { certificate: record.certificate });
    let key = keys.get(shopId);
    if (!key) keys.set(shopId, (key = importSigningKey(record.private_key)));
    return reply(200, { signature: await signForQz(await key, body.toSign as string) });
  } catch (error) {
    keys.delete(shopId);
    return reply(500, { error: error instanceof Error ? error.message : 'Signing failed.' });
  }
});
