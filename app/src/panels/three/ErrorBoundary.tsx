// Minimal error boundary used to degrade the 3D left panel to the 2D Pixi
// monitor if the WebGL Canvas throws (lost context, asset failure, etc.).
// Deliberately free of any three/r3f imports so it can be imported anywhere.

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
