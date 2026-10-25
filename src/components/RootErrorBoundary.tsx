import React from 'react';

// src/components/RootErrorBoundary.tsx
// Folia LX: a render error used to unmount the whole tree and leave a black window with no way out.
// This catches it, shows what broke and offers a reload, and the error still reaches the console
// (and so the runtime log).

type State = { error: Error | null };

export class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: unknown): State {
        return { error: error instanceof Error ? error : new Error(String(error)) };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo) {
        console.error('[RootErrorBoundary] The app crashed while rendering', error, info.componentStack);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        const detail = `${error.message}\n\n${error.stack ?? ''}`.slice(0, 4000);
        return (
            <div style={{ position: 'fixed', inset: 0, overflow: 'auto', padding: 32, background: '#0b0b0d', color: '#eee', font: '14px/1.6 system-ui, sans-serif', zIndex: 2147483647 }}>
                <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>界面出错了 / Something went wrong</h1>
                <p style={{ margin: '0 0 16px', opacity: 0.75 }}>点「重新加载」可以恢复。如果反复出现，请把下面的内容截图发给开发者。</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <button type="button" onClick={() => window.location.reload()} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#eee', color: '#111', cursor: 'pointer' }}>重新加载</button>
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(detail); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #555', background: 'transparent', color: '#eee', cursor: 'pointer' }}>复制错误信息</button>
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, opacity: 0.8 }}>{detail}</pre>
            </div>
        );
    }
}
