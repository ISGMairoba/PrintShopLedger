import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './branding.css';
import './feedback.css';
import { FeedbackProvider } from './Feedback';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  </React.StrictMode>,
);
