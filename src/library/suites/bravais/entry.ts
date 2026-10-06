import React from 'react';
import type { LibraryActionId, LibrarySuiteManifest } from '../../core/contracts/suite';

// src/library/suites/bravais/entry.ts
// bravais suite（library v2 的正式新 UI，设计稿 docs/bravais-suite-design.md）：用户始终站在一面墙前，导航与筛选都是
// 给墙上的位置翻牌换内容，页面信息与操作放在墙面裂开的一道缝里。画面全在 stage（BravaisStage）里，它横跨首页与集合层；
// 各 surface 只把 core 的数据投影成层描述交给 suite 内的 stage store（bravaisStageStore），自己不画画面。
//
// B6（骨架）只实现首页（「歌单」页签）与集合页的浏览，按「声明以 entry 为准」只声明做到了的 surface 与动作：
// 歌手页与账户没声明，照常回退 grid；首页的目录 / 导入等动作、集合页的过滤与变更动作在 B7–B10 补齐。
// 本文件只能静态 import react（test/unit/library/suiteEntries.test.ts）：组件与 stage 一律 React.lazy，
// 没选 bravais 的人不加载它的任何 chunk。

/**
 * 每一层布局记忆（相机、缝的锚点、起点 slot）在 sessionStorage 里的键前缀，后接会话键。
 * 定义在这里是因为 layout.forget 就在这里按它删记录（entry 不能静态 import bravaisLayoutMemory）。
 */
export const BRAVAIS_LAYOUT_STORAGE_PREFIX = 'folia_bravais_layout:v1:';

const BravaisStage = React.lazy(() => import('./BravaisStage'));
const BravaisHome = React.lazy(() => import('./BravaisHome'));
const BravaisCollection = React.lazy(() => import('./BravaisCollection'));

// 集合页（B6）：聚焦卡上的「立即播放」「加入队列」与歌手 / 专辑链接，缝里的「播放全部」「加入队列」。
const COLLECTION_ACTIONS: readonly LibraryActionId[] = [
    'play',
    'enqueue',
    'play-scope',
    'enqueue-scope',
    'open-album',
    'open-artist',
];

const bravais: LibrarySuiteManifest = {
    id: 'bravais',
    labelKey: 'libraryBravais.suiteName',
    stage: BravaisStage,
    surfaces: {
        // 首页：B6 只铺「歌单」页签；首页的目录、隐藏、导入等动作在 B9 声明。
        home: { component: BravaisHome, actions: [] },
        collection: { component: BravaisCollection, actions: COLLECTION_ACTIONS },
    },
    layout: {
        forget: sessionKey => {
            try {
                sessionStorage.removeItem(BRAVAIS_LAYOUT_STORAGE_PREFIX + sessionKey);
            } catch {
                // sessionStorage 不可用：本来也没有记录。
            }
        },
    },
};

export default bravais;
