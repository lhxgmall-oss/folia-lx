import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { CircleHelp, Command, Layers3, Settings2, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLatticeSettingsStore } from '../../stores/useLatticeSettingsStore';
import { openCommandPalette } from '../../stores/useAppViewStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePlayerBottomBarBottomPx } from '../../hooks/usePlayerBottomBarBottomPx';
import { SlideActionButton } from '../shared/SlideActionButton';
import './WallToolsButton.css';

// src/components/wall/WallToolsButton.tsx
// 海报墙右下角的工具按钮（Lattice 与 bravais 共用）：点按打开锚定的玻璃面板，向左滑打开命令面板。
// 面板里与内容无关的部分在这里：底距（避开播放胶囊）、点外部 / Esc 关闭、海报叠色开关、开灯 / 关灯、帮助的展开；
// 上面那几行条目与帮助的内容由使用方传入（Lattice：聚焦当前歌曲、切歌自动聚焦、队列命令；bravais：定位正在播放、透光）。
// 叠色与灯光读写同一个 useLatticeSettingsStore——一套墙面外观设置同时作用于 Lattice 与资料库墙。
// 从 LatticeFocusButton 抽出（实测反馈 1），Lattice 的 DOM 与样式不变，只多了叠色那一行。
// 翻牌交接（设计稿 §7「进入队列」）：App 在首页层与 Lattice 之上挂一个 WallToolsDock，两面墙的按钮都「认领」进同一个
// dock、由它画出唯一的一颗——进 / 出 Lattice 时按钮节点不重建、原地不动，只换条目与帮助。没有 dock 的地方（组件探针、
// Ponder 的合成界面）照旧就地渲染。

/** 面板里的一行：动作（点了默认收起面板）或开关（menuitemcheckbox，点了不收起）。 */
export type WallToolsEntry =
    | {
        kind: 'action';
        id: string;
        icon: LucideIcon;
        label: string;
        /** 右侧的按键提示（`: + C` 这类）。 */
        kbd?: string;
        /** 按键提示不进可访问名（Lattice 的「聚焦当前歌曲」那一行如此）。 */
        kbdHidden?: boolean;
        /** 右侧的当前值（不是按键，不画框）。 */
        value?: string;
        disabled?: boolean;
        /** 点了不收起面板（循环切换一类的条目，让人看到新值）。 */
        keepOpen?: boolean;
        onSelect: () => void;
    }
    | {
        kind: 'toggle';
        id: string;
        icon: LucideIcon;
        label: string;
        checked: boolean;
        onToggle: (next: boolean) => void;
    };

export type WallToolsButtonProps = {
    /** 面板与帮助的 id 前缀（`<前缀>-panel` / `<前缀>-help`）。 */
    idPrefix: string;
    /** 按钮的 title 与面板的可访问名。 */
    label: string;
    isDaylight: boolean;
    /** 上面那几行；给函数时只在面板打开着渲染时求值（条目的可用性随时变，例如正在播放的那首在不在墙上）。 */
    entries: readonly WallToolsEntry[] | (() => readonly WallToolsEntry[]);
    /** 帮助列表的内容（若干 `<li>`）。 */
    help: ReactNode;
    /**
     * 在 dock 里时要不要认领（缺省要）：墙此刻不显示（首页层被盖住、当前层不归这面墙）时不认领，dock 里就没有它这一份。
     * 不在 dock 里（就地渲染）时不看它。
     */
    claimed?: boolean;
};

/** dock 的登记处（WallToolsDock 提供）：按钮把自己的 props 认领进去，dock 画最后认领的那一份。 */
export type WallToolsDockRegistry = {
    claim: (id: string, props: WallToolsButtonProps) => void;
    release: (id: string) => void;
};

export const WallToolsDockContext = createContext<WallToolsDockRegistry | null>(null);

/** 一行条目。 */
function WallToolsRow({ entry, onDone }: { entry: WallToolsEntry; onDone: () => void }) {
    const Icon = entry.icon;
    if (entry.kind === 'toggle') {
        return (
            <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={entry.checked}
                className="lattice-tools-action"
                onClick={() => entry.onToggle(!entry.checked)}
            >
                <Icon aria-hidden="true" />
                <span>{entry.label}</span>
                <span className={`lattice-tools-toggle ${entry.checked ? 'is-on' : ''}`} aria-hidden="true">
                    <span />
                </span>
            </button>
        );
    }
    return (
        <button
            type="button"
            role="menuitem"
            className="lattice-tools-action"
            onClick={() => {
                entry.onSelect();
                if (!entry.keepOpen) onDone();
            }}
            disabled={entry.disabled}
        >
            <Icon aria-hidden="true" />
            <span>{entry.label}</span>
            {entry.value !== undefined && <span className="lattice-tools-value">{entry.value}</span>}
            {entry.kbd !== undefined && (entry.kbdHidden ? <kbd aria-hidden="true">{entry.kbd}</kbd> : <kbd>{entry.kbd}</kbd>)}
        </button>
    );
}

/** 按钮与面板本身（dock 里与就地渲染都画这一份）。 */
export function WallToolsSurface({ idPrefix, label, isDaylight, entries, help }: WallToolsButtonProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const lightsOn = useLatticeSettingsStore(state => state.latticeLightsOn);
    const handleToggleLatticeLights = useLatticeSettingsStore(state => state.handleToggleLatticeLights);
    const tintEnabled = useLatticeSettingsStore(state => state.latticePosterTintEnabled);
    const handleToggleLatticePosterTint = useLatticeSettingsStore(state => state.handleToggleLatticePosterTint);
    const isWideLayout = useMediaQuery('(min-width: 640px)');
    const bottomPx = usePlayerBottomBarBottomPx(isWideLayout ? 24 : 16);

    const close = () => {
        setIsOpen(false);
        setShowHelp(false);
    };

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
                setIsOpen(false);
                setShowHelp(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                // 这次 Esc 只用来收起面板：墙自己的 Esc 阶梯（bravais 在 window 上听、认 defaultPrevented）不再处理它。
                event.preventDefault();
                setIsOpen(false);
                setShowHelp(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const handleOpenCommandPalette = () => {
        close();
        openCommandPalette();
    };

    const panelId = `${idPrefix}-panel`;
    const helpId = `${idPrefix}-help`;
    const rows = isOpen ? (typeof entries === 'function' ? entries() : entries) : [];
    // 叠色开关两边都有（颜色与强度的细调仍在设置页与命令面板）。
    const tintRow: WallToolsEntry = {
        kind: 'toggle',
        id: 'poster-tint',
        icon: Layers3,
        label: t('options.latticePosterTint'),
        checked: tintEnabled,
        onToggle: handleToggleLatticePosterTint,
    };

    return (
        <motion.div ref={rootRef} style={{ bottom: bottomPx }} className={`lattice-tools group ${isDaylight ? 'is-daylight' : ''}`}>
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        id={panelId}
                        role="menu"
                        aria-label={label}
                        initial={{ opacity: 0, scale: 0.9, originX: 1, originY: 1 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="lattice-tools-panel"
                    >
                        {rows.map(entry => <WallToolsRow key={entry.id} entry={entry} onDone={close} />)}
                        <WallToolsRow entry={tintRow} onDone={close} />
                        <div className="lattice-tools-help-section" role="none">
                            <button
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={lightsOn}
                                aria-label={t('home.latticeLights')}
                                className="lattice-tools-lights-toggle"
                                onClick={() => handleToggleLatticeLights(!lightsOn)}
                            >
                                <span className={lightsOn ? 'is-active' : ''}>{t('home.latticeLightsOn')}</span>
                                <span className={lightsOn ? '' : 'is-active'}>{t('home.latticeLightsOff')}</span>
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className="lattice-tools-action lattice-tools-help-trigger"
                                aria-label={t('home.latticeHelp')}
                                title={t('home.latticeHelp')}
                                aria-expanded={showHelp}
                                aria-controls={helpId}
                                onClick={() => setShowHelp(visible => !visible)}
                            >
                                <CircleHelp aria-hidden="true" />
                            </button>
                            <AnimatePresence initial={false}>
                                {showHelp && (
                                    <motion.div
                                        id={helpId}
                                        role="note"
                                        className="lattice-tools-help"
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.18, ease: 'easeOut' }}
                                    >
                                        <ul>{help}</ul>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <SlideActionButton
                icon={isOpen ? X : Settings2}
                title={label}
                onActivate={() => setIsOpen(open => {
                    if (open) setShowHelp(false);
                    return !open;
                })}
                slideIcon={Command}
                slideTitle={t('options.gridSlideTargetCommandPalette')}
                onSlide={handleOpenCommandPalette}
                isDaylight={isDaylight}
                accentColor="var(--text-accent)"
            />
        </motion.div>
    );
}

/**
 * 墙用的入口：外面有 dock 时把 props 认领进去、自己不画（dock 画唯一的一颗）；没有 dock 时就地渲染。
 * 在 AnimatePresence 里退场途中（Lattice 整层淡出）就撤回认领，免得按钮在已经离开的墙上多停一会儿。
 */
export default function WallToolsButton(props: WallToolsButtonProps) {
    const dock = useContext(WallToolsDockContext);
    const id = useId();
    const present = useIsPresent();
    const claimed = (props.claimed ?? true) && present;
    // 每次提交都把最新的 props 交给 dock（条目、帮助随墙的状态变）；不认领时撤回。
    useLayoutEffect(() => {
        if (!dock) return;
        if (claimed) dock.claim(id, props);
        else dock.release(id);
    });
    useLayoutEffect(() => (dock ? () => dock.release(id) : undefined), [dock, id]);
    return dock ? null : <WallToolsSurface {...props} />;
}
