import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[render-crash]', error.stack || error.message, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#fff', color: '#c0392b', padding: 16, fontSize: 13, fontFamily: 'monospace' }}>
          <p>畫面發生錯誤：{this.state.error.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}
