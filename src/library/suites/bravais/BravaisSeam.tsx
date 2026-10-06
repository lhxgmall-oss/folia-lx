import React, { type RefObject } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import type { BravaisSeamContentVariant } from './bravaisSeamTarget';
import type { BravaisPanelActions } from './BravaisListPanel';
import { setBravaisFilterHost } from './bravaisUiStore';
import BravaisSeamContent from './BravaisSeamContent';
import { selectBravaisAccountKeyboardWindow, useBravaisAccountStore } from './bravaisAccountStore';

// src/library/suites/bravais/BravaisSeam.tsx
// 缝与它的边缘标签。缝的屏幕位置、宽度、内容透明度、标签显隐都由 stage 每帧直接写（bravaisFrame），这里只在
// 渲染的内容换了时渲染。内容层按「此刻渲染的这一套」的宽度排版、居中，被变窄的缝裁掉（翻转不重排）；底部内边距
// 绑在播放条安全区的 MotionValue 上。标签：自动出屏收起时点它在当前视口裂开新缝，手动折叠时点它恢复。
// B10：账户的登录态 / 确认态显示着（且首页外壳可交互）时缝挂 data-folia-keyboard-window——墙、全局热键与命令面板的
// 打字即筛选都让路，不带修饰键的按键归 account surface 的独占监听（Esc 先撤销表单态）。

type BravaisSeamProps = {
    seamRef: RefObject<HTMLDivElement | null>;
    contentRef: RefObject<HTMLDivElement | null>;
    tabRef: RefObject<HTMLButtonElement | null>;
    variant: BravaisSeamContentVariant;
    /** 此刻渲染的那一套内容的排版宽度（翻转不重排）。 */
    contentWidth: number;
    layer: BravaisLayer | null;
    /** 当前层（标签上的标题跟着它，不等内容翻转）。 */
    currentLayer: BravaisLayer | null;
    level: BravaisSeamLevel;
    depth: number;
    bottomPx: MotionValue<number>;
    setLevel: (level: BravaisSeamLevel) => void;
    onTab: () => void;
    /** B7：完整信息条的「列表」与列表面板的动作。 */
    openList?: () => void;
    panel?: BravaisPanelActions;
};

const BravaisSeam: React.FC<BravaisSeamProps> = ({
    seamRef,
    contentRef,
    tabRef,
    variant,
    contentWidth,
    layer,
    currentLayer,
    level,
    depth,
    bottomPx,
    setLevel,
    onTab,
    openList,
    panel,
}) => {
    const { t } = useTranslation();
    const width = contentWidth;
    const tabLabel = currentLayer?.seam.title ?? '';
    const keyboardWindow = useBravaisAccountStore(selectBravaisAccountKeyboardWindow);
    return (
        <>
            <div
                ref={seamRef}
                className="bravais-seam"
                data-bravais-seam={variant}
                data-bravais-seam-level={level}
                data-folia-keyboard-window={keyboardWindow ? 'true' : undefined}
                aria-label={t('libraryBravais.seamLabel')}
                role="region"
            >
                <div ref={contentRef} className="bravais-seam-content" style={{ width, marginLeft: -width / 2 }}>
                    <motion.div className="bravais-seam-body" style={{ paddingBottom: bottomPx }}>
                        <BravaisSeamContent variant={variant} layer={layer} depth={depth} actions={{ setLevel, openList, panel }} />
                    </motion.div>
                </div>
                {/* B7：命令面板的内联过滤框画在这里（不随内容翻转；位置对着完整信息条 / 面板里留出的过滤位）。 */}
                <div
                    ref={setBravaisFilterHost}
                    className="bravais-seam-filter-host"
                    data-bravais-filter-host={variant === 'panel' ? 'panel' : 'strip'}
                    style={{ width: Math.max(0, width - 44), marginLeft: -Math.max(0, width - 44) / 2 }}
                />
            </div>
            <button
                ref={tabRef}
                type="button"
                className="bravais-seam-tab"
                data-bravais-seam-tab={level === 'hidden' ? 'hidden' : 'collapsed'}
                style={{ display: 'none' }}
                onClick={onTab}
                title={level === 'hidden' ? t('libraryBravais.seamRestore') : t('libraryBravais.seamReopenHere')}
            >
                {tabLabel}
            </button>
        </>
    );
};

export default BravaisSeam;
