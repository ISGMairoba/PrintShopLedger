import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { deliverRegistrationMail } from '../_shared/registration-mail.ts';
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: allowed, error } = await admin.rpc('registration_worker_authorized', {
    p_key: req.headers.get('x-worker-key') ?? '',
  });
  if (error || !allowed) return new Response('Denied', { status: 403 });
  try {
    return Response.json(await deliverRegistrationMail(admin));
  } catch {
    return Response.json(
      { error: 'Delivery worker failed; queued items remain available for retry.' },
      { status: 503 },
    );
  }
});
