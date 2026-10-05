// Uses only the browser publishable key. Never use a secret/service-role key here.
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith('sb_publishable_')) throw new Error('Production Supabase configuration is missing.');
const headers = { apikey: key };
const settings = await fetch(url + '/auth/v1/settings', { headers, signal: AbortSignal.timeout(20000) });
if (!settings.ok) throw new Error('Supabase Auth is unreachable or the publishable key was rejected: HTTP ' + settings.status);
console.log('Supabase URL and publishable key accepted.');
for (const table of ['shops', 'shop_members', 'customers', 'jobs', 'payments', 'payment_allocations', 'ledger_events', 'materials', 'material_stock_changes', 'services']) {
  const response = await fetch(url + '/rest/v1/' + table + '?select=*&limit=1', { headers, signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (![401, 403].includes(response.status) || body.code !== '42501') {
    throw new Error('Expected anonymous access denied for ' + table + ', received HTTP ' + response.status + ' (' + (body.code ?? 'unknown') + '). Apply the database migration and check grants.');
  }
  console.log('Anonymous access denied: ' + table);
}
const rpc = await fetch(url + '/rest/v1/rpc/list_my_shops', {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: '{}', signal: AbortSignal.timeout(20000)
});
const rpcBody = await rpc.json();
if (![401, 403].includes(rpc.status) || rpcBody.code !== '42501') {
  throw new Error('Workspace RPC is missing or permits anonymous execution: HTTP ' + rpc.status + ' (' + (rpcBody.code ?? 'unknown') + ').');
}
console.log('Workspace RPC exists and requires sign-in.');
console.log('Backend connectivity checks passed. Authenticated payment and isolation tests still require a test account.');

const materialRpc = await fetch(url + '/rest/v1/rpc/apply_material_event', {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_shop: null, p_event: {} }), signal: AbortSignal.timeout(20000)
});
const materialBody = await materialRpc.json();
if (![401, 403].includes(materialRpc.status) || materialBody.code !== '42501') {
  throw new Error('Materials RPC is missing or permits anonymous execution.');
}
console.log('Materials RPC exists and requires sign-in.');

const serviceRpc = await fetch(url + '/rest/v1/rpc/apply_service_event', {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_shop: null, p_event: {} }), signal: AbortSignal.timeout(20000)
});
const serviceBody = await serviceRpc.json();
if (![401, 403].includes(serviceRpc.status) || serviceBody.code !== '42501') throw new Error('Services RPC is missing or permits anonymous execution.');
console.log('Services RPC exists and requires sign-in.');

const customerRpc = await fetch(url + '/rest/v1/rpc/apply_customer_event', {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_shop: null, p_event: {} }), signal: AbortSignal.timeout(20000)
});
const customerBody = await customerRpc.json();
if (![401, 403].includes(customerRpc.status) || customerBody.code !== '42501') throw new Error('Customers RPC is missing or permits anonymous execution.');
console.log('Customers RPC exists and requires sign-in.');
