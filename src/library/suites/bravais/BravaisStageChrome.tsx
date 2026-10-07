import React, { useCallback } from 'react';
import { Blinds, Crosshair } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import WallBackButton from '../../../components/wall/WallBackButton';
import WallToolsButton, { type WallToolsEntry } from '../../../components/wall/WallToolsButton';
import { useLibraryWallLookStore } from '../../../stores/useLibraryWallLookStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import type { LibraryWallLook } from '../../../utils/libraryWallLook';
import { nextWallLook } from './bravaisLook';

// src/library/suites/bravais/BravaisStageChrome.tsx
// bravais 墙上的两颗浮层控件（实测反馈 1，设计稿 §7.5「浮层控件」），与 Lattice 共用 components/wall 的同一套：
// - 左上角隐藏式返回（WallBackButton concealed）：回到播放页（宿主的 onBackToPlayer），首页与集合层都在；
//   与缝里的 ‹（层返回 / onDone）不是一回事。z-index 在缝之下：缝正好开在左上角时让缝的按钮在上面。
// - 右下角工具按钮（WallToolsButton）：定位正在播放、透光档位，加上共享的叠色开关、开灯 / 关灯、帮助；滑动打开命令面板。
// 不碰相机与显示：定位走外观动作 locate-playing 的同一个实现，透光写 app 层偏好（与命令面板的 wall-look 同一条路）。

const LOOK_LABEL_KEYS: Record<LibraryWallLook, string> = {
    solid: 'options.libraryWallLookSolid',
    partial: 'options.libraryWallLookPartial',
    clear: 'options.libraryWallLookClear',
};

type BravaisStageChromeProps = {
    isDaylight: boolean;
    onBackToPlayer?: () => void;
    /** 外观动作 locate-playing（useBravaisChromeActions 的那一份）。 */
    locatePlaying: { isAvailable: () => boolean; run: () => void };
};

const BravaisStageChrome: React.FC<BravaisStageChromeProps> = ({ isDaylight, onBackToPlayer, locatePlaying }) => {
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
            {onBackToPlayer && (
                <WallBackButton label={t('libraryBravaisHome.backToPlayer')} onBack={onBackToPlayer} concealed />
            )}
            <WallToolsButton
                idPrefix="bravais-tools"
                label={t('libraryBravais.tools')}
                isDaylight={isDaylight}
                entries={entries}
                help={(
                    <>
                        <li>
                            <span>{t('libraryBravais.helpEnter')}</span>
                            <span className="lattice-tools-help-key"><kbd>ESC</kbd>{t('libraryBravais.helpEscape')}</span>
                        </li>
                        <li><span>{t('libraryBravais.helpMove')}</span></li>
                        <li>
                            <span>{t('libraryBravais.helpSeam')}</span>
                            <kbd>Tab</kbd>
                        </li>
                        <li>
                            <span>{t('libraryBravais.helpTabs')}</span>
                            <kbd>F6</kbd>
                        </li>
                        <li>
                            <span>{t('home.latticeHelpCommands')}</span>
                            <span className="lattice-tools-help-key"><kbd>S</kbd><kbd>{PRIMARY_MODIFIER_LABEL} + K</kbd></span>
                        </li>
                    </>
                )}
            />
        </>
    );
};

export default React.memo(BravaisStageChrome);
