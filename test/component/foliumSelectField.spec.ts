import { expect, test } from './fixtures';

// test/component/foliumSelectField.spec.ts
// 模组 select 参数换成宿主 CustomSelect（#485）后真实浏览器里的几件事：compact 触发按钮与文本框等高、
// 等宽；触发按钮的可访问名是「字段名 当前值」；鼠标按下选项时焦点移到选项上（focusin）不会提前收起菜单；
// 拦 mousedown 的容器（命令面板）里点别处能收起；Escape 只关菜单，外层收不到。
// 见 dev/probes/foliumSelectField.probe.tsx。

test.describe('Folium select field', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('the compact trigger stands level with the text field of the same form', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const text = page.locator('[data-folium-entry] input[type="text"]');
        const select = page.getByRole('button', { name: 'Codec' });
        await expect(select).toHaveText('HEVC');
        // 同原生 select 的「名字 + 值」：读屏不打开菜单也能听到当前值。
        await expect(select).toHaveAccessibleName('Codec HEVC');

        const textBox = (await text.boundingBox())!;
        const selectBox = (await select.boundingBox())!;
        expect(Math.abs(selectBox.height - textBox.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(selectBox.width - textBox.width)).toBeLessThanOrEqual(1);

        // 底色与描边取自表单 token，和文本框一致。
        const look = (selector: string) => page.locator(selector).first().evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, border: style.borderTopColor };
        });
        expect(await look('[data-folium-entry] button[aria-haspopup="listbox"]'))
            .toEqual(await look('[data-folium-entry] input[type="text"]'));
    });

    test('a mouse pick lands: pressing an option moves focus onto it without closing the menu first', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const select = page.getByRole('button', { name: 'Codec' });
        await select.click();
        const listbox = page.getByRole('listbox', { name: 'Codec' });
        const option = listbox.getByRole('option', { name: 'H.264', exact: true });

        // Chromium 在按下时把焦点交给选项按钮并触发 focusin；菜单不能因此收起，否则松开时点不到选项。
        await option.hover();
        await page.mouse.down();
        await expect(option).toBeFocused();
        await expect(listbox).toBeVisible();
        await page.mouse.up();

        await expect(listbox).toHaveCount(0);
        await expect(select).toHaveText('H.264');
        await expect(select).toHaveAccessibleName('Codec H.264');
        await expect(select).toHaveAttribute('aria-expanded', 'false');
    });

    test('a press elsewhere closes the menu inside a container that stops mousedown', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const select = page.getByRole('button', { name: 'Codec' });
        await select.click();
        await expect(page.getByRole('listbox', { name: 'Codec' })).toBeVisible();

        await page.locator('[data-probe-elsewhere]').click();
        await expect(page.getByRole('listbox', { name: 'Codec' })).toHaveCount(0);
        await expect(select).toHaveAttribute('aria-expanded', 'false');
    });

    test('Escape closes only the menu and the keyboard picks an option', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const select = page.getByRole('button', { name: 'Codec' });
        const outer = page.locator('[data-probe-outer-escapes]');

        await select.click();
        await page.keyboard.press('Escape');
        await expect(select).toHaveAttribute('aria-expanded', 'false');
        await expect(outer).toHaveAttribute('data-probe-outer-escapes', '0');
        await expect(select).toBeFocused();

        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('listbox', { name: 'Codec' })).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(select).toHaveText('ProRes 4444');
        await expect(select).toHaveAccessibleName('Codec ProRes 4444');
        await expect(select).toHaveAttribute('aria-expanded', 'false');

        await page.keyboard.press('Escape');
        await expect(outer).toHaveAttribute('data-probe-outer-escapes', '1');
    });
});
