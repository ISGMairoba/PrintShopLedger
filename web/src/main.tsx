import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './branding.css';
import './feedback.css';
import './consistency.css';
import { FeedbackProvider } from './Feedback';
// The developer console (/console) is a separate part of the app, loaded only when opened.
const ConsoleApp = lazy(() => import('./console/ConsoleApp'));
const isConsole = window.location.pathname === '/console' || window.location.pathname.startsWith('/console/');

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
