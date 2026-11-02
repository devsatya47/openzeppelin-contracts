import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { CatalogProvider } from './lib/catalog';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installDomGuard } from './lib/domGuard';
import { reportError } from './lib/errorReport';
import './index.css';

installDomGuard();
window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="app">
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
        <AuthProvider>
          <CatalogProvider>
            <App />
          </CatalogProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
