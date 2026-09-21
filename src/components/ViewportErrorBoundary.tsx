import React from 'react';
import { AlertTriangle, RotateCcw, Copy, Check } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
  viewportType?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  copied: boolean;
}

export class ViewportErrorBoundary extends React.Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ViewportErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  handleCopy = () => {
    const text = `${this.state.error?.toString()}\n${this.state.errorInfo?.componentStack || ''}`;
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }).catch(() => {});
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-zinc-950/95 border border-red-500/40 text-zinc-200 flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
          <div className="max-w-md w-full bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 shadow-2xl flex flex-col items-center text-center backdrop-blur-md">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-3">
              <AlertTriangle size={24} />
            </div>

            <h3 className="text-sm font-bold text-white mb-1">
              {this.props.fallbackTitle || 'Incidencia en el Visor 3D'}
            </h3>
            <p className="text-xs text-zinc-400 mb-3">
              Se ha aislado un error en este visor ({this.props.viewportType || 'Viewport'}) sin interrumpir el resto del editor ni tus cambios.
            </p>

            {this.state.error && (
              <div className="w-full bg-black/60 border border-white/5 rounded p-2.5 mb-4 text-left font-mono text-[11px] text-red-300 max-h-24 overflow-y-auto break-all">
                {this.state.error.message || this.state.error.toString()}
              </div>
            )}

            <div className="flex items-center gap-2 w-full">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex-1 py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-lg shadow-indigo-600/20"
              >
                <RotateCcw size={14} />
                <span>Reiniciar Visor</span>
              </button>

              <button
                type="button"
                onClick={this.handleCopy}
                className="py-1.5 px-2.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors cursor-pointer border border-zinc-700"
                title="Copiar detalles del error"
              >
                {this.state.copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span className="text-[11px]">{this.state.copied ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
