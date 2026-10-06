import { BRAVAIS_SEAM_FULL_WIDTH } from './bravaisConstants';
import type { BravaisLayerSurface } from './bravaisLayer';
import {
    resolveSeamOpenWidth,
    resolveSeamVariant,
    seamVariantWidth,
    type BravaisSeamLevel,
    type BravaisSeamVariant,
} from './bravaisSeamLevel';

// src/library/suites/bravais/bravaisSeamTarget.ts
// 缝此刻该开多宽、渲染哪一套内容（B7 在三级开口之上加的三种情形，纯规则）：
// - 表单态（改名、删除确认、加入歌单选择）：缝原地翻成表单，宽度按完整信息条；
// - 列表面板（导航状态）：缝加宽到 min(420, 视口 − 52)，标题横排压在顶部（设计稿 §5「面板」）；
// - 过滤框开着：书脊 / 折叠的缝临时展开为完整信息条，框收起后回到原等级（设计稿 §7.6）。
// 优先级：表单 > 面板 > 过滤的临时展开 > 用户选的等级。用户的等级不被改写，只是暂时不生效。

/** 列表面板的开口：min(420, 视口 − 52)。 */
export const BRAVAIS_PANEL_MAX_WIDTH = 420;
export const BRAVAIS_PANEL_VIEWPORT_MARGIN = 52;
/** 极窄的视口里也留一列能读的宽度。 */
const BRAVAIS_PANEL_MIN_WIDTH = 160;

export const resolvePanelWidth = (viewportWidth: number) => Math.max(
    BRAVAIS_PANEL_MIN_WIDTH,
    Math.min(BRAVAIS_PANEL_MAX_WIDTH, viewportWidth - BRAVAIS_PANEL_VIEWPORT_MARGIN),
);

export type BravaisSeamContentVariant = BravaisSeamVariant | 'panel' | 'form';

export type BravaisSeamTargetInput = {
    surface: BravaisLayerSurface;
    level: BravaisSeamLevel;
    viewportWidth: number;
    formOpen?: boolean;
    panelOpen?: boolean;
    /** 命令面板的过滤框正画在缝里。 */
    filterOpen?: boolean;
};

/** 这一刻的生效等级：过滤框、面板、表单都要求完整的缝。 */
export const resolveEffectiveSeamLevel = ({ level, formOpen, panelOpen, filterOpen }: BravaisSeamTargetInput): BravaisSeamLevel => (
    formOpen || panelOpen || filterOpen ? 'full' : level
);

export const resolveSeamTarget = (input: BravaisSeamTargetInput): { width: number; variant: BravaisSeamContentVariant } => {
    if (input.surface === 'collection' && input.formOpen) return { width: BRAVAIS_SEAM_FULL_WIDTH, variant: 'form' };
    if (input.surface === 'collection' && input.panelOpen) {
        return { width: resolvePanelWidth(input.viewportWidth), variant: 'panel' };
    }
    const level = resolveEffectiveSeamLevel(input);
    return { width: resolveSeamOpenWidth(input.surface, level), variant: resolveSeamVariant(input.surface, level) };
};

/** 一套内容的排版宽度（翻转不重排：跟着此刻渲染的那一套走）。 */
export const resolveVariantWidth = (variant: BravaisSeamContentVariant, viewportWidth: number) => {
    if (variant === 'form') return BRAVAIS_SEAM_FULL_WIDTH;
    if (variant === 'panel') return resolvePanelWidth(viewportWidth);
    return seamVariantWidth(variant);
};
