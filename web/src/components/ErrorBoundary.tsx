import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render-time errors (e.g. a malformed Firestore record) so one bad
 * row can't blank the whole app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md rounded-2xl border border-rose-900 bg-rose-950/40 p-6 text-center">
          <div className="text-sm font-semibold text-rose-200">Something went wrong rendering this view.</div>
          <div className="mt-1 text-xs text-rose-300/80">{this.state.error.message}</div>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-lg border border-rose-700 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-900/40"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
