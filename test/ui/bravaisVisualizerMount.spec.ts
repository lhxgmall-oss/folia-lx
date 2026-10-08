import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/bravaisVisualizerMount.spec.ts
// bravais 透光档与播放页 visualizer 的挂载（B6b③，plan「实色档卸载 visualizer」的验证）：
// - 没存过档位时默认实色，首页停稳后 visualizer 卸载；
// - 实色档停在首页时 DOM 里没有 visualizer（canvas 也没有）；
// - 切到部分透明后 visualizer 重新挂上；
// - 从实色首页回播放页 visualizer 正常出现；
// - 打开设置弹窗时 visualizer 在（首页被盖住，播放页露出来）；
// - grid 首页照旧挂着 visualizer（TUI 与切换的完整回归在 libraryRendererSwitch）；
// - 左上角隐藏式返回在首页根层只在有歌时出现，点它回播放页后 visualizer 挂上（没有歌时播放页是空的，深色主题下就是「黑屏」）。
// 遮挡由 bravais 的 stage 在 effect 里报告，App 在首页完全显示 300ms 后才卸载，所以断言一律轮询。

test.use({ screenshot: 'only-on-failure' });

const surface = (page: Page) => page.getByTestId('player-visual-surface');
/** visualizer 挂着没有：它是播放页视觉层里唯一的子树。 */
const visualizerMounted = (page: Page) => surface(page).evaluate(element => element.childElementCount > 0);

/** `look` 为 null 时不种透光档位，走 store 的默认档（实色）。 */
const bootHome = async (page: Page, suite: 'bravais' | 'grid', look: 'solid' | 'partial' | null) => {
    await installBaseState(page, { neteaseMode: 'guest' });
    await page.addInitScript(([suiteId, wallLook]) => {
        localStorage.setItem('library_suite', suiteId);
        if (wallLook) localStorage.setItem('library_wall_look', wallLook);
        // 打开设置弹窗要这两个桥接方法（与 homeCardPosition 同一份最小桥）。
        Object.assign((window as Window & { electron?: Record<string, unknown> }).electron ?? {}, {
            getSettings: async () => ({}),
            getCacheDirectory: async () => ({ path: '', isDefault: true }),
        });
    }, [suite, look] as const);
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
};

const setWallLook = (page: Page, look: 'solid' | 'partial' | 'clear') => page.evaluate(async (next) => {
    const path = '/src/stores/useLibraryWallLookStore.ts';
    const { useLibraryWallLookStore } = await import(path);
    useLibraryWallLookStore.getState().setLook(next);
}, look);

const setView = (page: Page, view: 'home' | 'player') => page.evaluate(async (next) => {
    const path = '/src/stores/useAppViewStore.ts';
    const { useAppViewStore } = await import(path);
    useAppViewStore.getState().setView(next);
}, view);

test('with no stored look the bravais home defaults to solid and unmounts the visualizer', async ({ page }) => {
    await bootHome(page, 'bravais', null);
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-look', 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);
    await expect(surface(page).locator('canvas')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('library_wall_look'))).toBeNull();
});

test('the solid bravais home unmounts the visualizer; see-through looks, the player and settings bring it back', async ({ page }) => {
    await bootHome(page, 'bravais', 'solid');
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-look', 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);
    await expect(surface(page).locator('canvas')).toHaveCount(0);

    // 部分透明：窗里要看得到 visualizer，立即重挂。
    await setWallLook(page, 'partial');
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-look', 'partial');
    await expect.poll(() => visualizerMounted(page)).toBe(true);

    // 回到实色：首页完全显示且 stage 报遮挡后再卸载。
    await setWallLook(page, 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);

    // 从实色首页去播放页：立即挂上。
    await setView(page, 'player');
    await expect.poll(() => visualizerMounted(page)).toBe(true);
    await setView(page, 'home');
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-look', 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);

    // 设置弹窗盖住首页：播放页露出来，visualizer 在。
    await page.evaluate(async () => {
        const path = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(path);
        useSettingsModalStore.getState().openSettings('options');
    });
    await expect.poll(() => visualizerMounted(page)).toBe(true);
});

test('the grid home keeps the visualizer mounted whatever the bravais look preference says', async ({ page }) => {
    await bootHome(page, 'grid', 'solid');
    await expect(page.getByRole('button', { name: 'Playlists', exact: true })).toBeVisible();
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await visualizerMounted(page)).toBe(true);
});

// 用户实测「首页点左上角返回回到黑屏」：那是没有歌时的空播放页（visualizer 照常挂上，只是没有可画的东西），不是挂载链路的问题。
// 现在首页根层没有歌时不画这颗按钮；有歌时它回到播放页，实色档卸载过的 visualizer 立即重新挂上。
test('the bravais back button at the home root only shows with a song and brings the visualizer back on the player', async ({ page }) => {
    await bootHome(page, 'bravais', 'solid');
    const stage = page.locator('[data-library-stage="bravais"]');
    await expect(stage).toHaveAttribute('data-bravais-look', 'solid');
    await expect(stage).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 15_000 });
    await expect.poll(() => visualizerMounted(page)).toBe(false);
    const back = stage.locator('.lattice-back');
    await expect(back).toHaveCount(0);

    await page.evaluate(async () => {
        const path = '/src/stores/usePlaybackStore.ts';
        const { usePlaybackStore } = await import(/* @vite-ignore */ path);
        const song = { id: 5001, name: 'Back Seed', artists: [{ id: 1, name: 'Seed Artist' }], album: { id: 1, name: 'Seed Album' }, durationMs: 180_000 };
        usePlaybackStore.setState({ playQueue: [song], currentSong: song });
    });
    await expect(back).toHaveAccessibleName('Back to the player');
    await page.mouse.move(700, 500);
    await page.mouse.move(60, 60);
    await expect(back).toHaveClass(/\bis-revealed\b/);
    await back.click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#player');
    await expect.poll(() => visualizerMounted(page)).toBe(true);
});
