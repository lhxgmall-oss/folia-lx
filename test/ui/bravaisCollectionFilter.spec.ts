import { expect, test, type Page } from '@playwright/test';
import { installBaseState, localImportFixture, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/bravaisCollectionFilter.spec.ts
// bravais 集合页的过滤在真实 App 里的接缝（设计稿 §7.6）：命令面板的内联过滤框画在缝里的锚点上（不是浮在页面中间）、
// 过滤让墙退化为有限拼贴、框里按 ↓ 把键盘焦点交给墙上的 rank 0 并收起框（过滤词保留）、墙上的 Esc 阶梯先清键盘焦点
// 再清过滤词。组件探针里没有命令面板，这一条只能在完整应用里验。

const filterBox = (page: Page) => page.getByTestId('command-palette-filter');
const filterInput = (page: Page) => filterBox(page).getByRole('combobox');
const rendererSwitch = (page: Page) => page.getByTestId('dev-library-renderer-switch');
const collection = (page: Page) => page.locator('[data-library-surface="collection"][data-library-renderer="bravais"]');

/** 网格首页导入本地曲库、打开「全部歌曲」，再用开发浮层把打开着的集合换到 bravais。 */
const openAllSongsInBravais = async (page: Page) => {
    await installBaseState(page, { neteaseMode: 'guest', localImportFixture });
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    await rendererSwitch(page).locator('[data-renderer="bravais"]').click();
    await expect(collection(page)).toHaveCount(1);
    await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
};

/** 注册比首屏晚一拍：反复敲到框真的出现（与 gridCommandFilter 同一个做法）。 */
const typeUntilFilterOpens = async (page: Page, key: string) => {
    await expect.poll(async () => {
        await page.keyboard.press(key);
        return filterBox(page).count();
    }).toBeGreaterThan(0);
};

test('the filter box opens inside the seam, narrows the wall to a finite collage, and arrow down hands the keyboard to rank 0', async ({ page }) => {
    await openAllSongsInBravais(page);
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'infinite');

    await typeUntilFilterOpens(page, 'm');
    await expect(page.locator('[data-bravais-filter-host] [data-testid="command-palette-filter"]')).toBeVisible();
    await expect(filterInput(page)).toBeFocused();
    await filterInput(page).fill('midnight');
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'finite');
    // 有限拼贴不重复：全部歌曲里只有一首 Midnight Train。
    await expect.poll(() => page.locator('.bravais-tile[data-library-entry]').count()).toBe(1);

    await page.keyboard.press('ArrowDown');
    await expect(filterBox(page)).toHaveCount(0);
    const focused = page.locator('.bravais-tile[data-bravais-focused]');
    await expect(focused).toHaveCount(1);
    await expect(focused.locator('strong')).toHaveAttribute('aria-label', 'Midnight Train');
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'finite');
    await expect(page.locator('[data-bravais-seam-filter="active"]')).toContainText('midnight');

    // 墙上的 Esc 阶梯：先清键盘焦点，再清过滤词（翻回无限拼贴），不离开集合。
    await page.keyboard.press('Escape');
    await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'infinite');
    await expect(collection(page)).toHaveCount(1);
});
