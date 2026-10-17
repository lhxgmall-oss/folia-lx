import type { Theme } from '../../../types';

// src/components/panelTab/controls/panelPictures.ts
// When the player panel's small pictures of lyric styles and backgrounds are made, and in what
// colours. The panel lies over the playing page, and making an image draws a second copy of a
// style as large as the window: measured on a production build with a song playing, one such copy
// of 绘光, 凝彩 or 商籁 is a long task of 90 to 110 ms in the middle of the lyrics. So while a song
// plays, images are made only for a picker that is open. Until a picture has an image it shows its glyph.
//
// The pictures are drawn in one theme of their own, never in the page's. An image is kept under
// everything it shows (pictureImages), the theme too, and with AI themes every song has a new one:
// following the page, every picker opened after a song change made all its pictures again, about
// a second each. In this theme each picture is made once while the app runs.

/** The pictures' own colours: the same in a light and a dark page, whatever theme the song has. */
export const PANEL_PICTURE_THEME: Readonly<Theme> = Object.freeze({
    name: 'Panel pictures',
    backgroundColor: '#1f1a3d',
    primaryColor: '#fff4e0',
    accentColor: '#ff7eb6',
    secondaryColor: '#7fd6e6',
    fontStyle: 'sans',
    animationIntensity: 'normal',
});

/** The pictures' theme is a dark one. */
export const PANEL_PICTURE_DAYLIGHT = false;

type PanelState = {
    /** A song is playing. */
    playing: boolean;
    /** One of the two rows has its picker open. */
    pickerOpen: boolean;
};

/** Whether the panel's pictures may make images now. */
export const panelMakesImages = ({ playing, pickerOpen }: PanelState): boolean => pickerOpen || !playing;
