import type { OverlayWordNodes } from './cadenzaTypes';

// src/components/visualizer/cadenza/cadenzaOverlayNodes.ts
// 每个词落点对应的 DOM 叠层节点（外框 / 内框 / 正文 / 逐字 glow），由 RAF 循环直接写样式。

export const createOverlayWordNodes = (): OverlayWordNodes => {
    const outer = document.createElement('div');
    outer.className = 'absolute left-0 top-0';
    outer.setAttribute('aria-hidden', 'true');

    const inner = document.createElement('div');
    inner.className = 'whitespace-nowrap';
    inner.style.lineHeight = '1';
    inner.style.display = 'inline-block';
    inner.style.position = 'relative';

    const body = document.createElement('span');
    body.style.lineHeight = '1';
    body.style.display = 'block';
    body.style.position = 'relative';
    body.style.zIndex = '1';
    body.style.whiteSpace = 'pre';

    const glow = document.createElement('span');
    glow.style.color = 'transparent';
    glow.style.lineHeight = '1';
    glow.style.display = 'block';
    glow.style.position = 'absolute';
    glow.style.inset = '0';
    glow.style.zIndex = '0';
    glow.style.pointerEvents = 'none';
    glow.style.whiteSpace = 'pre';

    inner.appendChild(body);
    inner.appendChild(glow);
    outer.appendChild(inner);

    return {
        outer,
        inner,
        body,
        glow,
        glyphSpans: [],
        glyphSignature: '',
    };
};

export const syncOverlayGlyphSpans = (nodes: OverlayWordNodes, texts: string[]) => {
    const glyphSignature = texts.join('\u0001');
    if (nodes.glyphSignature === glyphSignature) {
        return;
    }

    nodes.glow.replaceChildren();
    nodes.glyphSpans = texts.map(text => {
        const span = document.createElement('span');
        span.textContent = text;
        span.style.color = 'transparent';
        span.style.lineHeight = '1';
        nodes.glow.appendChild(span);
        return span;
    });
    nodes.glyphSignature = glyphSignature;
};

export const clearOverlayWordNodes = (overlayNodes: Map<string, OverlayWordNodes>) => {
    overlayNodes.forEach(nodes => {
        nodes.outer.remove();
    });
    overlayNodes.clear();
};
