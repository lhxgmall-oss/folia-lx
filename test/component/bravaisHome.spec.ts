import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import { HOME_FM_COUNT, HOME_FM_PREFIX, onlinePlaybackKey, onlineSongId, PROBE_PROVIDER_A, PROBE_PROVIDER_B } from '../../dev/probes/libraryBehavior/fixtureRules';
import { HOME_LOCAL_FOLDER_IDS, homeFolderId } from '../../dev/probes/homeBehavior/homeFixtureRules';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisHome.spec.ts
// B9 bravais 首页的组件用例（homeBehavior 探针 + setSuite('bravais')），覆盖参数化用例（homeBehavior.spec）摸不到的
// bravais 专属界面：换页签的整墙出场 / 入场与 F6、私人 FM 直接播放、本地四行是缝里的二级切换（不换层）、目录树面板
// （批量模式：墙退化为有限拼贴、点卡片只切换选中、批量按键、确认态、关面板丢掉选择）、管理隐藏视图与眼睛按钮、
// 缝里的全局搜索（提交走 onSearchCommitted）、本地「⋯」与 Navidrome 刷新。
// 墙是虚拟化的：只找此刻在 DOM 里的磁贴；探针左下角的 DEV 浮层可能盖住磁贴，点磁贴用派发点击（同一个 onClick）。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const seam = (page: Page) => page.locator('[data-bravais-seam]');
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__homeProbe!.calls().filter(call => call.kind === callKind), kind)
);
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());
const batchScope = (page: Page) => page.evaluate(() => window.__homeProbe!.batchScope());
const card = (page: Page, itemKey: string) => page.locator(`.bravais-tile[data-library-card="${itemKey}"]`).first();
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
};

const showLocal = async (page: Page) => {
    await seam(page).locator('[data-bravais-tab="local"]').click();
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
    await settled(page);
    await expect(page.locator('.bravais-tile[data-library-card^="card:folder:"]').first()).toBeAttached();
};

test.describe('[bravais-only] home', () => {
    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('switching tabs lifts the whole wall off and lands the next one; F6 cycles the tabs', async ({ page }) => {
        // 整墙出场 / 入场：内容层先抬起（出场的 WAAPI 动画往上抬 90 个世界单位），翻牌期间 stage 挂着 settling。
        // 点之前先装一个逐帧计数（记下同时在跑的「抬起」动画最多有几个）。
        await page.evaluate(() => {
            const probe = window as unknown as { __b9Lifted: number };
            probe.__b9Lifted = 0;
            const started = performance.now();
            const count = () => {
                const lifted = document.getAnimations().filter(animation => {
                    const keyframes = (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
                    return keyframes.some(frame => String(frame.transform ?? '').includes('-90px'));
                }).length;
                probe.__b9Lifted = Math.max(probe.__b9Lifted, lifted);
                if (performance.now() - started < 2500) requestAnimationFrame(count);
            };
            requestAnimationFrame(count);
        });
        await seam(page).locator('[data-bravais-tab="albums"]').click();
        await expect(stage(page)).toHaveAttribute('data-bravais-settling', 'true');
        await expect.poll(() => page.evaluate(() => (window as unknown as { __b9Lifted: number }).__b9Lifted)).toBeGreaterThan(5);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:albums');
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-card^="card:album:"]').first()).toBeAttached();
        await expect(page.locator('.bravais-tile[data-library-card^="card:playlist:"]')).toHaveCount(0);

        await page.keyboard.press('F6');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
        await page.keyboard.press('Shift+F6');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:albums');
        expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe('albums');
    });

    test('Personal FM plays straight away and stays on the radio wall', async ({ page }) => {
        await seam(page).locator('[data-bravais-tab="radio"]').click();
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:radio');
        await settled(page);
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await card(page, 'card:radio:personal_fm').locator('article').dispatchEvent('click');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const fmKeys = Array.from({ length: HOME_FM_COUNT }, (_, index) => onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(HOME_FM_PREFIX, index)));
        expect((await calls(page, 'playSong'))[0]).toMatchObject({ ids: [fmKeys[0]], isFm: true });
        expect(await stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:radio');
    });

    test('the four local rows switch inside the seam without changing the layer', async ({ page }) => {
        await showLocal(page);
        await expect(seam(page).locator('[data-bravais-section="folders"]')).toHaveAttribute('aria-selected', 'true');
        await seam(page).locator('[data-bravais-section="albums"]').click();
        await expect(seam(page).locator('[data-bravais-section="albums"]')).toHaveAttribute('aria-selected', 'true');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-card^="card:album:"]').first()).toBeAttached();
        await expect(page.locator('.bravais-tile[data-library-card^="card:folder:"]')).toHaveCount(0);
    });

    test('the directory panel is batch mode: cards only toggle, batch keys work, and closing drops the selection', async ({ page }) => {
        await showLocal(page);
        await seam(page).locator('[data-bravais-seam-action="directory"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'panel');
        await expect(seam(page).locator('[data-bravais-directory="home:local"]')).toBeVisible();
        await settled(page);
        // 面板一打开就是批量模式：墙上每张卡都只有一份（有限拼贴），全都还没选中、灰着。
        const folderKeys = HOME_LOCAL_FOLDER_IDS.map(id => `card:folder:${id}`);
        await expect.poll(() => page.locator('.bravais-tile[data-library-card]').evaluateAll(
            elements => elements.map(element => element.getAttribute('data-library-card')).sort(),
        )).toEqual([...folderKeys].sort());
        await expect(page.locator('.bravais-tile[data-library-card][data-bravais-dimmed]')).toHaveCount(folderKeys.length);

        // 点卡片只切换选中，绝不进入文件夹。
        const beta = `card:folder:${homeFolderId('Music/Beta')}`;
        await card(page, beta).locator('article').dispatchEvent('click');
        await expect(card(page, beta)).not.toHaveAttribute('data-bravais-dimmed', /.*/);
        await expect(card(page, beta).locator('[data-bravais-selected]')).toHaveCount(1);
        expect(await stack(page)).toEqual([]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Beta')]);
        // 树上对应的节点跟着勾上（上层是部分）。
        await expect(seam(page).locator(`[data-bravais-dir-row="item:${homeFolderId('Music/Beta')}"] [role="checkbox"]`)).toHaveAttribute('aria-checked', 'true');
        await expect(seam(page).locator('[data-bravais-dir-row]').filter({ has: page.locator('strong', { hasText: /^Music$/ }) })
            .locator('[role="checkbox"]')).toHaveAttribute('aria-checked', 'mixed');

        // Ctrl+A 全选，Ctrl+Enter 播放所选，Delete 先翻成确认态，Esc 撤销确认态。
        await page.keyboard.press('Control+a');
        await expect.poll(async () => (await batchScope(page))?.itemIds.length).toBe(folderKeys.length);
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await page.keyboard.press('Control+Enter');
        await expect.poll(() => calls(page, 'playAll')).toHaveLength(1);
        await page.keyboard.press('Delete');
        await expect(seam(page).locator('[data-bravais-form-id="remove"]')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(seam(page).locator('[data-bravais-form-id="remove"]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__homeProbe!.localSongIds())).toHaveLength(8);

        // Esc 阶梯：先清掉点卡片时落下的键盘焦点，再关面板 = 退出批量模式：选择清空，墙翻回无限拼贴（不再灰）。
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bravais-focused]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.getQuery())).toBe('');
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-card][data-bravais-dimmed]')).toHaveCount(0);
        await card(page, beta).locator('article').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Music/Beta']);
    });

    test('creating a playlist from the panel turns its foot into a form and keeps it open until it works', async ({ page }) => {
        await showLocal(page);
        await seam(page).locator('[data-bravais-seam-action="directory"]').click();
        await settled(page);
        await page.evaluate(id => window.__homeProbe!.batchSelect([id]), homeFolderId('Extra'));
        await seam(page).locator('[data-bravais-dir-action="create-playlist"]').click();
        const form = seam(page).locator('[data-bravais-form-id="create-playlist"]');
        await expect(form).toBeVisible();
        await form.locator('input').fill('Wall Mix');
        await form.locator('input').press('Enter');
        await expect(form).toHaveCount(0);
        await expect.poll(async () => (await page.evaluate(() => window.__homeProbe!.localPlaylists())).map(playlist => playlist.name)).toContain('Wall Mix');
    });

    test('manage hidden flips the hidden cards up greyed; hidden-only narrows it; Escape leaves the view', async ({ page }) => {
        // 平时悬停有眼睛按钮：隐藏一张，它从墙上消失。
        await card(page, 'card:playlist:owned').locator('[data-bravais-action="toggle-hidden"]').dispatchEvent('click');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.storedHidden())).toEqual({ [`online:${PROBE_PROVIDER_A}`]: ['owned'] });
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-card="card:playlist:owned"]')).toHaveCount(0);

        await seam(page).locator('[data-bravais-seam-action="manage-hidden"]').click();
        await expect(seam(page).locator('[data-bravais-manage]')).toHaveAttribute('data-bravais-manage', 'manage');
        await expect(stage(page)).toHaveClass(/is-managing-hidden/);
        await settled(page);
        await expect(card(page, 'card:playlist:owned')).toHaveAttribute('data-bravais-dimmed', 'true');
        // 原地取消隐藏：变色不重排。
        const slot = await card(page, 'card:playlist:owned').getAttribute('data-bravais-slot');
        await card(page, 'card:playlist:owned').locator('[data-bravais-action="toggle-hidden"]').dispatchEvent('click');
        await expect(page.locator(`[data-bravais-slot="${slot}"]`)).not.toHaveAttribute('data-bravais-dimmed', /.*/);
        await expect(page.locator(`[data-bravais-slot="${slot}"]`)).toHaveAttribute('data-library-card', 'card:playlist:owned');
        await card(page, 'card:playlist:owned').locator('[data-bravais-action="toggle-hidden"]').dispatchEvent('click');

        await seam(page).locator('[data-bravais-seam-action="hidden-only"]').click();
        await expect(seam(page).locator('[data-bravais-manage]')).toHaveAttribute('data-bravais-manage', 'manage-hidden-only');
        await settled(page);
        await expect.poll(() => page.locator('.bravais-tile[data-library-card]').evaluateAll(
            elements => [...new Set(elements.map(element => element.getAttribute('data-library-card')))],
        )).toEqual(['card:playlist:owned']);

        await page.keyboard.press('Escape');
        await expect(seam(page).locator('[data-bravais-manage]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__homeProbe!.hiddenView())).toBe('browse');
    });

    test('the seam search box submits through onSearchCommitted, the one way off the wall', async ({ page }) => {
        await page.keyboard.press('/');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'search');
        const input = seam(page).locator('input[name="bravais-search"]');
        await expect(input).toBeFocused();
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await input.fill('blue train');
        await input.press('Enter');
        await expect.poll(async () => (await calls(page, 'searchCommitted')).map(call => [call.text, call.key])).toEqual([['blue train', 'playlist']]);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');

        await seam(page).locator('[data-bravais-seam-action="search"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'search');
        await seam(page).locator('[data-bravais-seam-action="close-search"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
    });

    test('the local seam menu imports a folder; the Navidrome seam refreshes the overview', async ({ page }) => {
        await showLocal(page);
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await seam(page).locator('[data-bravais-seam-action="more"]').click();
        await seam(page).locator('[data-bravais-seam-action="home-import-folder"]').click();
        await expect.poll(async () => (await calls(page, 'service')).map(call => call.key)).toEqual(['importFolder']);

        await seam(page).locator('[data-bravais-tab="navidrome"]').click();
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:navidrome');
        await expect(seam(page).locator('[data-bravais-section="albums"]')).toHaveAttribute('aria-selected', 'true');
        await expect(seam(page).locator('[data-bravais-seam-action="refresh-navidrome"]')).toBeEnabled();
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await seam(page).locator('[data-bravais-seam-action="refresh-navidrome"]').click();
        await expect.poll(async () => (await page.evaluate(() => window.__homeProbe!.requests())).filter(request => request.op === 'getAlbumList2').length)
            .toBeGreaterThan(0);
    });
});

// 合并 B8 后：从首页打开集合（B7）/ 歌手页（B8）再返回。首页层第一次画时没有起点（布局记忆里的起点是 null），
// B8 的 stage 修复让返回时照记忆恢复——墙回到离开时的排法，压栈与返回各只翻一次（不走首页之间的整墙出场 / 入场）。
// 歌单那条是这个修复的守卫（换回「一律取离缝最近的 slot」会失败）；本地页签是换页签（replace）落下的层，起点不是 null，
// 那条只核对歌手页（bravais）与首页之间的往返。
test.describe('[bravais-only] home ↔ collection / artist', () => {
    /** 墙上此刻有内容的磁贴：slot → 卡片键。 */
    const wallContent = (page: Page) => page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.bravais-tile')]
            .map(tile => [tile.dataset.bravaisSlot ?? '', tile.dataset.libraryCard ?? tile.dataset.libraryEntry ?? ''])
            .filter(([, entry]) => entry),
    ));
    /** 从现在起数 stage 的翻牌次数（data-bravais-settling 出现一次算一次）与换过的层。 */
    const watchStage = (page: Page) => page.evaluate(() => {
        const root = document.querySelector('[data-library-stage="bravais"]')!;
        const record = { flips: 0, layers: [] as string[] };
        (window as unknown as { __bravaisStageWatch?: typeof record }).__bravaisStageWatch = record;
        let settling = root.hasAttribute('data-bravais-settling');
        let layer = root.getAttribute('data-bravais-layer');
        new MutationObserver(() => {
            const nextSettling = root.hasAttribute('data-bravais-settling');
            if (nextSettling && !settling) record.flips += 1;
            settling = nextSettling;
            const nextLayer = root.getAttribute('data-bravais-layer');
            if (nextLayer !== layer && nextLayer) record.layers.push(nextLayer);
            layer = nextLayer;
        }).observe(root, { attributes: true, attributeFilter: ['data-bravais-settling', 'data-bravais-layer'] });
    });
    const stageWatch = (page: Page) => page.evaluate(() => (
        (window as unknown as { __bravaisStageWatch?: { flips: number; layers: string[] } }).__bravaisStageWatch!
    ));
    /** 等墙落定，再多等一拍（落定后不该再有数据更新的翻牌）。 */
    const settle = async (page: Page) => {
        await settled(page);
        await page.waitForTimeout(500);
        await settled(page);
    };
    /** 打开一张卡、再用缝里的返回按钮退回：压栈翻一次、返回翻一次，墙的每个 slot 与离开前一致。 */
    const openAndBack = async (page: Page, cardKey: string, homeLayer: string, surface: 'collection' | 'artist') => {
        await settle(page);
        // 先把相机挪开（键盘焦点往下走几行），返回时「离缝最近的 slot」就不是第一次画时的原点。
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('ArrowRight');
        for (let step = 0; step < 8; step += 1) await page.keyboard.press('ArrowDown');
        await settle(page);
        const before = await wallContent(page);
        expect(Object.keys(before).length).toBeGreaterThan(0);

        await watchStage(page);
        await card(page, cardKey).locator('article').dispatchEvent('click');
        await expect.poll(async () => (await stack(page)).length).toBe(1);
        await expect(page.locator(`[data-library-surface="${surface}"][data-library-renderer="bravais"]`)).toHaveCount(1);
        await expect(stage(page)).not.toHaveAttribute('data-bravais-layer', homeLayer);
        await settle(page);
        expect((await stageWatch(page)).flips).toBe(1);

        await watchStage(page);
        await seam(page).locator('[data-bravais-seam-action="back"]').first().dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', homeLayer);
        await settle(page);
        const watch = await stageWatch(page);
        expect(watch.layers).toEqual([homeLayer]);
        expect(watch.flips).toBe(1);
        const after = await wallContent(page);
        const shared = Object.keys(before).filter(slot => slot in after);
        expect(shared.length).toBeGreaterThan(0);
        for (const slot of shared) expect(after[slot], slot).toBe(before[slot]);
    };

    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('a playlist opened from the home wall and closed again: one flip each way, the wall comes back as it was', async ({ page }) => {
        await openAndBack(page, 'card:playlist:owned', 'home:playlist', 'collection');
    });

    test('a local artist opened from the home wall and closed again: one flip each way, the wall comes back as it was', async ({ page }) => {
        await showLocal(page);
        await seam(page).locator('[data-bravais-section="artists"]').click();
        await settled(page);
        const artistCard = page.locator('.bravais-tile[data-library-card^="card:artist:"]').first();
        await expect(artistCard).toBeAttached();
        const cardKey = (await artistCard.getAttribute('data-library-card'))!;
        await openAndBack(page, cardKey, 'home:local', 'artist');
        await expect(seam(page).locator('[data-bravais-section="artists"]')).toHaveAttribute('aria-selected', 'true');
    });
});

// B11：从搜索页 / 播放页打开的集合下面没有首页墙——整墙入场（磁贴从抬起落回，没有起点磁贴）；‹ 回到来源是整墙出场
// （首页层在遮盖之下落回，相机回到离开时的位置）。探针里没有搜索页，用导航 store 以 search 来源打开同一个歌单。
test.describe('[bravais-only] whole-wall entrance and exit from a source', () => {
    const wallContent = (page: Page) => page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.bravais-tile')]
            .map(tile => [tile.dataset.bravaisSlot ?? '', tile.dataset.libraryCard ?? tile.dataset.libraryEntry ?? ''])
            .filter(([, entry]) => entry),
    ));
    const watchShifts = (page: Page) => page.evaluate(() => {
        const root = document.querySelector('[data-library-stage="bravais"]')!;
        const record: string[] = [];
        (window as unknown as { __shifts?: string[] }).__shifts = record;
        let seq = root.getAttribute('data-bravais-shift-seq');
        new MutationObserver(() => {
            const next = root.getAttribute('data-bravais-shift-seq');
            if (next === seq || next === null) return;
            seq = next;
            record.push(root.getAttribute('data-bravais-shift') ?? '');
        }).observe(root, { attributes: true, attributeFilter: ['data-bravais-shift-seq'] });
    });
    const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts?: string[] }).__shifts ?? []);
    /** 此刻磁贴内容层上的动画：抬起（整墙波次）、转（翻牌）、fill。 */
    const tileAnimations = (page: Page) => page.evaluate(() => document.getAnimations()
        .filter(animation => {
            // 只看磁贴自己放的 WAAPI 动画（CSS 的过渡 / 动画也在 getAnimations 里，例如悬停与日光切换的过渡）。
            if (animation instanceof CSSTransition || animation instanceof CSSAnimation) return false;
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return target instanceof Element && target.classList.contains('bravais-tile-face');
        })
        .map(animation => {
            const effect = animation.effect as KeyframeEffect;
            const transforms = effect.getKeyframes().map(frame => String(frame.transform ?? '')).join(' ');
            return { lifts: transforms.includes('-90px'), rotates: transforms.includes('rotateY'), fill: effect.getTiming().fill };
        }));

    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('a playlist opened from the search enters the whole wall, and Back exits it with the home wall landing as it was', async ({ page }) => {
        // 先从首页打开一次拿到描述（宿主收到的同一份），退回首页。
        await card(page, 'card:playlist:owned').locator('article').dispatchEvent('click');
        await expect.poll(async () => (await stack(page)).length).toBe(1);
        const descriptor = await page.evaluate(async () => {
            const modulePath = '/src/stores/useCollectionNavigationStore.ts';
            const { useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
            return useCollectionNavigationStore.getState().snapshot!.stack[0] as unknown;
        });
        await settled(page);
        await seam(page).locator('[data-bravais-seam-action="back"]').first().dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
        await settled(page);
        await page.waitForTimeout(400);
        const before = await wallContent(page);
        expect(Object.keys(before).length).toBeGreaterThan(0);

        await watchShifts(page);
        await page.evaluate(async collection => {
            const modulePath = '/src/stores/useCollectionNavigationStore.ts';
            const { useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
            useCollectionNavigationStore.getState().openRoot(collection, 'search');
        }, descriptor);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'enter');
        await expect.poll(async () => (await tileAnimations(page)).length).toBeGreaterThan(0);
        expect((await tileAnimations(page)).every(animation => animation.lifts && !animation.rotates && animation.fill === 'backwards')).toBe(true);
        await expect(stage(page).locator('[data-bravais-crumb="root"]')).toHaveText('Search');
        await settled(page);
        await page.waitForTimeout(400);

        await seam(page).locator('[data-bravais-seam-action="back"]').first().dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'exit');
        await expect.poll(async () => (await tileAnimations(page)).length).toBeGreaterThan(0);
        expect((await tileAnimations(page)).some(animation => animation.lifts)).toBe(true);
        expect((await tileAnimations(page)).some(animation => animation.rotates)).toBe(false);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
        await settled(page);
        await page.waitForTimeout(400);
        expect(await shifts(page)).toEqual(['enter', 'exit']);
        const after = await wallContent(page);
        const shared = Object.keys(before).filter(slot => slot in after);
        expect(shared.length).toBeGreaterThan(0);
        for (const slot of shared) expect(after[slot], slot).toBe(before[slot]);
    });
});

// 合并 B10：账户的登录态 / 确认态不属于任何一层——换层（压栈、返回、来源整墙入场 / 出场，降低动效时的淡入淡出）途中与
// 之后缝都还是账户变体，面包屑不出现；切 suite 的 reset 不碰账户表单；答复后缝回到当前层自己的开口（面包屑回来）。
test.describe('[bravais-only] the account seam over layer shifts', () => {
    const confirmForm = (page: Page) => seam(page).locator('[data-bravais-account-confirm]');
    const askSwitch = async (page: Page) => {
        await seam(page).locator('[data-bravais-account-toggle="strip"]').click();
        await seam(page).locator(`[data-bravais-account-provider="${PROBE_PROVIDER_B}"] [role="menuitemradio"]`).click();
        await expect(confirmForm(page)).toHaveAttribute('data-bravais-account-confirm', PROBE_PROVIDER_B);
    };
    const expectAccountSeam = async (page: Page) => {
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'confirm');
        await expect(confirmForm(page)).toBeVisible();
        await expect(seam(page).locator('[data-bravais-crumbs]')).toHaveCount(0);
    };
    const closeAll = (page: Page) => page.evaluate(async () => {
        const modulePath = '/src/stores/useCollectionNavigationStore.ts';
        const { notifyCollectionPop, useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
        notifyCollectionPop(null);
        useCollectionNavigationStore.getState().clear();
    });
    const openFromSearch = (page: Page, descriptor: unknown) => page.evaluate(async collection => {
        const modulePath = '/src/stores/useCollectionNavigationStore.ts';
        const { useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
        useCollectionNavigationStore.getState().openRoot(collection, 'search');
    }, descriptor);
    const firstDescriptor = (page: Page) => page.evaluate(async () => {
        const modulePath = '/src/stores/useCollectionNavigationStore.ts';
        const { useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
        return useCollectionNavigationStore.getState().snapshot!.stack[0] as unknown;
    });

    const walkShifts = async (page: Page) => {
        await askSwitch(page);
        await expectAccountSeam(page);

        // 压栈（首页卡片）→ 返回：缝一直是确认态。
        await card(page, 'card:playlist:owned').locator('article').dispatchEvent('click');
        await expect.poll(async () => (await stack(page)).length).toBe(1);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'push');
        await expectAccountSeam(page);
        await settled(page);
        await expectAccountSeam(page);
        const descriptor = await firstDescriptor(page);
        await closeAll(page);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'back');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
        await expectAccountSeam(page);
        await settled(page);

        // 来源是搜索：整墙入场 → 出场，缝同样不动。
        await openFromSearch(page, descriptor);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'enter');
        await expectAccountSeam(page);
        await settled(page);
        await expectAccountSeam(page);
        await closeAll(page);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'exit');
        await expectAccountSeam(page);
        await settled(page);

        // 切 suite 时宿主调的 reset 只丢起点磁贴，不碰账户表单。
        await page.evaluate(async () => {
            const modulePath = '/src/library/suites/bravais/bravaisTransitions.ts';
            const { resetBravaisTransitions } = await import(/* @vite-ignore */ modulePath);
            resetBravaisTransitions();
        });
        await expectAccountSeam(page);

        // 再从搜索打开、在集合层上答复：缝回到集合层的完整信息条，面包屑回来（根是 Search）。
        await openFromSearch(page, descriptor);
        await expectAccountSeam(page);
        await settled(page);
        await confirmForm(page).locator('[data-bravais-form-action="cancel"]').click();
        await expect(confirmForm(page)).toHaveCount(0);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'full');
        await expect(seam(page).locator('[data-bravais-crumb="root"]')).toHaveText('Search');
        expect(await page.evaluate(() => window.__homeProbe!.activeProvider())).toBe(PROBE_PROVIDER_A);
    };

    test('a pending switch keeps the seam through push, back and a whole-wall entrance / exit; crumbs return after the answer', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await walkShifts(page);
    });

    test('with reduced motion the fades leave the account seam in place too', async ({ mount, page }) => {
        await page.addInitScript(() => localStorage.setItem('reduce_motion_lattice', 'true'));
        await mountBravais(mount, page);
        await walkShifts(page);
    });
});
