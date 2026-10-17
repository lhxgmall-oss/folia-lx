import type { MediaId, ProviderUser } from '../../../types/onlineMusic';
import { requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqAccount.ts
// QQ 音乐账号的两样补充资料（qq-music-api 3.3.3）：会员等级，和喜欢清单没读完整时逐首确认的红心。

// `/user/vip` 的三级会员换成 ProviderUser.vipType：免费 0、绿钻 1、超级会员 2。判断不出来（unknown）不填，不当成免费。
const QQ_VIP_TYPES: Readonly<Record<string, number>> = { free: 0, green: 1, super: 2 };

/** 补上会员等级。多一次请求；读不到只是少了等级，不影响登录。 */
export const withQqVipType = async (user: ProviderUser): Promise<ProviderUser> => {
    try {
        const response = await requestQq<any>('user_vip');
        const level = String(response?.vipLevel);
        const vipType = Object.hasOwn(QQ_VIP_TYPES, level) ? QQ_VIP_TYPES[level] : undefined;
        console.info('[QQProvider] vip-level', { level: vipType === undefined ? 'unknown' : level });
        return vipType === undefined ? user : { ...user, vipType };
    } catch (error) {
        console.warn('[QQProvider] vip-level:failed', error);
        return user;
    }
};

/**
 * 这几首歌是不是红心（一次一个请求，按 songmid 问）。只在喜欢清单没读完整时才被问到（account/likedChecks.ts）。
 * 后端说 `unknown` 的、和没有 songmid 的歌（mediaId 退成了数字 id）都不回答，不当成「没喜欢」。
 */
export const areQqSongsLiked = async (ids: MediaId[]): Promise<Record<string, boolean>> => {
    const mids = [...new Set(ids.map(id => String(id).trim()).filter(id => id && !/^\d+$/.test(id)))];
    if (mids.length === 0) return {};
    const response = await requestQq<any>('user_subscription_status', { type: 'song', ids: mids.join(',') });
    const answer: Record<string, boolean> = {};
    for (const item of Array.isArray(response?.items) ? response.items : []) {
        const id = String(item?.id ?? '');
        if (!mids.includes(id)) continue;
        if (item.status === 'subscribed') answer[id] = true;
        else if (item.status === 'not-subscribed') answer[id] = false;
    }
    return answer;
};
