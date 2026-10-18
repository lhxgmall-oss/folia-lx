# Folia-LX

Folia-LX 是 [Folia（chthollyphile/folia-major）](https://github.com/chthollyphile/folia-major) 的一个非官方分支：在 Folia 的桌面版里加入了一个名为 **“LX Music 聚合”** 的在线音乐平台，搜索、歌单、歌词、封面移植自 [LX Music 洛雪音乐（lyswhut/lx-music-desktop）](https://github.com/lyswhut/lx-music-desktop)，播放地址则由**你自己导入**的 LX 格式“自定义源”脚本提供。

原版 Folia 的说明保留在 [README.original.md](README.original.md)。

> **声明**
>
> - 本项目**不附带、不推荐、不分发任何音源脚本**。仓库与安装包里都没有自定义源；没有导入脚本时，只能搜索、看歌单和歌词，不能播放。
> - 本项目**仅供个人学习、研究编程技术使用**。请遵守你所在地的法律法规和各音乐平台的用户协议，支持正版音乐；因使用本项目及你自行导入的脚本产生的一切后果由使用者自行承担。
> - 本项目与 Folia、LX Music 的作者及任何音乐平台均无关联，问题请不要反馈到上游仓库。

## 有什么

- **聚合搜索**：一次搜索同时询问酷我（kw）、酷狗（kg）、QQ 音乐（tx）、网易云（wy）、咪咕（mg）五个子源，结果交错排列；也可以在设置里只搜其中一个子源。某个子源失败时只略过它。
- **歌单**：首页“推荐歌单”显示所选子源（或全部子源轮流）的热门歌单，点开按页读取歌曲。
- **歌词**：有逐字歌词的子源显示逐字歌词（LX 的 `lxlyric`，与 Folia 已支持的 awlrc 同一格式），否则显示普通 LRC，带翻译和罗马音。
- **封面**：搜索结果里缺封面的（酷我、酷狗）会在短时间内补取。
- **自定义源脚本**：兼容 LX Music 桌面版的自定义源 API（`globalThis.lx`，API 版本 2.0.0）：`lx.EVENT_NAMES`、`lx.on('request')`、`lx.send('inited' | 'updateAlert')`、`lx.request`、`lx.utils.crypto / buffer / zlib`，动作 `musicUrl`。
  - 脚本在独立的进程（Electron `utilityProcess`）里、一个只有 `lx` 和少量浏览器式全局对象的 `vm` 上下文中运行，没有 `require`、`process` 等 Node 能力。
  - 脚本保存在本机应用数据目录（Electron 的 `userData`，Windows 上在 `%APPDATA%` 下以应用名命名的文件夹）里的 `lx-user-api/` 中。
- **音质**：按播放器的音质设置（标准 / 高 / 无损 / Hi-Res 对应 `128k / 320k / flac / flac24bit`），或在 LX 设置里固定一档；脚本或歌曲没有这一档时自动降一档。
- **失败换源**：脚本取不到某首歌的地址时，按歌名、歌手、专辑、时长在脚本支持的其他子源里找同一首歌再试（移植自 LX 的 `findMusic`），可以在设置里关掉。

只在桌面版（Electron）里可用；网页版里这个平台显示为不可用。

## 导入自定义源脚本

1. 打开 **设置 → 连接与集成 → LX Music 音源**。
2. 二选一：
   - **从文件导入**：点“选择 .js 文件”，选你本地的脚本；
   - **从网址导入**：粘贴脚本的 http(s) 地址，点“导入”。
3. 第一个导入的脚本会自动“使用中”。状态行显示“脚本已就绪：kw / tx / …”即表示加载成功，列出的是这个脚本声明支持的子源。
4. 在首页的平台切换里选 **“LX Music 聚合”**，搜索并播放。
5. 同一页里还可以：切换使用哪个脚本、删除脚本、选择搜索的子源、选择音质、开关“失败时自动换源”。

脚本需要以 LX 自定义源的标准头注释开头，例如：

```js
/**
 * @name 我的源
 * @description ...
 * @version 1.0.0
 * @author ...
 */
```

脚本加载失败时，状态行会显示脚本抛出的错误；脚本的 `console` 输出写进 Folia 的运行日志（设置 → 开发者 → 运行日志，行首 `[LX] script:`）。

## 构建

需要 Node.js 24 或更高版本。

```bash
npm install

# 开发：Vite + Electron
npm run dev:electron

# 类型检查、单元测试
npm run typecheck
npm run test:unit

# 只构建网页资源（输出到 dist/）
npm run build

# 打包桌面安装包（在对应系统上执行；Windows 产出 NSIS 安装包到 release/）
npm run build:electron
```

修改了 `electron/lx/musicSdk/` 下的文件后，需要重新生成主进程用的打包文件：

```bash
npm run build:lx-sdk     # 生成 electron/lx/musicSdk/lxMusicSdk.cjs
```

### GitHub Actions

推送 `v*` 标签（例如 `git tag v0.1.0 && git push origin v0.1.0`）会触发 `.github/workflows/folia-lx-windows.yml`：在 Windows 上构建 NSIS 安装包，上传为构建产物，并附到同名的**草稿** Release。安装包的应用 ID 和产品名（`Folia LX`）与官方 Folia 不同，不会覆盖已安装的官方版本。上游原有的工作流保持不变，在分支仓库里可能因为缺少密钥而跳过或失败，可以按需在仓库设置里停用。

## 代码在哪

| 位置 | 内容 |
| --- | --- |
| `electron/lx/musicSdk/` | 从 lx-music-desktop 复制的 musicSdk 子集（`src/`），主进程版的请求与工具替身，打包产物 `lxMusicSdk.cjs`，第三方说明 `NOTICE.md` |
| `electron/lx/lxHttp.cjs` | 与 LX 所用 `needle` 行为一致的 http(s) 请求 |
| `electron/lx/userApi/` | 自定义源运行时 `scriptRuntime.cjs`、脚本进程 `scriptHost.cjs`、脚本与设置管理 `userApiManager.cjs` |
| `electron/lx/lxApiBridge.cjs` | 主进程入口：聚合搜索、歌单、歌词、封面、取地址与换源（IPC 通道 `lx-api-request`） |
| `electron/lx/lxDesktop.cjs`、`mediaCors.cjs` | Electron 接线：utilityProcess、文件选择、音频地址的 CORS |
| `src/services/onlineMusic/lx/` | 渲染进程的 Omni provider（`lxProvider.ts` 等），在 `providerRegistry.ts` 登记 |
| `src/components/modal/settings/pages/integration/lx/` | 设置页里的 LX 行 |
| `test/unit/lx/` | 单元测试 |

## 致谢与许可

- **Folia / folia-major** — © chthollyphile 与贡献者，[GNU AGPL-3.0](LICENSE)。Folia-LX 是它的修改版，整体同样以 **AGPL-3.0** 发布；按照 AGPL 第 13 条，如果你通过网络向他人提供修改后的版本，需要同时提供对应的源代码。
- **LX Music / lx-music-desktop** — © lyswhut 与贡献者，[Apache License 2.0](electron/lx/musicSdk/LICENSE-lx-music-desktop)。`electron/lx/musicSdk/src/` 下的文件复制自该项目并有少量改动（见 [NOTICE.md](electron/lx/musicSdk/NOTICE.md)）；自定义源 API 的行为依照其 `src/main/modules/userApi` 实现。Apache-2.0 的代码可以并入 AGPL-3.0 的作品。
- 接入第三方平台的方式参考了 [folia-qishui](https://github.com/2706521883-lgtm/folia-qishui)。
