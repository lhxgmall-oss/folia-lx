// dev/folium/sample-remote-ui/client.mjs
// The ordinary activation stays inert; remoteUi runs only with remote.ui opt-in.
export default function activate() {}

export function remoteUi(remote) {
    return remote.register({
        id: 'example', width: 280,
        mount(container, context) {
            const style = document.createElement('style');
            style.textContent = `
                .row {display:flex;align-items:center;gap:6px;height:32px;color:var(--folium-primary);font:12px system-ui}
                button,input {box-sizing:border-box;color:inherit;font:inherit;background:transparent;border:1px solid #8886;border-radius:999px;height:28px}
                button {display:flex;align-items:center;gap:5px;padding:0 10px;cursor:pointer}
                button:hover {background:#8883} button:focus-visible,input:focus-visible {outline:2px solid currentColor;outline-offset:-2px}
                input {width:142px;padding:0 10px} .count {border-radius:999px;background:#8884;padding:0 4px}
            `;
            const row = document.createElement('div'); row.className = 'row';
            const input = document.createElement('input'); input.placeholder = '模组自己的输入框'; input.ariaLabel = '示例输入';
            const button = document.createElement('button'); button.type = 'button'; button.ariaLabel = '示例点赞';
            const label = document.createElement('span'); label.textContent = '赞';
            const count = document.createElement('span'); count.className = 'count'; count.textContent = '0';
            button.append(label, count);
            let alive = true;
            button.onclick = () => void context.run(async () => {
                const next = await remote.rpc.call('increment');
                if (alive) count.textContent = String(next);
            });
            const update = () => { button.title = context.getSnapshot().title ?? '示例点赞'; };
            const unsubscribe = context.subscribe(update); update();
            row.append(button, input); container.append(style, row);
            void remote.icon('thumbs-up', { size: 14 }).then((icon) => { if (alive && icon) label.replaceWith(icon); });
            return () => { alive = false; unsubscribe(); };
        },
    }).unregister;
}
