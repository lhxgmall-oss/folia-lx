import React, { type MouseEvent } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisItem } from './bravaisLayer';

// src/library/suites/bravais/BravaisTileMarks.tsx
// 首页磁贴右上角的两种记号（B9，设计稿 §10.5）：
// - 眼睛按钮：只有歌单类卡片有（core 判定可隐藏），平时悬停才出现，管理隐藏视图里常驻（stage 根节点的
//   is-managing-hidden）；点它切换隐藏（directory-toggle-hidden），不冒泡到磁贴的点击。
// - 勾：批量模式里选中的卡片（未选中的由磁贴本身灰度 + 半透明）。

type BravaisTileMarksProps = {
    item: BravaisItem;
    onToggleHidden?: () => void;
};

const BravaisTileMarks: React.FC<BravaisTileMarksProps> = ({ item, onToggleHidden }) => {
    const { t } = useTranslation();
    const hidden = Boolean(item.hidden);
    const label = t(hidden ? 'libraryBravaisHome.unhide' : 'libraryBravaisHome.hide');
    const toggle = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onToggleHidden?.();
    };
    return (
        <>
            {item.hideable && onToggleHidden && (
                <button
                    type="button"
                    className={`bravais-tile-eye${hidden ? ' is-hidden' : ''}`}
                    data-bravais-action="toggle-hidden"
                    aria-pressed={hidden}
                    aria-label={label}
                    title={label}
                    onClick={toggle}
                >
                    {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </button>
            )}
            {item.selected && (
                <span className="bravais-tile-check" data-bravais-selected aria-hidden>
                    <Check />
                </span>
            )}
        </>
    );
};

export default BravaisTileMarks;
