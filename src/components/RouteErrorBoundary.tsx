import React, { Component, ReactNode } from 'react';
import { WolfLoadingOverlay } from '@/components/ui/wolf-loading-overlay';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorCount: number;
}

/**
 * Error boundary specifically designed to catch and recover from
 * React hook initialization errors that can occur on mobile devices,
 * particularly in PWA environments where the React context may not
 * be fully initialized during lazy loading.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  private static MAX_RETRIES = 2;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorCount: 0 };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[RouteErrorBoundary] Caught error:', error.message);
    console.error('[RouteErrorBoundary] Component stack:', errorInfo.componentStack);

    // Check if it's a hook-related error
    const isHookError = 
      error.message.includes('useState') ||
      error.message.includes('useEffect') ||
      error.message.includes('useRef') ||
      error.message.includes('useCallback') ||
      error.message.includes('Invalid hook call') ||
      error.message.includes('Hooks can only be called');

    if (isHookError) {
      console.warn('[RouteErrorBoundary] Hook error detected, attempting recovery...');
      
      // Clear any existing retry timeout
      if (this.retryTimeoutId) {
        clearTimeout(this.retryTimeoutId);
      }

      // If we haven't exceeded max retries, try to recover
      if (this.state.errorCount < RouteErrorBoundary.MAX_RETRIES) {
        this.retryTimeoutId = setTimeout(() => {
          this.setState(prev => ({
            hasError: false,
            errorCount: prev.errorCount + 1
          }));
        }, 500);
      } else {
        // Too many retries, force a full page reload as last resort
        console.warn('[RouteErrorBoundary] Max retries exceeded, forcing page reload');
        window.location.reload();
      }
    }
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  render() {
    if (this.state.hasError) {
      return <WolfLoadingOverlay />;
    }

    return this.props.children;
  }
}
