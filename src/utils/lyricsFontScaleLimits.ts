import { IS_ANDROID_BUILD } from './androidApp';

// src/utils/lyricsFontScaleLimits.ts
// 歌词字号缩放的范围与默认值。手机屏幕窄，桌面版的字号放上去一行只剩一两个词、还互相叠在一起，
// 所以安卓版默认更小，滑块也允许调得更小；电脑版不变。
export const LYRICS_FONT_SCALE_MIN = IS_ANDROID_BUILD ? 0.5 : 0.85;
export const LYRICS_FONT_SCALE_MAX = 1.4;
export const LYRICS_FONT_SCALE_DEFAULT = IS_ANDROID_BUILD ? 0.7 : 1;

export const clampLyricsFontScale = (value: number): number =>
    Math.min(LYRICS_FONT_SCALE_MAX, Math.max(LYRICS_FONT_SCALE_MIN, value));
