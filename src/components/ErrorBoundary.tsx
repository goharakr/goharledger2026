import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Catches a page chunk that failed to load (stale filename after a new
// deploy) or any other render-time crash, and reloads once automatically
// instead of leaving the screen blank until someone thinks to refresh by
// hand. sessionStorage guards against a real, repeating crash looping
// forever - it only auto-reloads once per tab session.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    const key = 'errorBoundaryReloaded';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-[50vh] text-slate-400 text-sm">
          Loading...
        </div>
      );
    }
    return this.props.children;
  }
}
