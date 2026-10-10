import { expect, test, type Page } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/helpCommunity.spec.ts
// 帮助页「加入社区」那一排的 QQ 自助交流群：胶囊上写着群号，点一下复制群号并短暂显示「已复制」；
// 剪贴板 API 被拒（内嵌浏览器之类）时退回 execCommand，照样复制成功。

const QQ_GROUP_NUMBER = '372521584';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const openHelp = async (page: Page, { denyClipboardApi = false } = {}) => {
    await page.addInitScript(([version, guideKey, deny]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
        if (deny) {
            navigator.clipboard.writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
        }
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY, denyClipboardApi] as const);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await waitForAppMounted(page);
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('help');
    });
};

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test('the QQ group capsule shows the number and copies it', async ({ page }) => {
    await openHelp(page);
    await page.evaluate(() => navigator.clipboard.writeText(''));

    const capsule = page.getByRole('button', { name: `QQ self-help group: ${QQ_GROUP_NUMBER}` });
    await expect(capsule).toBeVisible();
    await expect(capsule).toHaveAttribute('title', 'Click to copy the group number');
    await capsule.click();

    await expect(page.getByRole('button', { name: 'Group number copied' })).toBeVisible();
    expect(await readClipboard(page)).toBe(QQ_GROUP_NUMBER);
    // 约 1.8s 后变回群号。
    await expect(capsule).toBeVisible({ timeout: 4000 });
});

test('copying falls back to execCommand when the clipboard API is refused', async ({ page }) => {
    await openHelp(page, { denyClipboardApi: true });

    await page.getByRole('button', { name: `QQ self-help group: ${QQ_GROUP_NUMBER}` }).click();

    await expect(page.getByRole('button', { name: 'Group number copied' })).toBeVisible();
    expect(await readClipboard(page)).toBe(QQ_GROUP_NUMBER);
});
