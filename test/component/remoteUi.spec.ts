import { test, expect } from './fixtures';

// test/component/remoteUi.spec.ts
// The companion is fixed at 450×230 in Electron; test that actual boundary.
test.use({ viewport: { width: 450, height: 230 } });

for (const daylight of [false, true]) {
    test(`remote components append without moving native controls (${daylight ? 'light' : 'dark'})`, async ({ mount, page }) => {
        await mount('remoteUi');
        await expect(page.getByTitle('Next', { exact: true })).toBeVisible();
        if (daylight) await page.evaluate(() => window.remoteUiProbe.daylight());
        await expect(page.getByTitle('Next', { exact: true }).locator('xpath=../../..')).toHaveCSS('transform', 'none');
        const readNative = () => page.evaluate(() => Array.from(document.querySelectorAll('main button')).map((button) => ({ html: button.outerHTML, rect: [button.getBoundingClientRect().x, button.getBoundingClientRect().y, button.getBoundingClientRect().width, button.getBoundingClientRect().height] })));
        const before = await readNative();
        await page.evaluate(() => window.remoteUiProbe.enable());
        await expect(page.getByRole('button', { name: '示例点赞', exact: true })).toBeVisible();
        expect(await readNative()).toEqual(before);
        const slot = await page.locator('[data-folium-slot="remote-controls"]').boundingBox();
        expect(slot!.y + slot!.height).toBeLessThanOrEqual(230);
        for (const button of before) expect(button.rect[1] + button.rect[3]).toBeLessThanOrEqual(slot!.y);
        await page.evaluate(() => window.remoteUiProbe.disable());
        await expect(page.locator('[data-folium-slot="remote-controls"]')).toHaveCount(0);
        expect(await readNative()).toEqual(before);
    });
}

test('actual sample handles click/Enter/Space and typing without native commands', async ({ mount, page }) => {
    await mount('remoteUi'); await expect(page.getByTitle('Next', { exact: true })).toBeVisible();
    await page.evaluate(() => window.remoteUiProbe.enable());
    const button = page.getByRole('button', { name: '示例点赞', exact: true });
    await button.click(); await button.press('Enter'); await button.press('Space');
    await expect(button).toContainText('3');
    await page.getByRole('textbox', { name: '示例输入' }).fill('component input');
    await page.getByRole('textbox', { name: '示例输入' }).press('Enter');
    expect(await page.evaluate(() => window.remoteUiProbe.log)).toEqual(['increment', 'increment', 'increment']);
    await page.getByTitle('Next', { exact: true }).click();
    expect(await page.evaluate(() => window.remoteUiProbe.log)).toContain('next');
});

test('a broken mount leaves other components and native controls working', async ({ mount, page }) => {
    await mount('remoteUi'); await expect(page.getByTitle('Next', { exact: true })).toBeVisible();
    await page.evaluate(() => { window.remoteUiProbe.enable(); window.remoteUiProbe.fail(); });
    await page.getByRole('button', { name: '示例点赞', exact: true }).click();
    await expect(page.getByRole('button', { name: '示例点赞', exact: true })).toContainText('1');
    await page.getByTitle('Next', { exact: true }).click();
    expect(await page.evaluate(() => window.remoteUiProbe.log)).toEqual(['increment', 'next']);
});

test('the appended area stays off the recording and transparent-control panels', async ({ mount, page }) => {
    await mount('remoteUi'); await expect(page.getByTitle('Next', { exact: true })).toBeVisible();
    await page.evaluate(() => window.remoteUiProbe.enable());
    await page.getByTitle('Video export', { exact: true }).click();
    await expect(page.locator('[data-folium-slot="remote-controls"]')).toBeHidden();
    await page.getByTitle('Back', { exact: true }).click({ force: true });
    await expect(page.locator('[data-folium-slot="remote-controls"]')).toBeVisible();
    await page.getByTitle('Transparent controls', { exact: true }).click();
    await expect(page.locator('[data-folium-slot="remote-controls"]')).toBeHidden();
});


test('adding or removing another component preserves typed input and local count', async ({ mount, page }) => {
    await mount('remoteUi'); await expect(page.getByTitle('Next', { exact: true })).toBeVisible();
    await page.evaluate(() => window.remoteUiProbe.enable());
    const button = page.getByRole('button', { name: '示例点赞', exact: true });
    const input = page.getByRole('textbox', { name: '示例输入' });
    await button.click(); await input.fill('keep my input');
    await page.evaluate(() => window.remoteUiProbe.fail());
    await expect(input).toHaveValue('keep my input'); await expect(button).toContainText('1');
    await page.evaluate(() => window.remoteUiProbe.clearFailure());
    await expect(input).toHaveValue('keep my input'); await expect(button).toContainText('1');
});
