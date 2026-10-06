import React, { memo, useLayoutEffect, useRef, useState, type MouseEvent, type MutableRefObject } from 'react';
import { WallTitle } from '../../../components/wall/WallTitle';
import { useWallPosterArtwork } from '../../../components/wall/useWallPosterArtwork';
import { countRender } from '../../../dev/renderCount';
import {
    BRAVAIS_METRICS,
    BRAVAIS_SEE_THROUGH_STRIP_ARTWORK_PX,
    BRAVAIS_TILE_FLIP_IN_MS,
    BRAVAIS_TILE_FLIP_OUT_MS,
} from './bravaisConstants';
import { resolveTileTransition, type BravaisFlipStep } from './bravaisDisplay';
import type { BravaisItem } from './bravaisLayer';
import { bravaisFaceKey, type BravaisTileKind } from './bravaisLook';
import BravaisFocusCardBody, { type BravaisFocusCardActions } from './BravaisFocusCardBody';

// src/library/suites/bravais/BravaisTile.tsx
// 墙上的一张磁贴。分两层（给 B6b③ 的底板留结构）：外框（.bravais-tile）只管位置与尺寸，永远不转；内容层
// （.lattice-poster，海报本身）翻牌时绕 Y 轴转到 90° 换内容再转回来，侧立时露出的是外框后面的东西。
// 翻牌全是 WAAPI 动画写在内容层上，React 只在转到 90° 换内容那一刻渲染这一张一次（不是每帧）。
// 聚焦卡（6×6 块内让位）时外框的位置与尺寸走 CSS transition（只有聚焦块里那 12 张带 is-reflowing）。
// 透光（B6b③）：窗（kind = window）没有内容，内容层透明、只有一层很淡的光晕底，露出底板挖出的洞下面的 visualizer；
// 全透明档的内容磁贴（seeThrough）不画封面，只留标题、scrim 与一条封面底条。翻牌比较的是「面」（bravaisFaceKey），
// 所以换档时开窗、关窗、变透明的磁贴也会翻。

export type BravaisTileRect = { x: number; y: number; width: number; height: number };

export type BravaisTileHandlers = BravaisFocusCardActions & {
    /** 点了这张磁贴（拖动后的残余点击已在外面吞掉）。 */
    activate: (slotKey: string) => void;
};

type BravaisTileProps = {
    slotKey: string;
    rect: BravaisTileRect;
    item: BravaisItem | null;
    /** 内容 / 实色空画框 / 窗（透光）。 */
    kind: BravaisTileKind;
    /** 全透明档里不画封面、只留标题的内容磁贴（底板在它上面挖洞）。 */
    seeThrough: boolean;
    step: BravaisFlipStep | undefined;
    nowPlayingKey: string | null;
    /** 在聚焦卡所在的块里：位置与尺寸带过渡。 */
    reflowing: boolean;
    expanded: boolean;
    keyboardFocused: boolean;
    /** 只有展开的那张才需要：「✓ 已在队列」。 */
    queued: boolean;
    pixelScale: number;
    reducedMotion: boolean;
    didDragRef: MutableRefObject<boolean>;
    handlers: BravaisTileHandlers;
};

const rotation = (degrees: number) => `perspective(1400px) rotateY(${degrees}deg)`;

const fallbackBackground = (id: string) => {
    const hue = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
    return `linear-gradient(145deg, hsl(${hue} 68% 58%), hsl(${(hue + 52) % 360} 62% 18%))`;
};

const sameRect = (a: BravaisTileRect, b: BravaisTileRect) => (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
);

const arePropsEqual = (previous: BravaisTileProps, next: BravaisTileProps) => {
    for (const key of Object.keys(next) as (keyof BravaisTileProps)[]) {
        if (key === 'rect') continue;
        if (!Object.is(previous[key], next[key])) return false;
    }
    return sameRect(previous.rect, next.rect);
};

/** 磁贴此刻画的「面」：内容、种类、透不透。翻牌转到 90° 时整个换掉。 */
type BravaisTileFace = { item: BravaisItem | null; kind: BravaisTileKind; seeThrough: boolean };

const faceKeyOf = (face: BravaisTileFace) => bravaisFaceKey(face.item?.key ?? null, face.kind, face.seeThrough);

function BravaisTile({
    slotKey,
    rect,
    item,
    kind,
    seeThrough,
    step,
    nowPlayingKey,
    reflowing,
    expanded,
    keyboardFocused,
    queued,
    pixelScale,
    reducedMotion,
    didDragRef,
    handlers,
}: BravaisTileProps) {
    countRender('BravaisTile');
    const faceRef = useRef<HTMLElement>(null);
    const target: BravaisTileFace = { item, kind, seeThrough };
    const [shown, setShown] = useState<BravaisTileFace>(target);
    const latestFaceRef = useRef(target);
    latestFaceRef.current = target;
    const outAnimationRef = useRef<Animation | null>(null);
    /** 转出段放完、等新内容渲染出来再转进的方向。 */
    const pendingInRef = useRef<number | null>(null);

    const targetKey = faceKeyOf(target);
    const shownKey = faceKeyOf(shown);
    const transition = resolveTileTransition(shownKey, targetKey, step, reducedMotion);
    // 同一项的数据更新就地刷新；翻牌途中（转到 90° 之前）仍画旧内容。
    const face = transition === 'flip' ? shown : target;
    const display = face.item;

    useLayoutEffect(() => {
        if (transition === 'none') return;
        const face = faceRef.current;
        if (transition === 'swap' || !face || !step) {
            setShown(latestFaceRef.current);
            return;
        }
        const out = face.animate(
            [{ transform: rotation(0) }, { transform: rotation(90 * step.direction) }],
            { duration: BRAVAIS_TILE_FLIP_OUT_MS, delay: step.delay, easing: 'cubic-bezier(.55,0,.9,.45)', fill: 'forwards' },
        );
        outAnimationRef.current = out;
        out.onfinish = () => {
            pendingInRef.current = step.direction;
            setShown(latestFaceRef.current);
        };
        return () => {
            // 转出段放完后由转进段接手取消；还没放完（目标又变了、卸载）就地取消，内容回正。
            if (pendingInRef.current === null) out.cancel();
        };
    }, [step, targetKey, transition]);

    useLayoutEffect(() => {
        const direction = pendingInRef.current;
        if (direction === null) return;
        pendingInRef.current = null;
        outAnimationRef.current?.cancel();
        outAnimationRef.current = null;
        const face = faceRef.current;
        if (!face) return;
        const back = face.animate(
            [{ transform: rotation(-90 * direction) }, { transform: rotation(0) }],
            { duration: BRAVAIS_TILE_FLIP_IN_MS, easing: 'cubic-bezier(.2,.7,.25,1)' },
        );
        return () => back.cancel();
    }, [shownKey]);

    // 透着的磁贴只画一条封面底条（小图就够）；聚焦卡与普通磁贴按自己的尺寸取图。
    const coverUrl = useWallPosterArtwork(
        display?.coverUrl,
        face.seeThrough ? BRAVAIS_SEE_THROUGH_STRIP_ARTWORK_PX : Math.max(rect.width, rect.height) * pixelScale,
    );
    const isTrack = display?.kind === 'track';
    const isWindow = face.kind === 'window';
    const cover = display ? (coverUrl ? `url("${coverUrl}")` : fallbackBackground(display.key)) : undefined;
    const isCurrent = Boolean(display && nowPlayingKey && display.key === nowPlayingKey);
    const isExpanded = expanded && isTrack;

    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest('button')) return;
        if (didDragRef.current) {
            didDragRef.current = false;
            return;
        }
        handlers.activate(slotKey);
    };

    const style = {
        transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
        width: rect.width,
        height: rect.height,
        '--bravais-pop-x': ((rect.width + BRAVAIS_METRICS.gap * 2) / Math.max(rect.width, 1)).toFixed(4),
        '--bravais-pop-y': ((rect.height + BRAVAIS_METRICS.gap * 2) / Math.max(rect.height, 1)).toFixed(4),
    } as React.CSSProperties;

    return (
        <div
            className={`bravais-tile${reflowing ? ' is-reflowing' : ''}${isExpanded ? ' is-expanded' : ''}${keyboardFocused ? ' is-focused' : ''}`}
            style={style}
            data-bravais-slot={slotKey}
            data-bravais-kind={isWindow ? 'window' : display?.kind ?? 'wall'}
            data-bravais-see-through={face.seeThrough || undefined}
            data-library-entry={isTrack ? display?.key : undefined}
            data-library-card={display && !isTrack ? display.key : undefined}
            data-bravais-focused={keyboardFocused || undefined}
            data-bravais-expanded={isExpanded || undefined}
            data-bravais-current={isCurrent || undefined}
        >
            <article
                ref={faceRef}
                className={`lattice-poster bravais-tile-face${display ? '' : isWindow ? ' is-window' : ' is-wall'}${face.seeThrough ? ' is-see-through' : ''}${isExpanded ? ' is-expanded' : ''}${keyboardFocused ? ' is-focused' : ''}${isCurrent ? ' is-current' : ''}${display?.unavailable ? ' is-unavailable' : ''}`}
                style={display && !face.seeThrough ? { backgroundImage: cover } : undefined}
                role={display ? (isExpanded ? 'group' : 'button') : undefined}
                aria-label={display ? `${display.title} · ${display.subtitle}` : undefined}
                aria-expanded={isTrack ? isExpanded : undefined}
                tabIndex={-1}
                onClick={handleClick}
            >
                {display && (
                    <>
                        <span className="lattice-poster-shade" />
                        {face.seeThrough
                            ? <span className="bravais-tile-strip" style={{ backgroundImage: cover }} />
                            : <span className="lattice-poster-tint" />}
                        <span className={`lattice-poster-badge${isCurrent ? ' is-current' : ''}`}>{display.badge}</span>
                        {isExpanded ? (
                            <BravaisFocusCardBody
                                slotKey={slotKey}
                                item={display}
                                queued={queued}
                                titleWidth={rect.width}
                                actions={handlers}
                            />
                        ) : (
                            <span className="lattice-poster-copy">
                                <WallTitle title={display.title} expanded={false} targetPosterWidth={rect.width} />
                                {display.subtitle && <small>{display.subtitle}</small>}
                            </span>
                        )}
                    </>
                )}
            </article>
        </div>
    );
}

export default memo(BravaisTile, arePropsEqual);
