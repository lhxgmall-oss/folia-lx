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
- **歌单**：首页“电台”页签显示所选子源（或全部子源轮流）的热门歌单，点开按页读取歌曲。
- **导入洛雪歌单**：把 LX Music 桌面版「我的列表」导出的 `.lxmc` / `.json` 文件导入，每个列表成为首页“歌单”页签里的一个歌单（见下文“导入洛雪歌单”）。
- **歌词**：有逐字歌词的子源显示逐字歌词（LX 的 `lxlyric`，与 Folia 已支持的 awlrc 同一格式），否则显示普通 LRC，带翻译和罗马音。
- **封面**：搜索结果里缺封面的（酷我、酷狗）会在短时间内补取。
- **自定义源脚本**：兼容 LX Music 桌面版的自定义源 API（`globalThis.lx`，API 版本 2.0.0）：`lx.EVENT_NAMES`、`lx.on('request')`、`lx.send('inited' | 'updateAlert')`、`lx.request`、`lx.utils.crypto / buffer / zlib`，动作 `musicUrl`。
  - 脚本在独立的进程（Electron `utilityProcess`）里、一个只有 `lx` 和少量浏览器式全局对象的 `vm` 上下文中运行，没有 `require`、`process` 等 Node 能力。
  - 脚本保存在本机应用数据目录（Electron 的 `userData`，Windows 上在 `%APPDATA%` 下以应用名命名的文件夹）里的 `lx-user-api/` 中。
- **音质**：按播放器的音质设置（标准 / 高 / 无损 / Hi-Res 对应 `128k / 320k / flac / flac24bit`），或在 LX 设置里固定一档；脚本或歌曲没有这一档时自动降一档。
- **失败换源**：脚本取不到某首歌的地址时，按歌名、歌手、专辑、时长在脚本支持的其他子源里找同一首歌再试（移植自 LX 的 `findMusic`），可以在设置里关掉。

桌面版（Electron）和安卓版（见下文“安卓版”）里可用；网页版里这个平台显示为不可用。

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

## 导入洛雪歌单

在 LX Music 桌面版里导出：

- 全部列表：**设置 → 备份与恢复 → 导出列表**，得到 `lx_list.lxmc`；
- 单个列表：在 **我的列表** 里右键某个列表 → **导出**，得到 `lx_list_part_<列表名>.lxmc`；
- “导出全部数据”（`lx_datas_v2.lxmc`）也可以，只取其中的列表，设置不导入。

在 Folia-LX 里：**设置 → 连接与集成 → LX Music 音源 →“导入洛雪歌单（.lxmc / .json）”**，选上面导出的文件。提示条显示“已导入 N 个歌单、M 首歌（跳过 K 首本地歌曲）”。然后在首页平台切换里选 **“LX Music 聚合”**，打开 **“歌单”** 页签。

- 支持 LX 2.x（`playList_v2` / `playListPart_v2` / `allData_v2`）和 1.x 及更早（`playList` / `playListPart` / `allData`）的文件，gzip 压缩的 `.lxmc` 和明文 `.json` 都可以。
- 同一个列表（LX 里的列表 id 相同）再导入一次会替换原来的，不会多出一份；在同一设置页里每个已导入的列表后面有删除按钮。
- 本地歌曲（LX 的“本地”来源）不导入；没有在线歌曲的列表（比如空的“试听列表”）不导入。
- 歌曲用上面导入的自定义源脚本播放，所以要先导入并启用脚本。
- 导出文件里很多歌没有封面（LX 常把 `picUrl` 留空）。导入后在后台补全：每次 3–4 首，按歌曲的子源用 musicSdk 的 `getPic` 取封面，取到的写回保存的歌曲；设置页这一行显示“正在补全封面 n/N”，完成后首页歌单刷新。取不到的留空，本次运行不再重试（下次启动打开列表时会再试一次）。歌单封面用第一首有封面的歌的封面。
- 导入的列表保存在应用数据目录的 `lx-my-lists/` 里。

## 安卓版

Folia-LX 也有安卓 APK（`Folia-LX-<版本>-android.apk`，和 Windows 安装包放在同一个 Release 里）。界面、歌词和视觉效果就是 Folia 本身；LX 的部分（聚合搜索、歌单、歌词、封面、自定义源脚本、导入洛雪歌单、失败换源）和桌面版是同一份代码。

### 安装和使用

1. 在手机上下载 APK，点开安装。第一次安装时系统会提示“禁止安装未知来源应用”：按提示进入设置，允许当前浏览器（或文件管理器）“安装未知应用”，再回来点“安装”。部分手机还会弹出“风险提示 / 纯净模式”，选“继续安装”。
2. 打开 Folia LX，默认平台就是 **“LX Music 聚合”**。
3. 导入自定义源脚本：**设置 → 连接与集成 → LX Music 音源**：
   - **从文件导入**：点“选择 .js 文件”，在系统文件选择器里找到脚本（通常在“下载”目录）；
   - **从网址导入**：粘贴脚本的 http(s) 地址，点“导入”。
   状态行显示“脚本已就绪：kw / tx / …”就可以播放了。
4. 导入洛雪歌单：同一页点 **“导入洛雪歌单（.lxmc / .json）”**，在文件选择器里选从 LX Music 导出的 `.lxmc` 文件（先把文件传到手机上，例如“下载”目录）。导入后在首页“歌单”页签里。

### 和桌面版的区别

- 只有 LX Music 聚合可用。酷狗、QQ 音乐、波点、YouTube Music、Spotify 依赖桌面主进程，安卓版不显示；网易云只有在构建时设置了 `VITE_NETEASE_API_BASE` 才显示（默认的 APK 没有设置）。
- 自定义源脚本运行在一个 Web Worker 里：没有 DOM、没有 `fetch` / `XMLHttpRequest`，网络只有 `lx.request`（走安卓原生 HTTP）。API 与桌面版相同（`lx.env` 为 `desktop`）。
- 脚本、设置和导入的歌单保存在应用私有目录的 `folia-lx/` 下（卸载应用会一起删除）。
- 播放：脚本给出的音频地址和五个平台的封面由原生层代取并加上 CORS 头（相当于桌面版的 `mediaCors.cjs`），所以 Folia 的频谱和取色照常工作。没有锁屏 / 通知栏播放控制；切到后台后，系统可能会暂停或结束应用。
- 本地音乐、桌面歌词、壁纸、OBS 等桌面功能在安卓版里不可用。

### 签名

APK 用固定密钥签名（PKCS12，别名 `folia-lx`），密钥放在 GitHub 仓库的 Actions secrets：`ANDROID_KEYSTORE_BASE64`（keystore 的 base64）和 `ANDROID_KEYSTORE_PASSWORD`，这样新版本可以直接覆盖安装旧版本。旧提交历史里仍有这把密钥，仓库公开前需要换新密钥并清理历史。应用 ID 为 `top.izuna.foliamajor.lx`。

### 代码

| 位置 | 内容 |
| --- | --- |
| `capacitor.config.json`、`android/` | Capacitor 8 安卓工程（`npx cap add android` 生成后修改） |
| `android/app/src/main/java/top/izuna/foliamajor/lx/` | `LxNativePlugin`（原生 HTTP，OkHttp）、`LxWebViewClient` + `LxMediaPolicy`（音频与封面的 CORS 代理） |
| `capacitor/lx/` | 安卓适配层：`androidCore.js`（把桌面版桥接接到 WebView 里）、`scriptWorker.js`（脚本 Worker）、`lxHttpMobile.js`、`shims/`（fs / path / crypto / zlib / vm 替身），见 `capacitor/lx/NOTICE.md` |
| `src/services/onlineMusic/lx/android/` | `lxAndroidBridge.ts`（原生 HTTP、文件保存、文件选择、Worker），`generated/`（`npm run build:lx-android` 的产物） |
| `src/utils/androidApp.ts` | 判断是否安卓版（构建变量 `VITE_FOLIA_TARGET=android`） |

### 构建 APK

需要 Node.js 24、JDK 21、Android SDK（compileSdk 36）。

```bash
npm ci
npm run build:lx-android        # 改了 electron/lx/ 或 capacitor/lx/ 之后
npm run build:android           # VITE_FOLIA_TARGET=android vite build && cap sync android
cd android && ./gradlew assembleRelease   # 产物：android/app/build/outputs/apk/release/app-release.apk
```

推送 `v*` 标签时，`.github/workflows/folia-lx-android.yml` 在 Ubuntu 上构建 APK，附到同名的草稿 Release（与 Windows 工作流共用）；失败时把日志推到 `ci-logs` 分支的 `android/` 目录。

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

推送 `v*` 标签（例如 `git tag v0.1.0 && git push origin v0.1.0`）会触发 `.github/workflows/folia-lx-windows.yml` 和 `folia-lx-android.yml`（见上文“安卓版”；Windows 现在只在手动运行或推 `v*-win` 标签时构建）。Windows 工作流：在 Windows 上构建 NSIS 安装包，上传为构建产物，并附到同名的**草稿** Release。安装包的应用 ID 和产品名（`Folia LX`）与官方 Folia 不同，不会覆盖已安装的官方版本。上游原有的工作流已从本仓库删除，以节省 Actions 分钟数。

## 代码在哪

| 位置 | 内容 |
| --- | --- |
| `electron/lx/musicSdk/` | 从 lx-music-desktop 复制的 musicSdk 子集（`src/`），主进程版的请求与工具替身，打包产物 `lxMusicSdk.cjs`，第三方说明 `NOTICE.md` |
| `electron/lx/lxHttp.cjs` | 与 LX 所用 `needle` 行为一致的 http(s) 请求 |
| `electron/lx/userApi/` | 自定义源运行时 `scriptRuntime.cjs`、脚本进程 `scriptHost.cjs`、脚本与设置管理 `userApiManager.cjs` |
| `electron/lx/lxApiBridge.cjs` | 主进程入口：聚合搜索、歌单、歌词、封面、取地址与换源（IPC 通道 `lx-api-request`） |
| `electron/lx/lxDesktop.cjs`、`mediaCors.cjs` | Electron 接线：utilityProcess、文件选择、音频地址的 CORS |
| `electron/lx/myLists/` | 洛雪歌单导入：读 LX 导出文件 `lxListFile.cjs`，保存导入的列表 `lxMyLists.cjs` |
| `src/services/onlineMusic/lx/` | 渲染进程的 Omni provider（`lxProvider.ts` 等，导入的歌单在 `lxMyLists.ts`），在 `providerRegistry.ts` 登记 |
| `src/components/modal/settings/pages/integration/lx/` | 设置页里的 LX 行 |
| `test/unit/lx/` | 单元测试 |

## 致谢与许可

- **Folia / folia-major** — © chthollyphile 与贡献者，[GNU AGPL-3.0](LICENSE)。Folia-LX 是它的修改版，整体同样以 **AGPL-3.0** 发布；按照 AGPL 第 13 条，如果你通过网络向他人提供修改后的版本，需要同时提供对应的源代码。
- **LX Music / lx-music-desktop** — © lyswhut 与贡献者，[Apache License 2.0](electron/lx/musicSdk/LICENSE-lx-music-desktop)。`electron/lx/musicSdk/src/` 下的文件复制自该项目并有少量改动（见 [NOTICE.md](electron/lx/musicSdk/NOTICE.md)）；自定义源 API 的行为依照其 `src/main/modules/userApi` 实现。Apache-2.0 的代码可以并入 AGPL-3.0 的作品。
- 接入第三方平台的方式参考了 [folia-qishui](https://github.com/2706521883-lgtm/folia-qishui)。
