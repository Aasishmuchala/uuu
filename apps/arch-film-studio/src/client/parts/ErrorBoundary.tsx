import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

import { Banner, Button } from '../kit.ts';

type Props = {
  children: ReactNode;
  /** Names the part in the sentence, e.g. "Review". */
  label?: string;
};

type State = { error: Error | null };

/** Wrap each screen, not just the root: one broken part should not empty the page. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  // Without this the boundary stays tripped after the fix lands and reads as
  // a second bug.
  override componentDidMount(): void {
    import.meta.hot?.on('vite:afterUpdate', this.reset);
  }

  override componentWillUnmount(): void {
    import.meta.hot?.off('vite:afterUpdate', this.reset);
  }

  private reset = (): void => {
    if (this.state.error) this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const what = this.props.label ? `${this.props.label} did not load.` : 'This part did not load.';
    return (
      <div style={{ padding: 'var(--spacing-6)' }}>
        <Banner
          status="error"
          title={what}
          description="Try again. If it keeps happening, reload the page."
          endContent={<Button label="Try again" size="sm" onClick={this.reset} />}
          collapsible
        >
          {`${error.name}: ${error.message}`}
        </Banner>
      </div>
    );
  }
}
