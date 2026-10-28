import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './branding.css';
import './feedback.css';
import './consistency.css';
import { FeedbackProvider } from './Feedback';
import { installInputGuard } from './input-guard.mjs';
import { recordProblem } from './problem-log.mjs';
// The developer console (/console) is a separate part of the app, loaded only when opened.
const ConsoleApp = lazy(() => import('./console/ConsoleApp'));
const isConsole = window.location.pathname === '/console' || window.location.pathname.startsWith('/console/');

// Number and phone fields refuse letters as they are typed (input-guard.mjs).
installInputGuard();
// App errors on this device are noted for the developer console (sent with the next sync).
if (!isConsole) {
  const detail = (stack?: string) => ({
    stack: String(stack ?? '').slice(0, 1500),
    path: window.location.pathname,
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    browser: navigator.userAgent.slice(0, 200),
  });
  window.addEventListener('error', (event) => {
    const error = event.error as Error | undefined;
    recordProblem('error', error?.message || event.message, detail(error?.stack));
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as Error | string | undefined;
    recordProblem(
      'error',
      typeof reason === 'string' ? reason : reason?.message || 'Unhandled promise rejection',
      detail(typeof reason === 'string' ? '' : reason?.stack),
    );
  });
}

// Scroll bars stay hidden until needed (consistency.css): an area shows its bar while it scrolls.
{
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target === document ? document.documentElement : (event.target as Element);
      if (!(target instanceof Element)) return;
      target.classList.add('is-scrolling');
      clearTimeout(timers.get(target));
      timers.set(
        target,
        window.setTimeout(() => target.classList.remove('is-scrolling'), 900),
      );
    },
    { capture: true, passive: true },
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FeedbackProvider>
      {isConsole ? (
        <Suspense fallback={<p className="console-loading">Loading the console…</p>}>
          <ConsoleApp />
        </Suspense>
      ) : (
        <App />
      )}
    </FeedbackProvider>
  </React.StrictMode>,
);
