import React, { type RefObject } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisSeamLevel, BravaisSeamVariant } from './bravaisSeamLevel';
import { seamVariantWidth } from './bravaisSeamLevel';
import BravaisSeamContent from './BravaisSeamContent';

// src/library/suites/bravais/BravaisSeam.tsx
// 缝与它的边缘标签。缝的屏幕位置、宽度、内容透明度、标签显隐都由 stage 每帧直接写（bravaisFrame），这里只在
// 渲染的内容换了时渲染。内容层按「此刻渲染的这一套」的宽度排版、居中，被变窄的缝裁掉（翻转不重排）；底部内边距
// 绑在播放条安全区的 MotionValue 上。标签：自动出屏收起时点它在当前视口裂开新缝，手动折叠时点它恢复。

type BravaisSeamProps = {
    seamRef: RefObject<HTMLDivElement | null>;
    contentRef: RefObject<HTMLDivElement | null>;
    tabRef: RefObject<HTMLButtonElement | null>;
    variant: BravaisSeamVariant;
    layer: BravaisLayer | null;
    /** 当前层（标签上的标题跟着它，不等内容翻转）。 */
    currentLayer: BravaisLayer | null;
    level: BravaisSeamLevel;
    depth: number;
    bottomPx: MotionValue<number>;
    setLevel: (level: BravaisSeamLevel) => void;
    onTab: () => void;
};

const BravaisSeam: React.FC<BravaisSeamProps> = ({
    seamRef,
    contentRef,
    tabRef,
    variant,
    layer,
    currentLayer,
    level,
    depth,
    bottomPx,
    setLevel,
    onTab,
}) => {
    const { t } = useTranslation();
    const width = seamVariantWidth(variant);
    const tabLabel = currentLayer?.seam.title ?? '';
    return (
        <>
            <div
                ref={seamRef}
                className="bravais-seam"
                data-bravais-seam={variant}
                data-bravais-seam-level={level}
                aria-label={t('libraryBravais.seamLabel')}
                role="region"
            >
                <div ref={contentRef} className="bravais-seam-content" style={{ width, marginLeft: -width / 2 }}>
                    <motion.div className="bravais-seam-body" style={{ paddingBottom: bottomPx }}>
                        <BravaisSeamContent variant={variant} layer={layer} depth={depth} actions={{ setLevel }} />
                    </motion.div>
                </div>
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
