import React, { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  componentName?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error boundary component that prevents cascading failures in the Results page.
 * Wraps individual components to isolate errors and show graceful fallbacks.
 */
export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[${this.props.componentName || 'Component'}] Error:`, error);
    console.error('Error info:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback or default minimal UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Return null for silent failure (component just doesn't render)
      return null;
    }

    return this.props.children;
  }
}

/**
 * HOC wrapper for functional components with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  componentName?: string
) {
  return function WithErrorBoundaryWrapper(props: P) {
    return (
      <ComponentErrorBoundary componentName={componentName}>
        <WrappedComponent {...props} />
      </ComponentErrorBoundary>
    );
  };
}

/**
 * Inline wrapper component for JSX usage
 */
export const SafeComponent = ({ 
  children, 
  name,
  showError = false 
}: { 
  children: ReactNode; 
  name?: string;
  showError?: boolean;
}) => {
  return (
    <ComponentErrorBoundary 
      componentName={name}
      fallback={showError ? (
        <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive text-xs">
            <AlertTriangle className="w-3 h-3" />
            <span>Failed to load {name || 'component'}</span>
          </div>
        </div>
      ) : null}
    >
      {children}
    </ComponentErrorBoundary>
  );
};
