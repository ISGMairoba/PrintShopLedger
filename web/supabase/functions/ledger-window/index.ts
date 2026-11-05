// History kept on a device (stage 2): the first download for a device that keeps recent history
// only. Reads the business copy as the signed-in staff member (same rules as the app), then leaves
// out old closed records with the app's own trimHistory, so the figures cannot drift.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { normalizeLedger } from '../../../src/materials.mjs';
import { trimHistory } from '../../../src/history-window.mjs';

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
  let body: { shopId?: unknown; cutoff?: unknown };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: 'Invalid request.' });
  }
  if (typeof body.shopId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.shopId))
    return reply(400, { error: 'Invalid business.' });
  if (typeof body.cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.cutoff) || Number.isNaN(Date.parse(body.cutoff)))
    return reply(400, { error: 'Invalid history window.' });
  const branch = request.headers.get('x-psl-branch');
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization, ...(branch ? { 'x-psl-branch': branch } : {}) } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc('get_ledger_changes', { p_shop: body.shopId, p_since: null });
  if (error) return reply(400, { error: error.message });
  try {
    const { ledger, dropped, carried } = trimHistory(normalizeLedger(data.ledger), body.cutoff);
    return reply(200, { ...data, full: true, ledger, window: { cutoff: body.cutoff, dropped, carried } });
  } catch (cause) {
    return reply(500, { error: 'Could not prepare the recent history: ' + (cause instanceof Error ? cause.message : String(cause)) });
  }
});
