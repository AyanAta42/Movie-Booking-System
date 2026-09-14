import { Component, type ErrorInfo, type ReactNode } from "react";

/// Shows what broke instead of rendering nothing.
///
/// Added after a crash in App rendered a blank page, which on a phone — no
/// devtools, no console — is indistinguishable from the server being
/// unreachable. Debugging a white screen across two devices is not worth the
/// twenty lines this costs.
type State = { error: Error | null };

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ui] unhandled error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-neutral-950 p-6 text-neutral-100">
        <h1 className="text-base font-medium text-red-400">Something broke</h1>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-300">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => location.reload()}
          className="mt-4 rounded bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-900"
        >
          Reload
        </button>
      </div>
    );
  }
}
