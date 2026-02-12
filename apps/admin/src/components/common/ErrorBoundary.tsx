/**
 * @file ErrorBoundary.tsx
 * @description 全局错误边界组件 - 捕获 React.lazy 加载失败等渲染错误
 * @ref Issue #140
 * @author AI Assistant
 * @created 2026-02-12
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义错误回退 UI */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 错误边界组件
 * 
 * 捕获子组件树中的 JavaScript 错误 (包括 React.lazy 加载失败),
 * 并渲染备用 UI 而非崩溃白屏。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-screen items-center justify-center bg-[var(--bg-primary,#f8fafc)]">
          <div className="text-center max-w-md mx-auto px-6">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-[var(--text-primary,#1e293b)] mb-2">
              页面加载失败
            </h2>
            <p className="text-sm text-[var(--text-muted,#94a3b8)] mb-6 leading-relaxed">
              可能是网络不稳定导致页面组件加载失败，请尝试刷新页面。
            </p>
            <button
              onClick={this.handleRetry}
              className="px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
