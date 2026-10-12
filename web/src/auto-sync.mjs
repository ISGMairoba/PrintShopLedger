// One scheduler per active workspace. Network writes remain serialized by cloud.ts.
export function createAutoSync({
  run,
  canRun = () => true,
  onStatus = (_status) => {},
  onError = (_error) => {},
  schedule = setTimeout,
  cancel = clearTimeout,
  pollMs = 30000,
}) {
  let timer = null,
    running = false,
    dirty = false,
    disposed = false,
    paused = false,
    failures = 0;
  function arm(ms) {
    if (disposed || paused) return;
    if (timer !== null) cancel(timer);
    timer = schedule(() => {
      timer = null;
      void attempt();
    }, ms);
  }
  async function attempt() {
    if (disposed || paused) return;
    if (running) {
      dirty = true;
      return;
    }
    if (!canRun()) {
      arm(1000);
      return;
    }
    running = true;
    dirty = false;
    onStatus('syncing');
    let delay = pollMs;
    try {
      await run();
      if (disposed) return;
      failures = 0;
      onStatus('saved');
      delay = dirty ? 500 : pollMs;
    } catch (error) {
      if (disposed) return;
      paused = onError(error) === 'pause';
      failures++;
      onStatus(paused ? 'attention' : 'retrying');
      delay = Math.min(60000, 2000 * 2 ** Math.min(failures - 1, 5));
    } finally {
      running = false;
      if (!disposed && !paused) arm(delay);
    }
  }
  return {
    request() {
      if (disposed || paused) return;
      if (running) {
        dirty = true;
        return;
      }
      arm(failures ? Math.min(60000, 2000 * 2 ** Math.min(failures - 1, 5)) : 500);
    },
    wake() {
      if (disposed) return;
      paused = false;
      failures = 0;
      if (running) {
        dirty = true;
        return;
      }
      arm(0);
    },
    dispose() {
      disposed = true;
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}

/**
 * A failure that says nothing about the data — a slow or dropped connection. Automatic sync
 * simply tries again; nobody needs to act.
 */
export function isTransientSyncError(error) {
  const text = `${error?.name ?? ''} ${error instanceof Error ? error.message : String(error)}`;
  return /timed? ?out|TimeoutError|AbortError|Failed to fetch|NetworkError|Load failed|network (connection|request)|ERR_NETWORK|fetch failed/i.test(
    text,
  );
}
