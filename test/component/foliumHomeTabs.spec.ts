import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/foliumHomeTabs.spec.ts
// Real Home adapters in both suites: owned page lifecycle, full-size layout, and ShadowRoot input isolation.
// 另外：页头原生页签走首页 surface 的页签句柄（Bravais 收起搜索框）、集合 / 目录图开着时打开的页面画在最上面、
// 页内 Tab 只在越过首尾时才绕回。

type HomeTabWindow = Window & {
    __homeTabTest: { mounts: number; cleanups: number; unregister: () => void };
};

/** Bravais 首页缝里的全局搜索框开没开；open 给了就先把它设成这个值。 */
const bravaisSearchOpen = (page: Page, open?: boolean) => page.evaluate(async value => {
    const storePath = '/src/library/suites/bravais/bravaisHomeUiStore.ts';
    const { setBravaisSearchOpen, useBravaisHomeUiStore } = await import(storePath);
    if (value !== undefined) setBravaisSearchOpen(value);
    return useBravaisHomeUiStore.getState().searchOpen as boolean;
}, open);

async function registerPage(page: Page) {
    await page.evaluate(async () => {
        const registryPath = '/src/mods/folium/registries/homeTabs.ts';
        const { homeTabsRegistry } = await import(registryPath);
        const state = { mounts: 0, cleanups: 0, unregister: () => {} };
        (window as unknown as HomeTabWindow).__homeTabTest = state;
        state.unregister = homeTabsRegistry.register('home-test', {
            id: 'messages', label: { en: 'Home Messages', 'zh-CN': '首页私信' },
            mount(container: HTMLElement) {
                state.mounts++;
                const heading = document.createElement('h2'); heading.textContent = 'Owned message page';
                const input = document.createElement('textarea'); input.setAttribute('aria-label', 'Message draft');
                const button = document.createElement('button'); button.textContent = 'Draft action';
                container.style.display = 'grid'; container.style.gridTemplateColumns = '240px 1fr';
                container.append(heading, input, button);
                return () => { state.cleanups++; };
            },
        }).unregister;
    });
}

for (const suite of ['grid', 'bravais'] as const) {
    test(`${suite}: contributed navigation opens a full page, isolates input, and returns to native tabs`, async ({ mount, page }) => {
        await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
        await mount('homeBehavior');
        await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
        await page.evaluate(value => window.__homeProbe!.setSuite(value), suite);
        await registerPage(page);
        const nativeRoot = suite === 'grid' ? page.locator('[data-ponder-page-scope="grid-page"]') : page.locator('[data-bravais-seam]');
        const entry = suite === 'grid' ? nativeRoot.getByRole('button', { name: 'Home Messages', exact: true })
            : nativeRoot.locator('[data-bravais-tab="home-test:messages"]');
        await entry.click();
        const homePage = page.locator('[data-folium-home-page="home-test:messages"]');
        await expect(homePage.getByText('Owned message page')).toBeVisible();
        const host = homePage.locator('[data-folium-kind="home-tab"]');
        const box = (await host.boundingBox())!;
        expect(box.width).toBeGreaterThan(1000);
        expect(box.height).toBeGreaterThan(800);
        // 桌面版自绘标题栏的拖拽区占窗口最上面 32px（AppShell 的 h-8）：返回按钮与页签整块都要在它下面才点得到。
        for (const control of [homePage.getByRole('button', { name: 'Back to library' }), homePage.getByRole('navigation')]) {
            expect((await control.boundingBox())!.y).toBeGreaterThanOrEqual(32);
        }
        const nativeTab = await page.evaluate(() => window.__homeProbe!.tab());
        const draft = homePage.getByRole('textbox', { name: 'Message draft' });
        await draft.fill('Hello ');
        await draft.press('End');
        await page.keyboard.type('world');
        await draft.press('Enter');
        await page.keyboard.type('Second line');
        await expect(draft).toHaveValue('Hello world\nSecond line');
        await draft.press('Control+Enter');
        await draft.press('Tab');
        await expect(homePage.getByRole('button', { name: 'Draft action' })).toBeFocused();
        expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe(nativeTab);
        await expect(homePage).toBeVisible();
        // Native navigation still wins when it reselects the same source tab.
        await page.evaluate(async key => {
            const factoryPath = '/src/components/command-palette/commandFactories.ts';
            const searchPath = '/src/stores/useSearchNavigationStore.ts';
            const { createHomeTabCommand } = await import(factoryPath);
            const { useSearchNavigationStore } = await import(searchPath);
            createHomeTabCommand(key, '', '', []).execute('', { navigation: {
                setHomeViewTab: useSearchNavigationStore.getState().setHomeViewTab, navigateToHome: () => {},
            } });
        }, nativeTab);
        await expect(homePage).toHaveCount(0);
        await entry.click();
        await expect(homePage.getByText('Owned message page')).toBeVisible();
        // 页头的原生页签走首页 surface 的页签句柄，而不是直接写 homeViewTab：Bravais 选页签时收起缝里的搜索框，
        // 这一步不能被绕过（直接写 homeViewTab 时搜索框会一直开着）。
        if (suite === 'bravais') expect(await bravaisSearchOpen(page, true)).toBe(true);
        await homePage.getByRole('button', { name: 'Albums', exact: true }).click();
        await expect(homePage).toHaveCount(0);
        expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe('albums');
        if (suite === 'bravais') expect(await bravaisSearchOpen(page)).toBe(false);
        expect(await page.evaluate(() => {
            const state = (window as unknown as HomeTabWindow).__homeTabTest;
            return state.mounts === state.cleanups;
        })).toBe(true);
    });
}

test('Grid Tab and Shift+Tab reach contributed pages and then leave native cycling for page focus', async ({ mount, page }) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
    await registerPage(page);
    const nativeRoot = page.locator('[data-ponder-page-scope="grid-page"]');
    await nativeRoot.getByRole('button', { name: 'Playlists', exact: true }).click();
    const homePage = page.locator('[data-folium-home-page="home-test:messages"]');
    for (let step = 0; step < 8 && await homePage.count() === 0; step++) await page.keyboard.press('Tab');
    await expect(homePage.getByRole('button', { name: 'Home Messages', exact: true })).toBeFocused();
    const nativeTab = await page.evaluate(() => window.__homeProbe!.tab());
    await page.keyboard.press('Tab');
    await expect(homePage.getByRole('textbox', { name: 'Message draft' })).toBeFocused();
    expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe(nativeTab);
    await homePage.getByRole('button', { name: 'Playlists', exact: true }).click();
    await expect(homePage).toHaveCount(0);
    await page.keyboard.press('Shift+Tab');
    await expect(homePage.getByRole('button', { name: 'Home Messages', exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe('playlist');
});

test('page focus wraps inside the page through the ShadowRoot and returns to the opener on close', async ({ mount, page }) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
    await registerPage(page);
    const entry = page.locator('[data-ponder-page-scope="grid-page"]').getByRole('button', { name: 'Home Messages', exact: true });
    await entry.click();
    const homePage = page.locator('[data-folium-home-page="home-test:messages"]');
    const back = homePage.getByRole('button', { name: 'Back to library' });
    const action = homePage.getByRole('button', { name: 'Draft action' });
    await expect(homePage.getByRole('button', { name: 'Home Messages', exact: true })).toBeFocused();
    // 模组 ShadowRoot 里的最后一个控件按 Tab 回到页头第一个，页头第一个按 Shift+Tab 回到它；焦点不漏到 inert 的原生首页。
    await action.focus();
    await page.keyboard.press('Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(action).toBeFocused();
    // 模组把焦点放在页面中段 tabindex=-1 的元素上（常见的焦点管理写法）：Tab 照浏览器的顺序走到紧随其后的控件，
    // 不跳回页首；Shift+Tab 也照常回到它前面的页签。
    const heading = homePage.getByRole('heading', { name: 'Owned message page' });
    const focusHeading = () => heading.evaluate(element => { (element as HTMLElement).tabIndex = -1; (element as HTMLElement).focus(); });
    await focusHeading();
    await page.keyboard.press('Tab');
    await expect(homePage.getByRole('textbox', { name: 'Message draft' })).toBeFocused();
    await focusHeading();
    await page.keyboard.press('Shift+Tab');
    await expect(homePage.getByRole('button', { name: 'Home Messages', exact: true })).toBeFocused();
    await back.click();
    await expect(homePage).toHaveCount(0);
    await expect(entry).toBeFocused();
});

test('grid: a page opened over an open collection or the directory map is drawn on top of it', async ({ mount, page }) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
    await registerPage(page);
    const homePage = page.locator('[data-folium-home-page="home-test:messages"]');
    const back = homePage.getByRole('button', { name: 'Back to library' });
    // 与 ui.openHomeTab 一样从模组那边打开（不经首页上的页签）：集合 / 目录图开着时也能开，它们不会被关掉。
    const openFromMod = () => page.evaluate(async () => {
        const registryPath = '/src/mods/folium/registries/homeTabs.ts';
        const { selectFoliumHomeTab } = await import(registryPath);
        return selectFoliumHomeTab('home-test:messages') as boolean;
    });
    // 页面是不是画在最上面。inert 的子树不参与命中测试（HTML 规范按 pointer-events: none 处理），盖在页面上面的
    // 集合层也会被「点穿」、照样点得到返回按钮，所以先摘掉原生首页那一层的 inert 再量，量完放回。
    const pageOnTop = () => back.evaluate(button => {
        const section = button.closest('[data-folium-home-page]')!;
        const layer = section.parentElement!.querySelector<HTMLElement>(':scope > [inert]')!;
        const rect = button.getBoundingClientRect();
        layer.inert = false;
        try {
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return Boolean(hit && section.contains(hit));
        } finally {
            layer.inert = true;
        }
    });

    await expect.poll(() => page.evaluate(() => window.__homeProbe!.open('owned'))).toBe(true);
    const collection = page.locator('[data-library-surface="collection"]');
    await expect(collection).toBeVisible();
    expect(await openFromMod()).toBe(true);
    await expect(homePage.getByText('Owned message page')).toBeVisible();
    expect(await pageOnTop()).toBe(true);
    await expect(homePage.getByRole('button', { name: 'Home Messages', exact: true })).toBeFocused();
    await back.click();
    await expect(homePage).toHaveCount(0);
    await expect(collection).toBeVisible();
    expect(await page.evaluate(() => window.__homeProbe!.stack())).toEqual(['Owned Playlist']);

    await page.evaluate(() => window.__homeProbe!.closeCollection());
    await expect(collection).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__homeProbe!.openMap())).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__homeProbe!.isMapOpen())).toBe(true);
    expect(await openFromMod()).toBe(true);
    await expect(homePage.getByText('Owned message page')).toBeVisible();
    expect(await pageOnTop()).toBe(true);
    await back.click();
    await expect(homePage).toHaveCount(0);
    expect(await page.evaluate(() => window.__homeProbe!.isMapOpen())).toBe(true);
});

test('bravais: F6 includes contributed pages and aria-selected follows the open page', async ({ mount, page }) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    const stage = page.locator('[data-library-stage="bravais"]');
    const settled = () => expect(stage).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
    await expect(stage).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await settled();
    await registerPage(page);
    const seam = page.locator('[data-bravais-seam]');
    const entry = seam.locator('[data-bravais-tab="home-test:messages"]');
    const selected = seam.locator('[data-bravais-tab][aria-selected="true"]');
    await expect(entry).toHaveAttribute('aria-selected', 'false');
    await expect(seam.locator('[data-bravais-tab="playlist"]')).toHaveAttribute('aria-selected', 'true');
    // Shift+F6 from the first native tab wraps to the contributed page at the end of the row.
    await page.keyboard.press('Shift+F6');
    const homePage = page.locator('[data-folium-home-page="home-test:messages"]');
    await expect(homePage.getByText('Owned message page')).toBeVisible();
    await expect(entry).toHaveAttribute('aria-selected', 'true');
    await expect(selected).toHaveCount(1);
    expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe('playlist');
    await homePage.getByRole('button', { name: 'Back to library' }).click();
    await expect(homePage).toHaveCount(0);
    await expect(entry).toHaveAttribute('aria-selected', 'false');
    await expect(seam.locator('[data-bravais-tab="playlist"]')).toHaveAttribute('aria-selected', 'true');
    await expect(selected).toHaveCount(1);
    // F6 from the last native tab continues into the contributed page as well.
    await seam.locator('[data-bravais-tab="navidrome"]').click();
    await expect(stage).toHaveAttribute('data-bravais-layer', 'home:navidrome');
    await settled();
    await page.keyboard.press('F6');
    await expect(homePage.getByText('Owned message page')).toBeVisible();
    await expect(entry).toHaveAttribute('aria-selected', 'true');
    await expect(seam.locator('[data-bravais-tab="navidrome"]')).toHaveAttribute('aria-selected', 'false');
    expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe('navidrome');
});

test('the Home shell does not re-render for native tab changes while no page is open', async ({ mount, page }) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
    type CountWindow = Window & { __renderCounts?: Record<string, number> };
    // 一个窗口里 Home 渲染了几次（src/dev/renderCount 的探针；arm 之后才计数）。write 为空时是对照窗口。
    const homeRenders = (tab: string | null) => page.evaluate(async key => {
        const searchPath = '/src/stores/useSearchNavigationStore.ts';
        const { useSearchNavigationStore } = await import(searchPath);
        (window as CountWindow).__renderCounts = {};
        if (key) useSearchNavigationStore.getState().setHomeViewTab(key);
        await new Promise(resolve => setTimeout(resolve, 400));
        return (window as CountWindow).__renderCounts?.Home ?? 0;
    }, tab);
    // 先等首页静下来（账户、本地曲库种子的异步更新会经首页模型让 Home 重渲染，与要量的写入无关）。
    await expect.poll(() => homeRenders(null), { timeout: 15_000 }).toBe(0);
    expect(await homeRenders('albums')).toBe(0);
    expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe('albums');
    // 装了模组、页面没开时也一样：外壳只订阅注册表条目与选中态。
    await registerPage(page);
    await expect.poll(() => homeRenders(null), { timeout: 15_000 }).toBe(0);
    expect(await homeRenders('local')).toBe(0);
});

test('an open page survives suite changes and disappears with owner teardown, including safe re-enabling', async ({ mount, page }) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
    await registerPage(page);
    await page.getByRole('button', { name: 'Home Messages', exact: true }).click();
    const homePage = page.locator('[data-folium-home-page]');
    await expect(homePage.getByText('Owned message page')).toBeVisible();
    const count = await page.evaluate(() => (window as unknown as HomeTabWindow).__homeTabTest.mounts);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(page.locator('[data-library-stage="bravais"]')).toBeAttached();
    await expect(homePage.getByText('Owned message page')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as HomeTabWindow).__homeTabTest.mounts)).toBe(count);
    await page.evaluate(() => (window as unknown as HomeTabWindow).__homeTabTest.unregister());
    await expect(homePage).toHaveCount(0);
    expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe('playlist');
    expect(await page.evaluate(() => {
        const state = (window as unknown as HomeTabWindow).__homeTabTest; return state.mounts === state.cleanups;
    })).toBe(true);
    await expect(page.locator('[data-bravais-tab="home-test:messages"]')).toHaveCount(0);
    await registerPage(page);
    await page.locator('[data-bravais-tab="home-test:messages"]').click();
    await expect(homePage.getByText('Owned message page')).toBeVisible();
    await homePage.getByRole('button', { name: 'Back to library' }).click();
    await expect(homePage).toHaveCount(0);
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-active', 'true');
});
