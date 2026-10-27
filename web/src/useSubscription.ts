import { useEffect, useState } from 'react';
import { supabase } from './cloud';

export type Subscription = {
  state: 'none' | 'trial' | 'active' | 'grace' | 'expired' | 'suspended';
  plan?: string | null;
  expiresAt?: string | null;
  graceEndsAt?: string | null;
  restriction?: '' | 'warn' | 'read_only' | 'pages_off' | 'locked';
  pagesOff?: string[];
  message?: string;
};
const NONE: Subscription = { state: 'none' };
const key = (scope: string) => `printshopledger:subscription:v1:${scope}`;
const EVERY = 30 * 60 * 1000;

/**
 * The business's subscription as set in the developer console. Kept on the device, so a business
 * that has run out stays read-only or locked offline too; checked again every 30 minutes.
 */
export default function useSubscription(
  scope: string,
  shopId: string | undefined,
  online: boolean,
  demo: boolean,
) {
  const [value, setValue] = useState<Subscription>(() => {
    try {
      return JSON.parse(localStorage.getItem(key(scope)) ?? 'null') ?? NONE;
    } catch {
      return NONE;
    }
  });
  useEffect(() => {
    try {
      setValue(JSON.parse(localStorage.getItem(key(scope)) ?? 'null') ?? NONE);
    } catch {
      setValue(NONE);
    }
    if (demo || !scope || !shopId || !online || !supabase) return;
    let live = true;
    const load = async () => {
      const { data, error } = await supabase!.rpc('my_subscription', { p_shop: shopId });
      if (!live || error || !data) return;
      setValue(data as Subscription);
      try {
        localStorage.setItem(key(scope), JSON.stringify(data));
      } catch {}
    };
    void load();
    const timer = setInterval(() => void load(), EVERY);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [scope, shopId, online, demo]);
  return value;
}

const day = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium' }) : '';
/** The banner for staff, or null: ending soon, in grace, or ended. */
export function subscriptionNotice(
  s: Subscription,
): { tone: 'info' | 'warning' | 'error'; text: string } | null {
  const extra = s.message ? ` ${s.message}` : '';
  if (s.state === 'grace')
    return {
      tone: 'warning',
      text: `Your PrintShopLedger subscription ended on ${day(s.expiresAt)}. Renew by ${day(s.graceEndsAt)} to keep recording work.${extra}`,
    };
  if (s.state === 'expired' || s.state === 'suspended') {
    const what =
      s.restriction === 'read_only'
        ? 'You can view and export records, but new work cannot be recorded until it is renewed.'
        : s.restriction === 'pages_off'
          ? 'Some pages are turned off until it is renewed.'
          : 'Please renew it.';
    return {
      tone: s.restriction === 'warn' ? 'warning' : 'error',
      text: `Your PrintShopLedger subscription ${s.state === 'suspended' ? 'is suspended' : 'has ended'}. ${what}${extra}`,
    };
  }
  if ((s.state === 'active' || s.state === 'trial') && s.expiresAt) {
    const days = Math.ceil((Date.parse(s.expiresAt) - Date.now()) / 86400000);
    if (days <= 7)
      return {
        tone: 'info',
        text: `Your PrintShopLedger ${s.state === 'trial' ? 'trial' : 'subscription'} ends on ${day(s.expiresAt)} (${days <= 1 ? 'within a day' : `${days} days`}).${extra}`,
      };
  }
  return null;
}
