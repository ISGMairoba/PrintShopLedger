import { useEffect, useState } from 'react';
import { storageHealth } from './storage';
import { useWords } from './Words';

const mb = (bytes: number | null) => (bytes === null ? '—' : `${Math.round(bytes / 1048576)} MB`);
export const LOW_SPACE = 200 * 1048576;

/** My Account: how this device keeps its offline copy, so staff can see it is safe. */
export default function DeviceStorageCard({ pending, lastSynced }: { pending: number; lastSynced?: string }) {
  const { w } = useWords();
  const [health, setHealth] = useState<Awaited<ReturnType<typeof storageHealth>> | null>(null);
  useEffect(() => {
    void storageHealth().then(setHealth);
  }, [pending, lastSynced]);
  const low = health?.free != null && health.free < LOW_SPACE;
  return (
    <section className="panel editor" aria-labelledby="device-storage">
      <h2 id="device-storage">{w('This device')}</h2>
      <dl className="device-storage">
        <div>
          <dt className="muted">{w('Unsynced changes')}</dt>
          <dd>{pending}</dd>
        </div>
        <div>
          <dt className="muted">{w('Last synced')}</dt>
          <dd>{lastSynced ? new Date(lastSynced).toLocaleString() : w('Not yet')}</dd>
        </div>
        <div>
          <dt className="muted">{w('Offline copy uses')}</dt>
          <dd>{mb(health?.usage ?? null)}</dd>
        </div>
        <div>
          <dt className="muted">{w('Space left for the app')}</dt>
          <dd>{mb(health?.free ?? null)}</dd>
        </div>
        <div>
          <dt className="muted">{w('Kept by the browser')}</dt>
          <dd>{health ? (health.persisted ? w('Yes') : w('Not guaranteed')) : '—'}</dd>
        </div>
      </dl>
      {low && (
        <p className="notice" role="status">
          {w(
            'This computer is low on space. Free up disk space so the offline copy and unsynced sales stay safe.',
          )}
        </p>
      )}
    </section>
  );
}
