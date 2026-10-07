import React, { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
    Disc3,
    EyeOff,
    FolderTree,
    ListMusic,
    MonitorPlay,
    MoreHorizontal,
    RefreshCw,
    Search,
    Settings,
} from 'lucide-react';
import type { BravaisHomeSeam, BravaisHomeTool, BravaisHomeToolId } from './bravaisHomeModels';

// src/library/suites/bravais/BravaisSeamHomeTools.tsx
// 首页窄缝底部的工具格（fb2 重排）：按重要性分两组。
// - 常驻的图标格（两列 40px，书脊上一列 36px）：搜索、这个页签自己的入口（目录、管理隐藏、Navidrome 刷新）与
//   「回到播放页」——离开书库最常用的那一个。
// - 「⋯」溢出菜单：本页签的「更多」（本地的导入文件夹 / 刷新 / 导入歌单文件）在前，app 级的次要入口（打开播放队列、
//   舞台播放器、设置）在后，中间一道分隔线。菜单从工具格上方弹出、盖在导航区上，不推挤别的内容；Esc 或点别处收起。
// 书脊（64px）上放不下文字菜单：只留常驻的图标，「⋯」里的东西由底部的「展开」进窄缝再用。
// 各按钮的 data-bravais-seam-action 仍是工具 id / 菜单项 id（用例与探针按它找）。

const TOOL_ICONS: Record<BravaisHomeToolId, React.ComponentType<{ 'aria-hidden'?: boolean; className?: string }>> = {
    search: Search,
    directory: FolderTree,
    'manage-hidden': EyeOff,
    'refresh-navidrome': RefreshCw,
    queue: ListMusic,
    player: Disc3,
    stage: MonitorPlay,
    settings: Settings,
};

/** 收进「⋯」的次要入口（app 级，不常用）。 */
const OVERFLOW_TOOLS: ReadonlySet<BravaisHomeToolId> = new Set(['queue', 'stage', 'settings']);

/** 把工具分成常驻的与收进「⋯」的（保持原顺序）。 */
export const splitHomeTools = (tools: readonly BravaisHomeTool[]) => ({
    primary: tools.filter(tool => !OVERFLOW_TOOLS.has(tool.id)),
    overflow: tools.filter(tool => OVERFLOW_TOOLS.has(tool.id)),
});

const BravaisSeamHomeTools: React.FC<{ home: BravaisHomeSeam; compact: boolean }> = ({ home, compact }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const dockRef = useRef<HTMLDivElement>(null);
    const { primary, overflow } = splitHomeTools(home.tools);
    const local = home.menu ?? [];
    const hasMenu = !compact && (local.length > 0 || overflow.length > 0);
    const open = menuOpen && hasMenu;

    // 菜单开着时点别处收起（缝里、墙上都算）。
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && dockRef.current?.contains(event.target)) return;
            setMenuOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [open]);

    // 菜单开着时 Esc 先收起它（preventDefault 让墙的 Esc 阶梯跳过这次按键）。
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        setMenuOpen(false);
    };

    const runItem = (run: () => void) => {
        setMenuOpen(false);
        run();
    };

    return (
        <div ref={dockRef} className="bravais-seam-dock" onKeyDown={onKeyDown}>
            {open && (
                <div className="bravais-seam-menu is-home" role="menu" aria-label={home.menuLabel} data-bravais-seam-menu>
                    {local.map(item => (
                        <button key={item.id} type="button" role="menuitem" disabled={item.disabled} data-bravais-seam-action={item.id}
                            className={item.danger ? 'is-danger' : undefined} onClick={() => runItem(item.run)}>
                            {item.label}
                        </button>
                    ))}
                    {local.length > 0 && overflow.length > 0 && <div className="bravais-seam-menu-rule" role="separator" />}
                    {overflow.map((tool) => {
                        const Icon = TOOL_ICONS[tool.id];
                        return (
                            <button key={tool.id} type="button" role="menuitem" disabled={tool.disabled} data-bravais-seam-action={tool.id}
                                className="is-tool" onClick={() => runItem(tool.run)}>
                                <Icon aria-hidden />{tool.label}
                            </button>
                        );
                    })}
                </div>
            )}
            <div className="bravais-seam-tools">
                {primary.map((tool) => {
                    const Icon = TOOL_ICONS[tool.id];
                    return (
                        <button
                            key={tool.id}
                            type="button"
                            className={`bravais-seam-icon${tool.pressed ? ' is-pressed' : ''}`}
                            data-bravais-seam-action={tool.id}
                            aria-label={tool.label}
                            aria-pressed={tool.pressed}
                            title={tool.label}
                            disabled={tool.disabled}
                            onClick={tool.run}
                        >
                            <Icon aria-hidden className={tool.busy ? 'animate-spin' : undefined} />
                        </button>
                    );
                })}
                {hasMenu && (
                    <button type="button" className={`bravais-seam-icon${open ? ' is-pressed' : ''}`} data-bravais-seam-action="more"
                        aria-haspopup="menu" aria-expanded={open} aria-label={home.menuLabel} title={home.menuLabel}
                        onClick={() => setMenuOpen(value => !value)}>
                        <MoreHorizontal aria-hidden />
                    </button>
                )}
            </div>
        </div>
    );
};

export default BravaisSeamHomeTools;
