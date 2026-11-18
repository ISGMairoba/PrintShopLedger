import { useEffect, useState } from 'react';
import { supabase } from './cloud';

// The extra page limit for the signed-in person at this device's branch (General Manager per branch,
// Manager+ per person; see page-access.mjs limitedPageAccess). Kept on the device so it still applies
// offline; null when none is set.
const key = (scope: string, branch: string) => `printshopledger:page-limit:v1:${scope}:${branch}`;
function saved(scope: string, branch: string): string[] | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(scope, branch)) ?? 'null');
    return Array.isArray(value) && value.every((page) => typeof page === 'string') ? value : null;
  } catch {
    return null;
  }
}
export function usePageLimit({
  scope,
  shopId,
  branch,
  online,
  ready,
}: {
  scope: string;
  shopId?: string;
  branch: string;
  online: boolean;
  ready: boolean;
}) {
  const [limit, setLimit] = useState<string[] | null>(() => (scope ? saved(scope, branch) : null));
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    setLimit(scope ? saved(scope, branch) : null);
    if (!scope || !shopId || !online || !ready || !supabase) return;
    let live = true;
    Promise.resolve(supabase.rpc('my_page_limits', { p_shop: shopId }))
      .then(({ data, error }) => {
        if (!live || error) return;
        const next = Array.isArray(data) ? (data as string[]) : null;
        try {
          if (next) localStorage.setItem(key(scope, branch), JSON.stringify(next));
          else localStorage.removeItem(key(scope, branch));
        } catch {}
        setLimit(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [scope, shopId, branch, online, ready, changed]);
  /** Ask the server again (after limits are changed on the Users page). */
  const reload = () => setChanged((n) => n + 1);
  return { limit, reload };
}
