import { useLayoutEffect, useState, type RefObject } from 'react';

// src/library/suites/bravais/useBravaisSeamTabsFit.ts
// 首页窄缝的页签放不放得下全名（fb2）：按测量决定，不按固定断点。
// 窄缝里「导航区」是唯一可伸缩的一段（工具格、展开按钮是自然高度）；导航区的 clientHeight 就是页头与中段此刻能用的
// 纵向空间（与页签是全名还是短形无关）。全名要多高，量的是看不见的测量副本（绝对定位、不占位、不进无障碍树）。
// ResizeObserver 只在结果变了时 setState（窗口高度、播放条安全区、账户列表开合、字体加载都会触发重量）。
// 另给出「缩成一个字也放不下、导航区在里面滚」（overflowing）：导航区底边淡出提示下面还有。
// fb2 第二轮：扩成两级。先看「带标题的全名页头」放不放得下（titled）；不行再看「不带标题的全名页头」（untitled，
// 标题视觉隐藏）；都不行才缩成一个字（short）。
// fb3：导航区分成上下两段——页头（标题、折叠、页签）贴顶，中段（扫描进度、二级切换、管理隐藏、状态、账户入口）在
// 页头与工具格之间的剩余空间里竖直居中。中段被撑到剩余高度，所以不能拿它的盒子高当内容高：量的是中段里自然高度的
// 内层（bodyRef）。二级切换也是竖排的：只有激活项显示文字，它与页签同级退让（short 时也缩成一个字），所以另有一份
// 「全名二级切换」的测量副本（fullSectionsRef；没有二级切换时是空的）。
// 放得下 = 页头副本高 + 中段内边距 + （中段内层高 − 此刻二级切换高 + 全名二级切换高）≤ 导航区高——与此刻是哪一级
// 无关，所以不会来回跳。
// fb4：账户入口挪出中段、贴在工具格上方（导航区之外的自然高度一段），平台列表往上弹出、绝对定位盖在导航区上，
// 所以列表开合不再改变任何被量的东西——页签的级别与它无关。

/** 页头的缩减级别：带标题 + 全名 → 不带标题 + 全名 → 不带标题 + 一个字（页签与激活的二级切换一起缩）。 */
export type BravaisSeamHeadLevel = 'titled' | 'untitled' | 'short';

export type BravaisSeamTabsFit = {
    level: BravaisSeamHeadLevel;
    /** 此刻的内容也放不下：导航区在里面滚。 */
    overflowing: boolean;
};

const FITS: BravaisSeamTabsFit = { level: 'titled', overflowing: false };

/** 元素的上下内边距之和。 */
const paddingBlock = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
};

export const useBravaisSeamTabsFit = ({
    navRef,
    headRef,
    middleRef,
    bodyRef,
    sectionsRef,
    titledHeadRef,
    bareHeadRef,
    fullSectionsRef,
}: {
    /** 可伸缩的导航区（flex 剩余空间，溢出时可滚）。 */
    navRef: RefObject<HTMLElement | null>;
    /** 此刻渲染的页头（标题 + 折叠 + 页签）。 */
    headRef: RefObject<HTMLElement | null>;
    /** 中段（撑满页头下面的剩余空间，内容竖直居中；上下内边距是它与页头、工具格的间距）。 */
    middleRef: RefObject<HTMLElement | null>;
    /** 中段里自然高度的内层。 */
    bodyRef: RefObject<HTMLElement | null>;
    /** 此刻渲染的二级切换（没有时为 null）。 */
    sectionsRef: RefObject<HTMLElement | null>;
    /** 带标题的全名页头的测量副本。 */
    titledHeadRef: RefObject<HTMLElement | null>;
    /** 不带标题的全名页头的测量副本。 */
    bareHeadRef: RefObject<HTMLElement | null>;
    /** 全名二级切换的测量副本（容器常在，没有二级切换时是空的）。 */
    fullSectionsRef: RefObject<HTMLElement | null>;
}): BravaisSeamTabsFit => {
    const [fit, setFit] = useState<BravaisSeamTabsFit>(FITS);

    useLayoutEffect(() => {
        const nav = navRef.current;
        const head = headRef.current;
        const middle = middleRef.current;
        const body = bodyRef.current;
        const titledHead = titledHeadRef.current;
        const bareHead = bareHeadRef.current;
        const fullSections = fullSectionsRef.current;
        if (!nav || !head || !middle || !body || !titledHead || !bareHead || !fullSections || typeof ResizeObserver === 'undefined') return undefined;
        const measure = () => {
            const available = nav.clientHeight + 0.5;
            const pad = paddingBlock(middle);
            const sections = sectionsRef.current?.offsetHeight ?? 0;
            // 中段换成全名二级切换后的高。
            const fullBody = body.offsetHeight - sections + fullSections.offsetHeight;
            const level: BravaisSeamHeadLevel = titledHead.offsetHeight + pad + fullBody <= available
                ? 'titled'
                : bareHead.offsetHeight + pad + fullBody <= available ? 'untitled' : 'short';
            const overflowing = head.offsetHeight + pad + body.offsetHeight > available;
            setFit(current => (current.level === level && current.overflowing === overflowing ? current : { level, overflowing }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(nav);
        observer.observe(head);
        observer.observe(body);
        observer.observe(titledHead);
        observer.observe(bareHead);
        observer.observe(fullSections);
        return () => observer.disconnect();
    }, [bareHeadRef, bodyRef, fullSectionsRef, headRef, middleRef, navRef, sectionsRef, titledHeadRef]);

    return fit;
};
