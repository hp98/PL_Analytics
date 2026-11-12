import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Per-route error boundary: a crash in one screen shows a recoverable message
// instead of a blank page (§9: never leave the user staring at nothing).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("Route error:", error, info.componentStack);
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="card p-6 text-sm space-y-2">
          <div className="text-fdr-5 font-medium">Something went wrong on this screen.</div>
          <p className="text-ink-muted">{this.state.error.message}</p>
          <button className="btn-brand" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
