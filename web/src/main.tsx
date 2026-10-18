import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './branding.css';
import './feedback.css';
import './consistency.css';
import { FeedbackProvider } from './Feedback';

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
      <App />
    </FeedbackProvider>
  </React.StrictMode>,
);
