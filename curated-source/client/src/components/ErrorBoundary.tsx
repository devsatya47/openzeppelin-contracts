import { Component, type ReactNode } from 'react';
import { isChunkLoadError, reportError } from '../lib/errorReport';

const RELOAD_KEY = 'cs_error_reload_at';

/** Reload at most once a minute, so a persistent failure can't cause a reload loop. */
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

type Props = { children: ReactNode; where: string; compact?: boolean };

/**
 * Catches crashes so visitors never see a blank page. The page-level boundary is keyed by the
 * current path, so a crash on one page clears as soon as the visitor navigates elsewhere.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
    reportError(error, this.props.where);
    // Code from an older deploy: fetching the current version fixes it, so do that automatically.
    if (isChunkLoadError(error)) reloadOnce();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={`flex flex-col items-center justify-center bg-ink px-6 text-center ${this.props.compact ? 'min-h-[60vh]' : 'min-h-screen'}`}>
        <div className="gold-rule mb-8" />
        <h1 className="text-4xl text-bone">Something went wrong</h1>
        <p className="mt-4 max-w-md text-mute">This page didn’t load properly. Reloading usually fixes it, or use the menu to go elsewhere.</p>
        <button onClick={() => window.location.reload()} className="btn-gold mt-10">
          Reload page
        </button>
        <details className="mt-10 max-w-xl text-left text-xs text-faint">
          <summary className="cursor-pointer text-center">Technical details</summary>
          <code className="mt-3 block whitespace-pre-wrap break-words font-mono">{error.message}</code>
        </details>
      </div>
    );
  }
}
