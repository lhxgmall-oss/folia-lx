import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import QuickEffectPicker from '../QuickEffectPicker';
import type { PictureState } from '../../modal/settings/kit';
import { kitTransition, useKitReducedMotion } from '../../modal/settings/kit/motion';

// src/components/panelTab/controls/ModeStepperRow.tsx
// 「‹ 字形 说明/当前模式⌄ ›」一行，参数放在下面一行、和字形块左对齐。箭头直接换到相邻模式，
// 点中间那一块才展开全部模式的小图；下拉箭头跟在模式名后面，右端只有步进箭头，两种箭头不挨在一起。
// 行里只画当前模式的字形，不画小图：小图要把样式在窗口大小的舞台上再画一份，只在选择器开着时才值得。
// 参数行横向能放下好几枚，放不下就换行；没有参数的模式也留着这一行的高度，模式切换时面板不会跳变。
// 切换时字形和模式名按步进方向滑入。这里刻意不做退场动画：连点箭头时退场元素会和新元素抢布局，
// 只让新内容重新挂载入场，快速连点也不会抖。从小图里直接选则没有方向，退化成淡入。

const STEP_ENTER_OFFSET_PX = 10;
/**
 * 参数行左缩进，对齐字形块的左边：步进箭头 28 + 间距 4 + 按钮左内边距 6。
 * 这几个尺寸在下面的 className 里，改其中一个要一起改这里。
 */
const PARAMS_INSET_PX = 38;

interface ModeStepperRowProps<Value extends string> {
    value: Value;
    options: { value: Value; label: string; }[];
    onSelect: (value: Value) => void;
    onStep: (direction: -1 | 1) => void;
    /** Draws a mode's glyph, the row's own sign of the chosen mode. */
    renderGlyph: (value: Value) => React.ReactNode;
    /** Draws a mode's picture in the open picker; the same function each time (PictureGrid). */
    renderPicture: (value: Value, state: PictureState) => React.ReactNode;
    /** What the row chooses: the small line over the mode's name, and the row's name for assistive tech. */
    caption: string;
    /** 该模式专属的参数控件，放在模式名下面一行；没有时这一行照样占位。 */
    trailing?: React.ReactNode;
    moreLabel: string;
    onOpenMore: () => void;
    /** Whether the row's picker is open; the section keeps it, so one clock serves both rows' pictures. */
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ModeStepperRow = <Value extends string>({
    value,
    options,
    onSelect,
    onStep,
    renderGlyph,
    renderPicture,
    caption,
    trailing,
    moreLabel,
    onOpenMore,
    open,
    onOpenChange,
}: ModeStepperRowProps<Value>) => {
    const canStep = options.length > 1;
    const reduced = useKitReducedMotion();
    const triggerRef = useRef<HTMLButtonElement>(null);
    // 0 表示不是箭头触发的（从小图里选或外部改），此时只淡入不滑动。
    const [stepDirection, setStepDirection] = useState<-1 | 0 | 1>(0);
    const selectedLabel = options.find(option => option.value === value)?.label ?? value;

    const enterOffset = reduced ? 0 : stepDirection * STEP_ENTER_OFFSET_PX;

    const handleSelect = (nextValue: Value) => {
        setStepDirection(0);
        onSelect(nextValue);
    };

    const renderStepButton = (direction: -1 | 1) => (
        <motion.button
            type="button"
            onClick={() => {
                setStepDirection(direction);
                onStep(direction);
            }}
            disabled={!canStep}
            whileTap={canStep && !reduced ? { scale: 0.82, x: direction * 2 } : undefined}
            transition={kitTransition('fast', reduced)}
            className="st-t-fast flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[color:var(--st-t3)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`${caption} ${direction === -1 ? '−' : '+'}`}
        >
            {direction === -1 ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </motion.button>
    );

    return (
        <div className="pb-1.5">
            <div className="flex items-center gap-1">
                {renderStepButton(-1)}

                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => onOpenChange(!open)}
                    className={`st-t-fast flex h-12 min-w-0 flex-1 items-center rounded-[10px] pl-1.5 pr-2 text-left transition-colors hover:bg-[var(--st-fill)] ${open ? 'bg-[var(--st-fill)]' : ''}`}
                    aria-label={caption}
                    aria-haspopup="true"
                    aria-expanded={open}
                >
                    <motion.span
                        key={value}
                        initial={{ opacity: 0, x: enterOffset }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={kitTransition('move', reduced)}
                        className="flex min-w-0 flex-1 items-center gap-2.5"
                    >
                        <span className="grid h-[30px] w-12 shrink-0 place-items-center rounded-md bg-[var(--st-fill)] text-[color:var(--st-t2)] shadow-[inset_0_0_0_1px_var(--st-line)]">
                            {renderGlyph(value)}
                        </span>
                        <span className="min-w-0">
                            <span className="block text-[11.5px] leading-[15px] text-[color:var(--st-t3)]">{caption}</span>
                            {/* 下拉箭头跟着模式名走：名字太长时名字截断，箭头留着。 */}
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="truncate text-sm leading-[19px]">{selectedLabel}</span>
                                <ChevronDown size={13} className={`st-t-move shrink-0 text-[color:var(--st-t3)] transition-transform ${open ? 'rotate-180' : ''}`} />
                            </span>
                        </span>
                    </motion.span>
                </button>

                {renderStepButton(1)}
            </div>

            <motion.div
                key={`${value}-trailing`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={kitTransition('move', reduced)}
                className="-mt-0.5 flex min-h-7 flex-wrap items-center gap-1.5"
                style={{ marginLeft: PARAMS_INSET_PX }}
            >
                {trailing}
            </motion.div>

            <QuickEffectPicker<Value>
                anchorRef={triggerRef}
                open={open}
                onClose={() => onOpenChange(false)}
                value={value}
                options={options}
                picture={renderPicture}
                onChange={handleSelect}
                label={caption}
                moreLabel={moreLabel}
                onOpenMore={onOpenMore}
            />
        </div>
    );
};

export default ModeStepperRow;
