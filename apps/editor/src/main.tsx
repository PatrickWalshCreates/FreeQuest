import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './ErrorScreen.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary onLeave={() => window.location.reload()} leaveLabel="Reload the editor">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
