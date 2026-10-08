import { CalendarDays, Cloud, Heart, ListMusic, Radio, Shuffle, Star, type LucideIcon } from 'lucide-react';
import type { LibraryHomeSpecialKind } from '../../core/model/homeSpecialCards';

// src/library/suites/bravais/bravaisSpecialIcons.ts
// 特殊集合的小图标：墙上磁贴的类型标签（强调色底 + 图标）与缝里的直达入口用同一个，两处看得出是同一张。

export const BRAVAIS_SPECIAL_ICONS: Record<LibraryHomeSpecialKind, LucideIcon> = {
    liked: Heart,
    cloud: Cloud,
    'personal-fm': Radio,
    daily: CalendarDays,
    'all-songs': ListMusic,
    'local-favorites': Heart,
    'navidrome-random': Shuffle,
    'navidrome-favorites': Star,
};
