// The installed app's icon and manifest for one business (Business Settings → Profile & logo →
// Installed app icon). Public: phones and Google's install service fetch these without signing in.
// The app links them through /b/<business>/manifest.webmanifest and /b/<business>/icon.png
// (vercel.json rewrites to here), so they stay on the app's own address.
// Only the business name, brand color and the drawn icon are handed out.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const base = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' };
const fail = (status: number, message: string) =>
  new Response(message, { status, headers: { ...base, 'Content-Type': 'text/plain' } });

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Use GET.');
  const url = new URL(request.url);
  const shop = url.searchParams.get('b') ?? '';
  const file = url.searchParams.get('f') ?? 'manifest';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shop)) return fail(400, 'Invalid business.');
  if (!['manifest', 'png'].includes(file)) return fail(400, 'Invalid file.');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin
    .from('business_settings')
    .select('name:settings->>businessName, primary:settings->>primary, png:settings->appIcon->>png, version')
    .eq('shop_id', shop)
    .maybeSingle();
  if (error) return fail(500, 'Could not load the app icon.');
  const png = typeof data?.png === 'string' ? data.png : '';
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(png);
  if (!data || !match) return fail(404, 'This business has no app icon.');
  if (file === 'png') {
    const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { ...base, 'Content-Type': 'image/png' } });
  }
  const name = String(data.name ?? '').trim().slice(0, 45) || 'PrintShopLedger';
  const color = /^#[0-9a-f]{6}$/i.test(String(data.primary)) ? String(data.primary) : '#124b40';
  const icon = `/b/${shop}/icon.png?v=${data.version}`;
  const manifest = {
    id: '/',
    name,
    short_name: name.length > 12 ? name.split(/\s+/)[0].slice(0, 12) : name,
    description: 'Business jobs and individual job payments',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: color,
    background_color: '#f4f6f3',
    icons: [
      { src: icon, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icon, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { ...base, 'Content-Type': 'application/manifest+json' },
  });
});
