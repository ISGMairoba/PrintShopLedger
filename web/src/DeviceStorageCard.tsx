import { useEffect, useState } from 'react';
import { storageHealth } from './storage';
import { useWords } from './Words';
import Icon from './Icon';
import HistoryCheck from './HistoryCheck';
import type { Ledger } from './types';
import { KEEP_CHOICES, businessKeepChoice, deviceChoice } from './history-keep.mjs';

const mb = (bytes: number | null) => (bytes === null ? '—' : `${Math.round(bytes / 1048576)} MB`);
export const LOW_SPACE = 200 * 1048576;

/** My Account: how this device keeps its offline copy, so staff can see it is safe. */
export default function DeviceStorageCard({
  pending,
  lastSynced,
  syncing = false,
  onSyncAll,
  history,
  onKeepChange,
}: {
  pending: number;
  lastSynced?: string;
  syncing?: boolean;
  /** Download the whole business again (instead of only what changed). */
  onSyncAll?: () => Promise<void>;
  /** The device's ledger, for the history check. */
  history?: { ledger: Ledger; scope: string };
  /** Change how much history this device keeps (downloads again). */
  onKeepChange?: (choice: string) => Promise<void>;
}) {
  const { w } = useWords();
  const [asked, setAsked] = useState(''),
    [syncError, setSyncError] = useState('');
  const [health, setHealth] = useState<Awaited<ReturnType<typeof storageHealth>> | null>(null);
  useEffect(() => {
    void storageHealth().then(setHealth);
  }, [pending, lastSynced]);
  const low = health?.free != null && health.free < LOW_SPACE;
  const [keep, setKeep] = useState(() => (history ? deviceChoice(history.scope) : 'business'));
  const businessLabel =
    KEEP_CHOICES.find(([v]) => v === (history ? businessKeepChoice(history.scope) : 'all'))?.[1] ??
    'Everything';
  const [keepError, setKeepError] = useState('');
  const cutoff = history?.ledger.historySummary?.cutoff;
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
      {health && !health.persisted && (
        <p className="notice notice-warning">
          {w(
            'The browser may clear the offline copy when the device runs low on space or the app is not opened for a while, and changes not yet synced would be lost.',
          )}{' '}
          {w(
            'Add the app to the home screen (or install it from the browser menu) so the browser keeps it, and sync before leaving it unused.',
          )}
        </p>
      )}
      {onSyncAll && (
        <div className="device-sync-all">
          <button
            type="button"
            className="secondary"
            disabled={syncing || (!!asked && asked === (lastSynced ?? 'never'))}
            onClick={() => {
              setSyncError('');
              setAsked(lastSynced ?? 'never');
              onSyncAll().catch((e) => {
                setAsked('');
                setSyncError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            <Icon name="sync" />{' '}
            {asked && asked === (lastSynced ?? 'never') ? 'Downloading everything…' : 'Sync all'}
          </button>
          <p className="muted">
            {asked && asked !== (lastSynced ?? 'never')
              ? 'Everything was downloaded again.'
              : 'Normally this device downloads only what changed, and everything once a day. Sync all downloads the whole business now.'}
          </p>
          {syncError && (
            <p className="danger-text" role="alert">
              {syncError}
            </p>
          )}
        </div>
      )}
      {history && onKeepChange && (
        <div className="device-keep">
          <label>
            History kept on this device
            <select
              aria-label="History kept on this device"
              value={keep}
              disabled={syncing || pending > 0}
              onChange={(e) => {
                const next = e.target.value;
                setKeepError('');
                setKeep(next);
                onKeepChange(next).catch((cause) => {
                  setKeep(deviceChoice(history.scope));
                  setKeepError(cause instanceof Error ? cause.message : String(cause));
                });
              }}
            >
              <option value="business">Business default ({businessLabel})</option>
              {KEEP_CHOICES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            {cutoff
              ? `This device keeps records from ${new Date(cutoff + 'T12:00:00+01:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}, plus every job still owing or not collected. Balances, wallets and stock are the same as on every other device. Older detail (old reports and statements) needs Everything.`
              : 'Everything: this device has every record. A shorter choice downloads less and keeps phones fast; balances stay the same. Nothing is deleted from the business.'}
            {pending > 0 && ' Wait until all work on this device has synced before changing this.'}
          </p>
          {keepError && (
            <p className="danger-text" role="alert">
              {keepError}
            </p>
          )}
        </div>
      )}
      {history && !cutoff && <HistoryCheck ledger={history.ledger} scope={history.scope} />}
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
