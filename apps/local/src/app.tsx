import { Component, lazy, type ReactNode, Suspense } from "react";

// U.1 owns the real router shell. Lazy loading keeps runtime engines out of the entry.
const NatallyShell = lazy(() => import("./ui/shell"));

function LoadingApplication() {
  return (
    <main className="app-loading" aria-busy="true">
      <h1>{document.title}</h1>
      <p role="status">Opening your notebook…</p>
    </main>
  );
}

class ApplicationBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-loading">
          <h1>{document.title}</h1>
          <p role="alert">Your notebook could not open: {this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export function NatallyApp() {
  return (
    <ApplicationBoundary>
      <Suspense fallback={<LoadingApplication />}>
        <NatallyShell />
      </Suspense>
    </ApplicationBoundary>
  );
}
