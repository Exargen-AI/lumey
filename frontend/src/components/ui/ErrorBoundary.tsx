import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/cn';

interface Props {
  /** What to render normally. */
  children: ReactNode;
  /** Custom fallback. Receives the error + a `reset` fn that re-mounts children. */
  fallback?: (args: { error: Error; reset: () => void }) => ReactNode;
  /** Called when an error is caught. Useful for logging to an external service. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * Last-line-of-defense for unexpected runtime errors. Without this, any thrown
 * exception in a render or effect crashes the whole app to a white screen.
 *
 * Wrap the app shell — or a specific page — in <ErrorBoundary>. When something
 * inside throws, we render a friendly recovery panel instead of dying.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <AppShell />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console at minimum so dev sees the trace; consumers can wire to
    // external services via the `onError` prop (Sentry, etc.).
    console.error('[ErrorBoundary] uncaught error:', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }

    return <DefaultFallback error={this.state.error} reset={this.reset} />;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#fafbfc] dark:bg-obsidian-deep">
      <div className={cn(
        'max-w-md w-full rounded-2xl p-7 text-center',
        'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-pop dark:shadow-pop-dark',
        'animate-fade-in-up',
      )}>
        <div className="inline-flex w-12 h-12 rounded-xl bg-rose-100 dark:bg-rose-500/15 ring-1 ring-rose-500/20 items-center justify-center mb-4">
          <AlertTriangle size={24} className="text-rose-600 dark:text-rose-400" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Something went wrong</h1>
        <p className="text-sm text-gray-500 dark:text-obsidian-muted mt-2 leading-relaxed">
          We hit an unexpected error. The full trace is in the console — refreshing usually fixes it.
        </p>

        {/* Show the message in dev so it's actionable; collapse the trace. */}
        {error.message && (
          <details className="mt-4 text-left">
            <summary className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted cursor-pointer hover:text-gray-700 dark:hover:text-obsidian-fg">
              Error details
            </summary>
            <pre className="mt-2 p-3 bg-gray-50 dark:bg-obsidian-sunken rounded-lg text-[11px] text-rose-600 dark:text-rose-300 overflow-x-auto whitespace-pre-wrap break-words font-mono">
              {error.message}
            </pre>
          </details>
        )}

        <div className="flex items-center justify-center gap-2 mt-6">
          <Button variant="ghost" size="sm" onClick={reset}>Try again</Button>
          <Button variant="primary" size="sm" leadingIcon={<RefreshCw size={14} />} onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </div>
    </div>
  );
}
