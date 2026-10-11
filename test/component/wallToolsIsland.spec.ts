import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { IslandProbeCall } from '../../dev/probes/wallToolsIsland/islandProbeApi';
import '../../dev/probes/wallToolsIsland/islandProbeApi';

// test/component/wallToolsIsland.spec.ts
// 墙面工具面板的队列浮岛（components/wall/WallToolsQueueIsland，探针 wallToolsIsland：就地的 WallToolsSurface + 改播放 store
// 的假宿主，200 首）：快捷排「队列」格开合与偏好记忆、打开时滚到当前歌曲、点歌播放（面板不收）、悬停动作、手柄拖拽（含越过
// 虚拟窗口的长距离自动滚动、Esc 撤拖拽）、键盘（Enter / ↑↓ / Alt+↑↓ / Delete）、清空两步确认、存为本地歌单的内联输入、
// 私人 FM 下隐藏（偏好保留）、外部舞台只读、Esc 分层、点浮岛不收面板，以及暗色 / 日光两张截图（写进 test-results，不是基线）。

/** 在页面里拿探针接口跑一段（函数源码连同接口一起送进页面；只用于不闭包外部变量的短箭头函数）。 */
const probe = <T>(page: Page, run: (api: NonNullable<Window['__wallToolsIslandProbe']>) => T) => (
    page.evaluate(`(${run.toString()})(window.__wallToolsIslandProbe)`) as Promise<T>
);
const calls = (page: Page, kind?: IslandProbeCall['kind']) => page.evaluate(
    callKind => window.__wallToolsIslandProbe!.calls().filter(call => !callKind || call.kind === callKind),
    kind,
);
const queueIds = (page: Page) => page.evaluate(() => window.__wallToolsIslandProbe!.queueIds());

const tools = (page: Page) => page.getByRole('button', { name: 'Wall tools', exact: true });
const panel = (page: Page) => page.getByRole('menu', { name: 'Wall tools', exact: true });
const queueQuick = (page: Page) => panel(page).locator('[data-wall-tools-quick="queue"]');
const island = (page: Page) => page.getByRole('region', { name: 'Play queue', exact: true });
const row = (page: Page, index: number) => island(page).locator(`[data-queue-index="${index}"]`);
const song = (page: Page, index: number) => row(page, index).locator('.lattice-tools-island-song');
const live = (page: Page) => island(page).locator('[data-queue-island-live]');

/** 在 fixtures 的种子脚本之后再写几项存储（store 在模块 import 时读）。 */
const seedStorage = (page: Page, entries: [string, string][]) => page.addInitScript(pairs => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
}, entries);

const mountProbe = async (mount: (id: string) => Promise<Locator>, page: Page, { islandOpen = true } = {}) => {
    if (islandOpen) await seedStorage(page, [['wall_tools_queue_island_open', 'true']]);
    await mount('wallToolsIsland');
    await expect.poll(() => page.evaluate(() => window.__wallToolsIslandProbe?.queueIds().length ?? 0)).toBe(200);
};

const openPanel = async (page: Page) => {
    await tools(page).click();
    await expect(panel(page)).toBeVisible();
};

/** 行在列表视口里的位置（相对列表顶，px）；不在 DOM 里时 null。 */
const rowOffset = (page: Page, index: number) => page.evaluate(i => {
    const list = document.querySelector('.lattice-tools-island-scroll');
    const node = document.querySelector(`[data-queue-index="${i}"]`);
    if (!list || !node) return null;
    return node.getBoundingClientRect().top - list.getBoundingClientRect().top;
}, index);

test.describe('wall tools queue island', () => {
    test('the queue cell opens and closes the island, and the choice is remembered', async ({ mount, page }) => {
        await mountProbe(mount, page, { islandOpen: false });
        await openPanel(page);
        await expect(queueQuick(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(queueQuick(page)).toHaveAttribute('aria-description', 'Show the play queue');
        await expect(island(page)).toHaveCount(0);

        await queueQuick(page).click();
        await expect(island(page)).toBeVisible();
        await expect(panel(page)).toBeVisible();
        await expect(queueQuick(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(queueQuick(page)).toHaveAttribute('aria-controls', 'probe-wall-tools-queue-island');
        await expect(island(page)).toHaveAttribute('id', 'probe-wall-tools-queue-island');
        await expect(island(page).locator('.lattice-tools-island-heading')).toHaveText('Play queue · 200 songs');
        expect(await page.evaluate(() => localStorage.getItem('wall_tools_queue_island_open'))).toBe('true');

        // 浮岛视觉上在面板上方，且两者都在按钮之上。
        const islandBox = (await island(page).boundingBox())!;
        const panelBox = (await panel(page).boundingBox())!;
        expect(islandBox.y + islandBox.height).toBeLessThanOrEqual(panelBox.y + 1);
        // 头部 36 + 8 行 × 40（等出场的缩放放完再量）。
        await expect.poll(async () => Math.round((await island(page).boundingBox())!.height)).toBe(36 + 8 * 40);

        // 收起面板：浮岛一起走；再打开：浮岛照旧展开。
        await tools(page).click();
        await expect(panel(page)).toHaveCount(0);
        await expect(island(page)).toHaveCount(0);
        await openPanel(page);
        await expect(island(page)).toBeVisible();

        await queueQuick(page).click();
        await expect(island(page)).toHaveCount(0);
        await expect(queueQuick(page)).toHaveAttribute('aria-expanded', 'false');
        expect(await probe(page, api => api.islandPreference())).toBe(false);
    });

    test('opening centres the playing song, and a song change scrolls it into view', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await probe(page, api => api.seed({ currentIndex: 120 }));
        await openPanel(page);
        await expect(song(page, 120)).toHaveAttribute('aria-current', 'true');
        const listHeight = await island(page).locator('.lattice-tools-island-scroll').evaluate(node => node.clientHeight);
        await expect.poll(async () => Math.abs(((await rowOffset(page, 120)) ?? -999) + 20 - listHeight / 2)).toBeLessThan(24);

        // 切到窗口外的一首：smart 平滑滚动把它带进视口。
        await probe(page, api => api.setCurrent(10));
        await expect.poll(async () => {
            const offset = await rowOffset(page, 10);
            return offset !== null && offset >= -1 && offset <= listHeight - 39;
        }).toBe(true);
        await expect(song(page, 10)).toHaveAttribute('aria-current', 'true');
    });

    test('clicking a song plays it without closing anything; the unavailable song is tagged', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        await expect(row(page, 3).locator('.lattice-tools-island-tag')).toBeVisible();
        await song(page, 5).click();
        expect(await calls(page, 'playQueueSong')).toEqual([{ kind: 'playQueueSong', id: 'island-5' }]);
        await expect(song(page, 5)).toHaveAttribute('aria-current', 'true');
        await expect(row(page, 5)).toHaveClass(/\bis-current\b/);
        await expect(panel(page)).toBeVisible();
        await expect(island(page)).toBeVisible();
    });

    test('hovering a row shows play next, move to end and remove', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const actions = row(page, 4).locator('.lattice-tools-island-row-actions');
        await expect(actions).toBeHidden();
        await row(page, 4).hover();
        await expect(actions).toBeVisible();
        await row(page, 4).getByRole('button', { name: 'Play next', exact: true }).click();
        expect(await calls(page, 'playQueueSongNext')).toEqual([{ kind: 'playQueueSongNext', index: 4 }]);
        expect((await queueIds(page)).slice(0, 3)).toEqual(['island-0', 'island-4', 'island-1']);

        await row(page, 2).hover();
        await row(page, 2).getByRole('button', { name: 'Move to end', exact: true }).click();
        expect((await queueIds(page)).at(-1)).toBe('island-1');

        await row(page, 2).hover();
        await row(page, 2).getByRole('button', { name: 'Remove from queue', exact: true }).click();
        expect(await queueIds(page)).toHaveLength(199);
        await expect(island(page).locator('.lattice-tools-island-heading')).toHaveText('Play queue · 199 songs');
    });

    test('dragging a handle reorders: a short move lands on the row under the pointer', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const handle = row(page, 1).locator('.lattice-tools-island-handle');
        const box = (await handle.boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        // 4px 以内不算拖。
        await page.mouse.move(x, y + 3);
        await expect(island(page).locator('.lattice-tools-island-ghost')).toHaveCount(0);
        for (let step = 1; step <= 6; step++) {
            await page.mouse.move(x, y + step * 20);
            await page.waitForTimeout(20);
        }
        await expect(island(page).locator('.lattice-tools-island-ghost')).toBeVisible();
        await expect(row(page, 1)).toHaveClass(/\bis-drag-source\b/);
        // 拖到第 4 行的位置：2..4 上移一行。
        await expect.poll(() => row(page, 3).evaluate(node => getComputedStyle(node).transform)).toContain('matrix');
        await page.mouse.up();
        expect(await calls(page, 'moveQueueSong')).toEqual([{ kind: 'moveQueueSong', from: 1, to: 4 }]);
        expect((await queueIds(page)).slice(0, 6)).toEqual(['island-0', 'island-2', 'island-3', 'island-4', 'island-1', 'island-5']);
        await expect(island(page).locator('.lattice-tools-island-ghost')).toHaveCount(0);
        await expect(live(page)).toHaveText('Moved to position 5');
        await expect(panel(page)).toBeVisible();
    });

    test('a long drag auto-scrolls past the virtual window and still drops the right song', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const list = island(page).locator('.lattice-tools-island-scroll');
        const listBox = (await list.boundingBox())!;
        const handle = row(page, 2).locator('.lattice-tools-island-handle');
        const box = (await handle.boundingBox())!;
        const x = box.x + box.width / 2;
        await page.mouse.move(x, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(x, box.y + 30, { steps: 4 });
        // 指针压到列表下边缘：自动滚动（指针不动也继续滚）。
        await page.mouse.move(x, listBox.y + listBox.height - 4, { steps: 6 });
        await expect.poll(() => list.evaluate(node => node.scrollTop), { timeout: 10_000 }).toBeGreaterThan(40 * 40);
        // 第 2 行早已滚出虚拟窗口被卸掉，指针捕获在列表外框上，拖拽照常进行。
        await expect(row(page, 2)).toHaveCount(0);
        // 回到列表中部停下，松手。
        await page.mouse.move(x, listBox.y + listBox.height / 2, { steps: 4 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        const moves = await calls(page, 'moveQueueSong');
        expect(moves).toHaveLength(1);
        const { from, to } = moves[0];
        expect(from).toBe(2);
        expect(to!).toBeGreaterThan(40);
        const ids = await queueIds(page);
        expect(ids[to!]).toBe('island-2');
        expect(ids).toHaveLength(200);
        await expect(song(page, to!).locator('.lattice-tools-island-name')).toHaveText('Island Track 2');
    });

    test('Escape during a drag only cancels the drag', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const box = (await row(page, 1).locator('.lattice-tools-island-handle').boundingBox())!;
        await page.mouse.move(box.x + 5, box.y + 10);
        await page.mouse.down();
        await page.mouse.move(box.x + 5, box.y + 90, { steps: 6 });
        await expect(island(page).locator('.lattice-tools-island-ghost')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(island(page).locator('.lattice-tools-island-ghost')).toHaveCount(0);
        await page.mouse.up();
        expect(await calls(page, 'moveQueueSong')).toEqual([]);
        await expect(panel(page)).toBeVisible();
        await expect(island(page)).toBeVisible();
    });

    test('the keyboard plays, moves focus, reorders with Alt+arrows and removes with Delete', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        await song(page, 4).focus();
        await page.keyboard.press('ArrowDown');
        await expect(song(page, 5)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(song(page, 4)).toBeFocused();

        await page.keyboard.press('Alt+ArrowDown');
        expect(await calls(page, 'moveQueueSong')).toEqual([{ kind: 'moveQueueSong', from: 4, to: 5 }]);
        expect((await queueIds(page))[5]).toBe('island-4');
        await expect(song(page, 5)).toBeFocused();
        await expect(live(page)).toHaveText('Moved to position 6');
        await page.keyboard.press('Alt+ArrowUp');
        expect((await queueIds(page))[4]).toBe('island-4');
        await expect(song(page, 4)).toBeFocused();
        await expect(live(page)).toHaveText('Moved to position 5');

        await page.keyboard.press('Enter');
        expect(await calls(page, 'playQueueSong')).toEqual([{ kind: 'playQueueSong', id: 'island-4' }]);

        await page.keyboard.press('Delete');
        expect(await calls(page, 'removeQueueSong')).toEqual([{ kind: 'removeQueueSong', index: 4 }]);
        expect((await queueIds(page))[4]).toBe('island-5');
        await expect(song(page, 4)).toBeFocused();
        await expect(panel(page)).toBeVisible();
    });

    test('clearing takes a second click within three seconds', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const clear = island(page).locator('[data-queue-island-action="clear"]');
        await expect(clear).toHaveAccessibleName('Clear the queue');
        await clear.click();
        await expect(clear).toHaveAccessibleName('Click again to clear the queue');
        await expect(live(page)).toHaveText('Click again to clear the queue');
        expect(await calls(page, 'clearQueue')).toEqual([]);
        // 3 秒不点就复原。
        await expect(clear).toHaveAccessibleName('Clear the queue', { timeout: 5_000 });

        await clear.click();
        await clear.click();
        expect(await calls(page, 'clearQueue')).toHaveLength(1);
        await expect(island(page).getByText('Queue is empty')).toBeVisible();
        await expect(island(page).locator('.lattice-tools-island-heading')).toHaveText('Play queue · 0 songs');
        await expect(island(page)).toBeVisible();
    });

    test('saving the queue as a local playlist uses an inline name field', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        // 在线队列不能存。
        await expect(island(page).locator('[data-queue-island-action="save"]')).toHaveCount(0);
        await probe(page, api => api.seed({ count: 12, local: true }));
        const save = island(page).locator('[data-queue-island-action="save"]');
        await expect(save).toHaveAccessibleName('Save as local playlist');

        await save.click();
        const input = island(page).getByRole('textbox', { name: 'Enter playlist name' });
        await expect(input).toBeFocused();
        // 打字（含会被墙当快捷键的字符）全部落进输入框。
        await page.keyboard.type('Night: mix s');
        await expect(input).toHaveValue('Night: mix s');
        await page.keyboard.press('Enter');
        expect(await calls(page, 'saveQueueAsPlaylist')).toEqual([{ kind: 'saveQueueAsPlaylist', name: 'Night: mix s' }]);
        await expect(input).toHaveCount(0);
        await expect(save).toBeFocused();

        // 失败：输入框留着，可以再试。
        await probe(page, api => api.failNextSave());
        await save.click();
        await page.keyboard.type('Again');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await calls(page, 'saveQueueAsPlaylist')).length).toBe(2);
        await expect(island(page).getByRole('textbox', { name: 'Enter playlist name' })).toHaveValue('Again');
    });

    test('Personal FM hides the island and disables the cell, keeping the preference', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        await expect(island(page)).toBeVisible();
        await probe(page, api => api.setFmMode(true));
        await expect(island(page)).toHaveCount(0);
        await expect(queueQuick(page)).toBeDisabled();
        await expect(queueQuick(page)).toHaveAttribute('aria-description', 'Personal FM has no queue to edit');
        expect(await probe(page, api => api.islandPreference())).toBe(true);
        await probe(page, api => api.setFmMode(false));
        await expect(island(page)).toBeVisible();
    });

    test('an external Stage leaves the island read-only: songs play, nothing edits', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await probe(page, api => api.setStage(true));
        await openPanel(page);
        await expect(island(page)).toHaveAttribute('data-queue-readonly', 'true');
        await expect(island(page).locator('.lattice-tools-island-handle')).toHaveCount(0);
        await expect(island(page).locator('[data-queue-island-action="clear"]')).toHaveCount(0);
        await row(page, 2).hover();
        await expect(row(page, 2).locator('[data-queue-row-action]')).toHaveCount(0);
        await song(page, 2).click();
        expect(await calls(page, 'playQueueSong')).toEqual([{ kind: 'playQueueSong', id: 'island-2' }]);
        await song(page, 2).focus();
        await page.keyboard.press('Alt+ArrowDown');
        await page.keyboard.press('Delete');
        expect(await calls(page, 'moveQueueSong')).toEqual([]);
        expect(await calls(page, 'removeQueueSong')).toEqual([]);
    });

    test('Escape peels one layer at a time; clicks inside the island keep the panel', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await probe(page, api => api.seed({ count: 30, local: true }));
        await openPanel(page);

        // 点浮岛（空白头部、行）不收面板。
        await island(page).locator('.lattice-tools-island-heading').click();
        await expect(panel(page)).toBeVisible();

        // 内联输入：Esc 只撤输入。
        await island(page).locator('[data-queue-island-action="save"]').click();
        await expect(island(page).getByRole('textbox')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(island(page).getByRole('textbox')).toHaveCount(0);
        await expect(panel(page)).toBeVisible();

        // 清空待确认：Esc 只撤确认。
        const clear = island(page).locator('[data-queue-island-action="clear"]');
        await clear.click();
        await expect(clear).toHaveAccessibleName('Click again to clear the queue');
        await page.keyboard.press('Escape');
        await expect(clear).toHaveAccessibleName('Clear the queue');
        await expect(panel(page)).toBeVisible();

        // 没有可撤的了：Esc 收起面板与浮岛，偏好不变。
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        await expect(island(page)).toHaveCount(0);
        expect(await probe(page, api => api.islandPreference())).toBe(true);

        // 点外面也一起收起。
        await openPanel(page);
        await expect(island(page)).toBeVisible();
        await page.locator('[data-probe-outside]').click();
        await expect(panel(page)).toHaveCount(0);
        await expect(island(page)).toHaveCount(0);
    });

    test('dark and daylight screenshots', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await probe(page, api => api.seed({ currentIndex: 6 }));
        await openPanel(page);
        await row(page, 5).hover();
        await page.waitForTimeout(300);
        const root = page.locator('.lattice-tools');
        const box = (await island(page).boundingBox())!;
        const clip = { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: page.viewportSize()!.height - box.y + 24 };
        await page.screenshot({ path: 'test-results/wall-tools-island-dark.png', clip });
        await probe(page, api => api.setDaylight(true));
        await expect(root).toHaveClass(/\bis-daylight\b/);
        await page.waitForTimeout(300);
        await page.screenshot({ path: 'test-results/wall-tools-island-daylight.png', clip });

        // 窄屏：浮岛贴满两侧 16px。
        await page.setViewportSize({ width: 390, height: 760 });
        await expect.poll(async () => Math.round((await island(page).boundingBox())!.width)).toBe(390 - 32);
        await page.screenshot({ path: 'test-results/wall-tools-island-mobile.png' });
    });
});
