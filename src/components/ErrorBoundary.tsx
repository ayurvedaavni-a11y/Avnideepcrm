import React, { Component, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  componentStack?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
    // Surface the real error to any global handlers (browser DevTools, logs)
    window.dispatchEvent(
      new CustomEvent('crm:error', {
        detail: { message: error?.message || String(error), stack: error?.stack || '', componentStack: errorInfo?.componentStack || '' },
      })
    );
    this.setState({ componentStack: errorInfo?.componentStack ?? '' });
  }

  private copyError = () => {
    const { error, componentStack } = this.state;
    const text = `[AVNIDEEP CRM] Module error\n\n${error?.message || 'Unknown error'}\n\nStack:\n${error?.stack || '(no stack)'}\n${componentStack ? `\nComponent stack:\n${componentStack}` : ''}`;
    try {
      navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
  };

  public render() {
    if (this.state.hasError) {
      const { error } = this.state;
      return (
        <div className="p-6 bg-red-50 rounded-lg border border-red-200 m-4">
          <h2 className="text-xl font-bold text-red-700 mb-2">Module error occurred</h2>
          <p className="text-red-600 mb-4">
            An unexpected error occurred. The rest of the application is still working.
          </p>
          {error && (
            <div className="mb-4">
              <div className="text-xs font-mono text-red-700 bg-white border border-red-200 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                <div className="font-bold mb-1">{error.message || String(error)}</div>
                {error.stack && <div className="text-red-500 opacity-80">{error.stack}</div>}
              </div>
              <button
                onClick={this.copyError}
                className="mt-2 px-3 py-1.5 text-xs font-bold bg-red-600 text-white rounded hover:bg-red-700 transition"
              >
                Copy error
              </button>
            </div>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: undefined, componentStack: undefined })}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
