import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { businessAuth, supabase } from '../cloud';
import type { FeedbackTone } from '../Feedback';
import { errorMessage, type Shop } from './shared';

/** Whether the browser reports a network connection; updates on online/offline events. */
export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * The two signed-in identities: the business account (businessAuth) and the staff member
 * using the till (supabase). Restores saved sessions on start and follows sign-in changes.
 * Changing `authEpoch` retries a stalled start-up.
 */
export function useAuthSessions(
  authEpoch: number,
  setMessage: (message: string, tone?: FeedbackTone) => void,
) {
  const [session, setSession] = useState<Session | null>(null);
  const [businessSession, setBusinessSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authStartupError, setAuthStartupError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    setAuthStartupError('');
    const deadline = setTimeout(() => {
      if (active)
        setAuthStartupError(
          'Your saved sign-in is taking too long to load. Check your connection and retry.',
        );
    }, 25000);
    Promise.all([supabase.auth.getSession(), businessAuth!.auth.getSession()])
      .then(([staff, business]) => {
        if (!active) return;
        clearTimeout(deadline);
        if (staff.error || business.error)
          setMessage(staff.error?.message || business.error?.message || '', 'error');
        setSession(staff.data.session);
        setBusinessSession(business.data.session);
        setAuthReady(true);
      })
      .catch((error) => {
        clearTimeout(deadline);
        if (active) {
          setMessage(errorMessage(error), 'error');
          setAuthReady(true);
        }
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => {
      if (active) setSession(current);
    });
    const { data: businessListener } = businessAuth!.auth.onAuthStateChange((_event, current) => {
      if (active) setBusinessSession(current);
    });
    return () => {
      active = false;
      clearTimeout(deadline);
      listener.subscription.unsubscribe();
      businessListener.subscription.unsubscribe();
    };
  }, [authEpoch]);
  return { session, setSession, businessSession, setBusinessSession, authReady, authStartupError };
}

/**
 * The business workspaces the signed-in business can open, merged with the staff member's
 * membership in each. Cached per device so a signed-in business can open offline.
 */
export function useWorkspaces({
  businessSession,
  session,
  demo,
  online,
  staffEpoch,
}: {
  businessSession: Session | null;
  session: Session | null;
  demo: boolean;
  online: boolean;
  staffEpoch: number;
}) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [workspaceLookup, setWorkspaceLookup] = useState({ key: '', status: 'loading', error: '' });
  const workspaceIdentity = `${businessSession?.user.id ?? ''}:${session?.user.id ?? 'locked'}`;
  useEffect(() => {
    if (!businessSession || demo || !supabase) {
      setShops([]);
      setShop(null);
      return;
    }
    let active = true;
    setWorkspaceLookup({ key: workspaceIdentity, status: 'loading', error: '' });
    // The SDK can wait for an auth lock before fetch starts, so fetch's abort
    // signal alone does not bound the time spent on this screen.
    const deadline = setTimeout(() => {
      if (active)
        setWorkspaceLookup({
          key: workspaceIdentity,
          status: 'error',
          error: 'The business server is taking too long to respond. Please retry.',
        });
    }, 25000);
    const cacheKey = `printshopledger-business-workspaces:${businessSession.user.id}:${session?.user.id ?? 'locked'}`;
    async function loadShops() {
      try {
        let available: Shop[];
        if (navigator.onLine) {
          const [businessResult, staff] = await Promise.all([
            businessAuth!.rpc('list_business_shops').abortSignal(AbortSignal.timeout(20000)),
            session
              ? supabase!.rpc('list_my_shops').abortSignal(AbortSignal.timeout(20000))
              : Promise.resolve({ data: [], error: null }),
          ]);
          const { data: businesses, error: businessError } = businessResult;
          if (businessError) throw businessError;
          if (staff.error) throw staff.error;
          available = (businesses ?? []).map((business: { id: string; name: string }) => ({
            ...business,
            userId: '',
            role: '',
            rank: 0,
            accessLevel: 0,
            username: '',
            staffName: '',
            ...(staff.data ?? []).find((membership: Shop) => membership.id === business.id),
          }));
          try {
            localStorage.setItem(cacheKey, JSON.stringify(available));
          } catch {
            /* A full device cache must not block a successful online sign-in. */
          }
        } else {
          available = JSON.parse(localStorage.getItem(cacheKey) ?? '[]');
          if (!available.length) throw Error('Connect to load your business workspace.');
        }
        if (active) {
          clearTimeout(deadline);
          setShops(available);
          setShop((current) => available.find((item) => item.id === current?.id) ?? available[0] ?? null);
          setWorkspaceLookup({ key: workspaceIdentity, status: 'ready', error: '' });
        }
      } catch (error) {
        clearTimeout(deadline);
        if (active)
          setWorkspaceLookup({ key: workspaceIdentity, status: 'error', error: errorMessage(error) });
      }
    }
    void loadShops();
    return () => {
      active = false;
      clearTimeout(deadline);
    };
  }, [businessSession?.user.id, session?.user.id, demo, online, staffEpoch]);
  return { shops, shop, setShop, workspaceLookup, setWorkspaceLookup, workspaceIdentity };
}
