// Uses only the browser publishable key. Never use a secret/service-role key here.
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith('sb_publishable_')) throw new Error('Production Supabase configuration is missing.');
const headers = { apikey: key };
const settings = await fetch(url + '/auth/v1/settings', { headers, signal: AbortSignal.timeout(20000) });
if (!settings.ok) throw new Error('Supabase Auth is unreachable or the publishable key was rejected: HTTP ' + settings.status);
console.log('Supabase URL and publishable key accepted.');
for (const table of ['shops', 'shop_members', 'customers', 'jobs', 'payments', 'payment_allocations', 'ledger_events', 'materials', 'material_stock_changes', 'services', 'checkout_records']) {
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

for (const name of ['list_shop_users', 'save_shop_user', 'provision_shop_user']) {
  const body = name === 'list_shop_users' ? { p_shop: null } : name === 'save_shop_user'
    ? { p_shop: null, p_action: 'edit', p_data: {} } : { p_shop: null, p_actor: null, p_data: {} };
  const response = await fetch(url + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (![401,403].includes(response.status) || data.code !== '42501') throw new Error('Anonymous user RPC access was not denied: ' + name);
}
const edge = await fetch(url + '/functions/v1/manage-users', {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000)
});
const edgeBody = await edge.json();
if (edge.status !== 401 || edgeBody.error !== 'Sign in first.') throw new Error('User provisioning handler did not reject anonymous access.');
console.log('User RPCs and secure provisioning handler require authorized sign-in.');

const staffLogin = await fetch(url + '/functions/v1/staff-login', {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
const staffLoginBody=await staffLogin.json();
if(staffLogin.status!==401||staffLoginBody.error!=='Sign in to the business first.')throw new Error('Staff login requires a verified business session.');
console.log('Staff login rejects requests without a business session.');


for (const name of ['apply_checkout_event','apply_job_status_event']) {
 const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_shop:null,p_event:{}}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(![401,403].includes(response.status)||data.code!=='42501')throw Error(name+' must require sign-in');
 console.log(name+' exists and rejects anonymous execution.');
}
