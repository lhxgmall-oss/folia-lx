// src/utils/buildProvenance.ts
// 构建来源：是否本仓库 GitHub Actions 构建的官方版本、来源仓库与 commit。
// 三个值都由 vite define 在构建期注入（dev/build/buildIdentity.mjs）；单测等没有 define 的环境按非官方处理。

/** 版本信息行末尾固定英文的非官方标记：用户会把整行复制进 issue，triage 按它识别，所以不随界面语言变化。 */
export const UNOFFICIAL_BUILD_TAG = 'Unofficial build';

export const isOfficialBuild = (): boolean => typeof __OFFICIAL_BUILD__ !== 'undefined' && __OFFICIAL_BUILD__ === true;

/** 诊断报告里的 build 行：`official (owner/repo@commit)` 或 `unofficial (...)`。 */
export const formatBuildProvenance = (): string => {
    const repo = typeof __BUILD_REPO__ === 'undefined' ? 'unknown' : __BUILD_REPO__;
    const commit = typeof __BUILD_COMMIT__ === 'undefined' ? 'dev' : __BUILD_COMMIT__;
    return `${isOfficialBuild() ? 'official' : 'unofficial'} (${repo}@${commit})`;
};
