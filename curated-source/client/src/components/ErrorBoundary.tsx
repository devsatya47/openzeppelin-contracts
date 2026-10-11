import { Component, type ReactNode } from 'react';

/** Last-resort screen so a crash never leaves visitors staring at a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-center">
        <div className="gold-rule mb-8" />
        <h1 className="text-4xl text-bone">Something went wrong</h1>
        <p className="mt-4 max-w-md text-mute">The page didn’t load properly. Reloading usually fixes it.</p>
        <button onClick={() => window.location.reload()} className="btn-gold mt-10">
          Reload page
        </button>
      </div>
    );
  }
}
