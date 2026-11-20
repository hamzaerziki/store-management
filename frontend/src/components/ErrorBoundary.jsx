import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center bg-canvas p-6">
        <div className="card p-8 max-w-md text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-600 grid place-items-center mx-auto">
            <AlertTriangle size={22} />
          </div>
          <h2 className="font-extrabold text-lg mt-4">Une erreur est survenue</h2>
          <p className="text-[12.5px] text-muted mt-2 break-words">{this.state.error.message}</p>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }} className="btn-primary mt-5 mx-auto">
            <RotateCcw size={15} /> Recharger la page
          </button>
        </div>
      </div>
    );
  }
}
