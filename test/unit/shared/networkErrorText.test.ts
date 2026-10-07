import { describe, expect, it } from 'vitest';
import { isConnectionResetMessage, redactIpAddresses } from '../../../shared/networkErrorText.mjs';

// test/unit/shared/networkErrorText.test.ts

const cjs = require('../../../shared/networkErrorText.cjs') as {
    isConnectionResetMessage: (text: unknown) => boolean;
    redactIpAddresses: (text: unknown) => string;
};

const REDACTIONS: Array<[string, string]> = [
    ['connect ECONNREFUSED 127.0.0.1:7890', 'connect ECONNREFUSED <ipv4-loopback>:7890'],
    ['connect ETIMEDOUT 59.111.181.35:443', 'connect ETIMEDOUT <ipv4-public>:443'],
    ['connect ETIMEDOUT 192.168.1.20:443', 'connect ETIMEDOUT <ipv4-private>:443'],
    ['connect ETIMEDOUT 100.80.1.2:443', 'connect ETIMEDOUT <ipv4-cgnat>:443'],
    ['connect ECONNRESET 198.18.0.12:443', 'connect ECONNRESET <ipv4-fake-ip>:443'],
    ['connect ECONNREFUSED ::1:7890', 'connect ECONNREFUSED <ipv6-loopback>:7890'],
    ['connect ETIMEDOUT 2408:8756:c52:1aec:0:ff:b013:5a11:443', 'connect ETIMEDOUT <ipv6-public>:443'],
    ['connect EHOSTUNREACH 2001:0:2851:782c:1c2a:3a7d:a2b0:e4f6:443', 'connect EHOSTUNREACH <ipv6-teredo>:443'],
    ['via fd12:3456::1 and fe80::1', 'via <ipv6-private> and <ipv6-link-local>'],
    ['addr ::ffff:192.168.1.2 done', 'addr <ipv4-mapped-private> done'],
    ['reached 10.0.0.1.', 'reached <ipv4-private>.'],
];

const UNTOUCHED = [
    'at 12:00:00.000 read ECONNRESET',
    'version 1.2.3.4.5',
    'code 802: 授权中',
    '999.1.1.1:80',
];

describe('network error text', () => {
    it.each(REDACTIONS)('redacts %s', (input, expected) => {
        expect(redactIpAddresses(input)).toBe(expected);
    });

    it.each(UNTOUCHED)('leaves %s alone', input => {
        expect(redactIpAddresses(input)).toBe(input);
    });

    it.each([
        ['read ECONNRESET', true],
        ['socket hang up', true],
        ['Client network socket disconnected before secure TLS connection was established', true],
        ['timeout of 0ms exceeded', false],
        ['connect ECONNREFUSED 127.0.0.1:7890', false],
        [undefined, false],
    ])('recognizes a connection reset in %s: %s', (input, expected) => {
        expect(isConnectionResetMessage(input)).toBe(expected);
    });

    // 主进程用 .cjs、渲染进程用 .mjs，两份必须给出同样的结果。
    it('keeps the CommonJS twin identical', () => {
        for (const input of [...REDACTIONS.map(([text]) => text), ...UNTOUCHED, 'socket hang up', 'timeout']) {
            expect(cjs.redactIpAddresses(input)).toBe(redactIpAddresses(input));
            expect(cjs.isConnectionResetMessage(input)).toBe(isConnectionResetMessage(input));
        }
    });
});
