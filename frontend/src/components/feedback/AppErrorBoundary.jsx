import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { if (import.meta.env.DEV) console.error('Application render error', error); }
  render() {
    if (this.state.failed) return <main className="fatal-error"><div><h1>We couldn’t display this page</h1><p>Your information is safe. Reload the page to continue.</p><button className="ui-button ui-button--primary" onClick={() => window.location.reload()}>Reload application</button></div></main>;
    return this.props.children;
  }
}
