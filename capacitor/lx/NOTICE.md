# Folia-LX 安卓版的 LX 核心（第三方代码说明）

`capacitor/lx/` 是 Folia-LX 写的“安卓适配层”：把桌面版主进程里的 LX 代码原样搬进安卓 WebView 运行，只替换
Node / Electron 提供的部分（文件、网络、加密、压缩、脚本进程、文件对话框）。

- 运行的 LX 代码就是桌面版那一份：`electron/lx/musicSdk/src/`（复制自
  [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)，Apache License 2.0，
  许可证全文见 `electron/lx/musicSdk/LICENSE-lx-music-desktop`，改动见 `electron/lx/musicSdk/NOTICE.md`），
  以及按 lx-music-desktop `src/main/modules/userApi` 行为编写的 `electron/lx/userApi/`、`lxApiBridge.cjs`、`myLists/`。
- [lyswhut/lx-music-mobile](https://github.com/lyswhut/lx-music-mobile)（Apache License 2.0）的自定义源运行方式
  （Java + QuickJS，`android/app/src/main/java/cn/toside/music/mobile/userApi/` 与
  `android/app/src/main/assets/script/user-api-preload.js`）只作为参考阅读，**本目录没有复制其中的代码**。
  Folia-LX 安卓版改为在 Web Worker 里运行脚本（`scriptWorker.js`），API 与桌面版一致（`lx.env` 为 `desktop`，
  `aes-128-ecb` 按 Node 默认做 PKCS#7 填充；lx-music-mobile 的 `env` 是 `mobile`、ECB 不填充）。
- `shims/crypto.js` 用 [node-forge](https://github.com/digitalbazaar/forge)（BSD-3-Clause / GPL-2.0 双许可，此处按 BSD）
  做哈希与 AES；`shims/zlib.js` 用 [pako](https://github.com/nodeca/pako)（MIT）；Buffer 用
  [buffer](https://github.com/feross/buffer)（MIT）。

生成文件 `src/services/onlineMusic/lx/android/generated/*.js` 由 `npm run build:lx-android` 打包，包含以上代码。
本目录不含任何“自定义源”脚本。
