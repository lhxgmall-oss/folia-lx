import { useLayoutEffect, useState, type RefObject } from 'react';

// src/library/suites/bravais/useBravaisSeamTabsFit.ts
// 首页窄缝的页签放不放得下全名（fb2）：按测量决定，不按固定断点。
// 窄缝里「导航区」（竖排标题 + 页签 + 二级切换 + 管理隐藏）是唯一可伸缩的一段，其余（折叠、账户位、状态、工具格）
// 都是自然高度；导航区的 clientHeight 就是页签此刻能用的纵向空间（与页签是全名还是短形无关）。
// 全名要多高，量的是一份看不见的「全名页头」副本（绝对定位、不占位、不进无障碍树）。
// 放得下 = 导航区内容高 − 此刻页头高 + 全名页头高 ≤ 导航区高——与此刻是哪一种无关，所以不会来回跳。
// ResizeObserver 只在结果变了时 setState（窗口高度、播放条安全区、账户列表开合、字体加载都会触发重量）。
// 另给出「缩成一个字也放不下、导航区在里面滚」（overflowing）：导航区底边淡出提示下面还有。
// fb2 第二轮：扩成两级。先看「带标题的全名页头」放不放得下（titled）；不行再看「不带标题的全名页头」（untitled，
// 标题视觉隐藏）；都不行才缩成一个字（short）。两份副本各量各的，判定式同上，所以同样不会来回跳。

/** 页头的缩减级别：带标题 + 全名 → 不带标题 + 全名 → 不带标题 + 一个字。 */
export type BravaisSeamHeadLevel = 'titled' | 'untitled' | 'short';

export type BravaisSeamTabsFit = {
    level: BravaisSeamHeadLevel;
    /** 此刻的内容也放不下：导航区在里面滚。 */
    overflowing: boolean;
};

const FITS: BravaisSeamTabsFit = { level: 'titled', overflowing: false };

export const useBravaisSeamTabsFit = ({
    navRef,
    contentRef,
    headRef,
    titledHeadRef,
    bareHeadRef,
}: {
    /** 可伸缩的导航区（flex 剩余空间，溢出时可滚）。 */
    navRef: RefObject<HTMLElement | null>;
    /** 导航区里的内容（自然高度）。 */
    contentRef: RefObject<HTMLElement | null>;
    /** 此刻渲染的页头（标题 + 页签）。 */
    headRef: RefObject<HTMLElement | null>;
    /** 带标题的全名页头的测量副本。 */
    titledHeadRef: RefObject<HTMLElement | null>;
    /** 不带标题的全名页头的测量副本。 */
    bareHeadRef: RefObject<HTMLElement | null>;
}): BravaisSeamTabsFit => {
    const [fit, setFit] = useState<BravaisSeamTabsFit>(FITS);

    useLayoutEffect(() => {
        const nav = navRef.current;
        const content = contentRef.current;
        const head = headRef.current;
        const titledHead = titledHeadRef.current;
        const bareHead = bareHeadRef.current;
        if (!nav || !content || !head || !titledHead || !bareHead || typeof ResizeObserver === 'undefined') return undefined;
        const measure = () => {
            const available = nav.clientHeight + 0.5;
            const rest = content.offsetHeight - head.offsetHeight;
            const level: BravaisSeamHeadLevel = rest + titledHead.offsetHeight <= available
                ? 'titled'
                : rest + bareHead.offsetHeight <= available ? 'untitled' : 'short';
            const overflowing = content.offsetHeight > available;
            setFit(current => (current.level === level && current.overflowing === overflowing ? current : { level, overflowing }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(nav);
        observer.observe(content);
        observer.observe(titledHead);
        observer.observe(bareHead);
        return () => observer.disconnect();
    }, [bareHeadRef, contentRef, headRef, navRef, titledHeadRef]);

    return fit;
};
