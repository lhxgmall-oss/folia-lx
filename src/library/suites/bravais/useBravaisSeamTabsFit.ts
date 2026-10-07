import { useLayoutEffect, useState, type RefObject } from 'react';

// src/library/suites/bravais/useBravaisSeamTabsFit.ts
// 首页窄缝的页签放不放得下全名（fb2）：按测量决定，不按固定断点。
// 窄缝里「导航区」（竖排标题 + 页签 + 二级切换 + 管理隐藏）是唯一可伸缩的一段，其余（折叠、账户位、状态、工具格）
// 都是自然高度；导航区的 clientHeight 就是页签此刻能用的纵向空间（与页签是全名还是短形无关）。
// 全名要多高，量的是一份看不见的「全名页头」副本（绝对定位、不占位、不进无障碍树）。
// 放得下 = 导航区内容高 − 此刻页头高 + 全名页头高 ≤ 导航区高——与此刻是哪一种无关，所以不会来回跳。
// ResizeObserver 只在结果变了时 setState（窗口高度、播放条安全区、账户列表开合、字体加载都会触发重量）。
// 另给出「缩成一个字也放不下、导航区在里面滚」（overflowing）：导航区底边淡出提示下面还有。

export type BravaisSeamTabsFit = {
    /** 全名放不下：页签缩成一个字。 */
    short: boolean;
    /** 此刻的内容也放不下：导航区在里面滚。 */
    overflowing: boolean;
};

const FITS: BravaisSeamTabsFit = { short: false, overflowing: false };

export const useBravaisSeamTabsFit = ({
    navRef,
    contentRef,
    headRef,
    fullHeadRef,
}: {
    /** 可伸缩的导航区（flex 剩余空间，溢出时可滚）。 */
    navRef: RefObject<HTMLElement | null>;
    /** 导航区里的内容（自然高度）。 */
    contentRef: RefObject<HTMLElement | null>;
    /** 此刻渲染的页头（标题 + 页签）。 */
    headRef: RefObject<HTMLElement | null>;
    /** 全名页头的测量副本。 */
    fullHeadRef: RefObject<HTMLElement | null>;
}): BravaisSeamTabsFit => {
    const [fit, setFit] = useState<BravaisSeamTabsFit>(FITS);

    useLayoutEffect(() => {
        const nav = navRef.current;
        const content = contentRef.current;
        const head = headRef.current;
        const fullHead = fullHeadRef.current;
        if (!nav || !content || !head || !fullHead || typeof ResizeObserver === 'undefined') return undefined;
        const measure = () => {
            const available = nav.clientHeight + 0.5;
            const short = content.offsetHeight - head.offsetHeight + fullHead.offsetHeight > available;
            const overflowing = content.offsetHeight > available;
            setFit(current => (current.short === short && current.overflowing === overflowing ? current : { short, overflowing }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(nav);
        observer.observe(content);
        observer.observe(fullHead);
        return () => observer.disconnect();
    }, [contentRef, fullHeadRef, headRef, navRef]);

    return fit;
};
