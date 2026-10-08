import React, { useCallback } from 'react';
import { Blinds, Crosshair } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import WallBackButton from '../../../components/wall/WallBackButton';
import WallToolsButton, { type WallToolsEntry } from '../../../components/wall/WallToolsButton';
import { useLibraryWallLookStore } from '../../../stores/useLibraryWallLookStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import type { LibraryWallLook } from '../../../utils/libraryWallLook';
import { BRAVAIS_HELP_ROWS } from './bravaisHelp';
import { nextWallLook } from './bravaisLook';
import type { BravaisBackStep } from './bravaisBack';

// src/library/suites/bravais/BravaisStageChrome.tsx
// bravais 墙上的两颗浮层控件（实测反馈 1，设计稿 §7.5「浮层控件」），与 Lattice 共用 components/wall 的同一套：
// - 左上角隐藏式返回（WallBackButton concealed）：做什么由 stage 按 bravaisBack 定——不在首页根层时与缝里的 ‹ 同一个返回
//   （先关面板 / 表单，再退层），可访问名「返回」；首页根层有歌时回到播放页（「回到播放页」），没有歌时不画。
//   z-index 在缝之下：缝正好开在左上角时让缝的按钮在上面。
// - 右下角工具按钮（WallToolsButton）：定位正在播放、透光档位，加上共享的叠色开关、开灯 / 关灯、帮助（行在 bravaisHelp，每行「说明 + 按键」）；滑动打开命令面板。
// 不碰相机与显示：定位走外观动作 locate-playing 的同一个实现，透光写 app 层偏好（与命令面板的 wall-look 同一条路）。

const LOOK_LABEL_KEYS: Record<LibraryWallLook, string> = {
    solid: 'options.libraryWallLookSolid',
    partial: 'options.libraryWallLookPartial',
    clear: 'options.libraryWallLookClear',
};

type BravaisStageChromeProps = {
    isDaylight: boolean;
    /** 左上角返回此刻的去处（null：不画）；run 在点击时按最新状态再判一次。 */
    back: { step: BravaisBackStep; run: () => void } | null;
    /** 外观动作 locate-playing（useBravaisChromeActions 的那一份）。 */
    locatePlaying: { isAvailable: () => boolean; run: () => void };
    /**
     * 工具按钮此刻认领 App 的 dock（WallToolsDock）：墙显示着（首页层可交互、当前层归 bravais），或正在交接里离开（Lattice
     * 后认领、盖在上面，按钮不闪）。不在 dock 里（组件探针）时不看它。
     */
    toolsClaimed?: boolean;
};

const BravaisStageChrome: React.FC<BravaisStageChromeProps> = ({ isDaylight, back, locatePlaying, toolsClaimed = true }) => {
    const { t } = useTranslation();
    const look = useLibraryWallLookStore(state => state.look);
    const setLook = useLibraryWallLookStore(state => state.setLook);

    // 面板打开着渲染时才求值：正在播放的那首此刻在不在墙上（与命令面板里同一个判定）。
    const entries = useCallback((): WallToolsEntry[] => [
        {
            kind: 'action',
            id: 'locate-playing',
            icon: Crosshair,
            label: t('libraryBravais.toolsLocate'),
            kbd: ': + C',
            kbdHidden: true,
            disabled: !locatePlaying.isAvailable(),
            onSelect: locatePlaying.run,
        },
        {
            kind: 'action',
            id: 'wall-look',
            icon: Blinds,
            label: t('options.libraryWallLook'),
            value: t(LOOK_LABEL_KEYS[look]),
            keepOpen: true,
            onSelect: () => setLook(nextWallLook(look)),
        },
    ], [locatePlaying, look, setLook, t]);

    return (
        <>
            {back && (
                <WallBackButton
                    label={back.step === 'player' ? t('libraryBravaisHome.backToPlayer') : t('libraryBravais.seamBack')}
                    onBack={back.run}
                    concealed
                />
            )}
            <WallToolsButton
                idPrefix="bravais-tools"
                label={t('libraryBravais.tools')}
                claimed={toolsClaimed}
                isDaylight={isDaylight}
                entries={entries}
                help={BRAVAIS_HELP_ROWS.map(row => (
                    <li key={row.id} data-bravais-help={row.id}>
                        <span>{t(row.labelKey)}</span>
                        <kbd>{row.kbd(PRIMARY_MODIFIER_LABEL)}</kbd>
                    </li>
                ))}
            />
        </>
    );
};

export default React.memo(BravaisStageChrome);
