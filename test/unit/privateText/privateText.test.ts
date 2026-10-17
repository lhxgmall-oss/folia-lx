import { describe, expect, it } from 'vitest';
import { addressDifference, addressKind, cleanPrivateCode, cleanPrivateError, cleanPrivateText } from '@/utils/privateText/privateText';

// test/unit/privateText/privateText.test.ts
// The one cleaner of texts the app did not write: what a platform said (a fact the sign-in window
// shows) and the sentence of a thrown error (a log line, a line of the diagnostics report) pass it
// before a person sees them. Each line below is what was said and what is left of it. The inputs of the first block
// are the ones a check of the earlier cleaner got through it.

const cleaned = (lines: Array<[string, string]>) => {
    for (const [said, left] of lines) expect(cleanPrivateText(said), said).toBe(left);
};
// Nothing of `needles` is left in what was said.
const gone = (lines: Array<[string, string[]]>) => {
    for (const [said, needles] of lines) {
        const left = cleanPrivateText(said) ?? '';
        expect(needles.filter(needle => left.includes(needle)), `${said} => ${left}`).toEqual([]);
    }
};

describe('cleanPrivateText', () => {
    it('takes out account numbers, also short ones and ones inside a sentence', () => {
        cleaned([
            ['uid 123456 is banned', 'uid <number> is banned'],
            ['uin=123456', 'uin=<value>'],
            ['userId: 123456', 'userId=<value>'],
            ['用户123456已被冻结', '用户<number>已被冻结'],
            ['号码10001需要验证', '号码<number>需要验证'],
            ['uin 2873651094 at 203.0.113.7', 'uin <number> at <ip>'],
            ['已向 138 1234 5678 发送验证码', '已向 <number> 发送验证码'],
            ['call +86 138-1234-5678', 'call <number>'],
        ]);
    });

    it('takes out addresses: IPv6, IPv4 beside letters and with a port, hosts without a scheme, any scheme', () => {
        cleaned([
            ['connect ETIMEDOUT 2408:8756:f50:10:3::1f:443', 'connect ETIMEDOUT <ip>'],
            ['connect ECONNREFUSED ::1:3000', 'connect ECONNREFUSED <ip>'],
            ['from ip203.0.113.7 and 203.0.113.7:8080', 'from ip<ip> and <ip>:8080'],
            ['getaddrinfo ENOTFOUND interface.music.example.test', 'getaddrinfo ENOTFOUND <address>'],
            ['request to localhost:10754/login/qr/key failed', 'request to <address> failed'],
            ['socket wss://ws.example.test/qr/abc123?sid=1 closed', 'socket <address> closed'],
            ['request to https://music.example.test/login/qr/check?key=qr-private&cookie=MUSIC_U%3D00A1 failed', 'request to <address> failed'],
            ['account someone.private@example.test is locked', 'account <email> is locked'],
        ]);
    });

    it('takes out file paths, with the user\'s folder name and the spaces in it', () => {
        cleaned([
            ["ENOENT: no such file or directory, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\ytm\\state.json'", "ENOENT: no such file or directory, open '<path>'"],
            ["EACCES: permission denied, open '/Users/bob/Library/Application Support/Folia/x.json'", "EACCES: permission denied, open '<path>'"],
            ['Cannot find module kugoumusicapi Require stack: - C:\\Users\\Zhang San\\AppData\\Local\\Programs\\f', 'Cannot find module kugoumusicapi Require stack: - <path>'],
        ]);
    });

    it('takes out what is held under a name, however it is written, and short secrets', () => {
        cleaned([
            ['Cookie: MUSIC_U=abc123def; NMTID=00Oshort9; __remember_me=true', 'Cookie=<value>; NMTID=<value>; __remember_me=true'],
            ['refused {"MUSIC_U":"00A1B2C3D4E5F607","__csrf":"9f8e7d6c5b4a"}', 'refused {MUSIC_U=<value>,__csrf=<value>}'],
            ['Authorization: Bearer abcDEF123456tok', 'Authorization=<value>'],
            ['token="abc123secret" password: hunter2 token: abc123secret key = qr-private-1', 'token=<value> password=<value> token=<value> key=<value>'],
            ['qrsig=Zx81kQw wxuin=o012345 p_uin=o0123456 skey=@AbCdEfGhI', 'qrsig=<value> wxuin=<value> p_uin=<value> skey=<value>'],
            ['userid=77123; token=short-private', 'userid=<value>; token=<value>'],
            ['got Bearer abcDEF123456tok back', 'got Bearer <value> back'],
        ]);
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
        for (const token of [jwt, jwt.replace(/\./g, '')]) {
            for (const said of [`Authorization: Bearer ${token}`, `the token ${token} was refused`]) {
                const left = cleanPrivateText(said)!;
                // No eight characters in a row of the token are left.
                const kept = Array.from({ length: token.length - 7 }, (_, at) => token.slice(at, at + 8)).filter(piece => left.includes(piece));
                expect(kept, said).toEqual([]);
            }
        }
    });

    it('leaves the words of an ordinary failure as they are', () => {
        for (const said of [
            '二维码已失效，请刷新', '当前登录环境异常，请稍后再试', 'code 404: Not Found', 'code 8821: 需要验证', 'msg: 需要行为验证码验证',
            'QQMusicApi request failed: 502', 'KuGouMusicApi request failed: 502', 'QR login is temporarily backed off',
            'The sign-in request was not answered in 20 s', 'NETEASE_API_UNAVAILABLE', 'Error: timeout.',
            'status=waiting_for_authorization', 'error=authorization_pending', 'reason=browser-closed-early',
            'code=ERR_CONNECTION_REFUSED', 'net::ERR_SSL_VERSION_OR_CIPHER_MISMATCH', 'some-music-api@1.5.0 failed',
            // A number under a name that says it is a code stays, up to six digits.
            'KuGou request failed (operation=login_qr_check status=502 error_code=20028): 本次请求需要验证',
        ]) expect(cleanPrivateText(said), said).toBe(said);
        // An address ends where the sentence goes on.
        expect(cleanPrivateText('请前往https://music.example.test/verify完成验证后再试')).toBe('请前往<address>完成验证后再试');
    });

    // Known losses: the rule is to take out too much rather than too little.
    it('also takes out some harmless things that look like the above', () => {
        cleaned([
            ['session=expired auth=false user=none side=left keyword=x', 'session=<value> auth=<value> user=<value> side=left keyword=x'],
            ['version 1.2.3.4 required', 'version <ip> required'],
            ['POST /api/login/qr/check/status/pending returned 502', 'POST <path> returned 502'],
            ['errcode 1000000', 'errcode <number>'],
            // A word of 16 letters or more in one case is taken for a string of letters.
            ['error=misconfiguration', 'error=<value>'],
            ['window.electron is undefined', '<address> is undefined'],
            ['iPhone 15 is not supported', 'iPhone <value> is not supported'],
            ['build 120.0.60990', 'build 120.0.<number>'],
        ]);
    });

    // The inputs of the second check (chk-l3a), one line each. First the ones shaped like something
    // private: none of them is left readable.
    it('takes out every secret-shaped input of the second check', () => {
        cleaned([
            ['set MUSIC_U=abcdefghijklmnop for next call', 'set MUSIC_U=<value> for next call'],
            ['sp_dc=abcdefghijklmnopqrstuvwx rejected', 'sp_dc=<value> rejected'],
            ['callback /cb?state=xyz&code=qwertyuiopasdfgh', 'callback /cb?<query>'],
            ['callback /cb?state=xyz&code=AQBx7YzPq', 'callback /cb?<query>'],
            ['token abcdefghijklmnop was rejected', 'token <long> was rejected'],
            ['skey AbCdEfGhIj invalid', 'skey <value> invalid'],
            ['qrsig Zx81kQw invalid', 'qrsig <value> invalid'],
            ['header Bearer abcdefgh refused', 'header Bearer <value> refused'],
            ['GET https://api.example.test/login?key=abc123 failed', 'GET <address> failed'],
            ['api.example.test?access_token=abcdef refused', '<address> refused'],
            ['https://a.example.test/搜索?openid=abcdefgh failed', '<address> failed'],
            ['connect ECONNREFUSED ::ffff:198.51.100.23:8080', 'connect ECONNREFUSED <ip>:8080'],
            ['connect ETIMEDOUT 198.51.100.23:8080', 'connect ETIMEDOUT <ip>:8080'],
            ['connect ETIMEDOUT [2001:db8::1]:443', 'connect ETIMEDOUT [<ip>]:443'],
            ['bind fe80::1%eth0 failed', 'bind <ip> failed'],
            ['user 1234 is banned', 'user <value> is banned'],
            ['account: zhangsan is frozen', 'account=<value> is frozen'],
            ['user=alice not allowed', 'user=<value> not allowed'],
            ['mail sent to alice@example.test', 'mail sent to <email>'],
            ['code sent to 555.123.4567', 'code sent to <number>'],
            ['code sent to 138.1234.5678', 'code sent to <number>'],
            ['code sent to (555) 123-4567', 'code sent to <number>'],
            ["ENOENT: no such file or directory, scandir 'C:\\Users\\Zhang San'", "ENOENT: no such file or directory, scandir '<path>'"],
            ['open C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\x.json failed', 'open <path> failed'],
            ['open \\\\fileserver\\profiles\\zhangsan\\AppData\\Roaming\\Folia\\x.json failed', 'open <path> failed'],
            ['open ~/Library/Application Support/Folia/x.json failed', 'open <path> failed'],
            [
                '{"code":301,"profile":{"userId":12345678,"nickname":"Tom","phone":"13812345678"},"cookie":"a=b"}',
                '{"code":301,"profile":{userId=<value>,nickname=<value>,phone=<value>},cookie=<value>}',
            ],
            ['SESSDATA=abc%2Cdef expired', 'SESSDATA=<value> expired'],
            ['unikey 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d not found', 'unikey <long> not found'],
            ['device deadbeefcafefeed unknown', 'device <long> unknown'],
        ]);
    });

    // Then its ordinary inputs: every one is left as it was said.
    it('keeps every ordinary input of the second check', () => {
        for (const said of [
            'failed at 12:30:45 local time',
            'failed at 2026-10-10T12:30:45.123Z',
            'state.json is missing',
            'Node.js v24.1.0 required',
            'reason: loginExpired',
            'channel=WeChat',
            'content-type: text/html; charset=utf-8',
            'TypeError: Failed to fetch',
            'error: Too Many Requests',
            '操作过于频繁，请30秒后再试',
            '登录失败(code: -460)',
            'errno: -4078, code: ECONNREFUSED, syscall: connect',
            'KuGouApi[status=200 error_code=20028 detail=账号存在风险]',
            'Please retry.Thanks',
            'HTTP/1.1 502 Bad Gateway',
            'timeout of 15000ms exceeded',
            "Error invoking remote method 'kugou-request': Error: socket hang up",
            'Request failed with status code 403',
            'Unexpected token < in JSON at position 0',
            "name: 'AbortError', message: 'The operation was aborted'",
        ]) expect(cleanPrivateText(said), said).toBe(said);
    });

    // A rule that settles a piece ends it for the rules after it: a clock time kept is not read as
    // an address, and a clock-shaped piece inside an IPv6 address is not kept.
    it('keeps a time only where it stands alone, not inside an address', () => {
        cleaned([
            ['at 12:30 from 2001:db8:10:20::1', 'at 12:30 from <ip>'],
            ['at 09:05:01.250 from fe80::12:30', 'at 09:05:01.250 from <ip>'],
            ['waited 120000 ms for uin 2873651094', 'waited 120000 ms for uin <number>'],
            // A version (two short groups and a build number) is kept; a phone number written with dots is not one.
            ['Windows 10.0.22631 with 555.123.4567', 'Windows 10.0.22631 with <number>'],
        ]);
    });

    it('reads only the first 400 characters, before any rule runs, and hands on 160 at most', () => {
        expect(cleanPrivateText(`${'word '.repeat(80)}uin=123456`)).toBe('word '.repeat(32).trim());
        // A long unbroken run costs what its first 400 characters cost: the rest is never looked at,
        // so what follows them changes nothing. The run the cut went through is not printed at all.
        const run = 'a1b2'.repeat(100);
        expect(cleanPrivateText(run + 'x'.repeat(200_000))).toBe(cleanPrivateText(`${run}y`));
        expect(cleanPrivateText(run + 'x'.repeat(200_000))).toBe('…');
        expect(cleanPrivateText(run)).toBe('<long>');
        expect(cleanPrivateText('')).toBeUndefined();
        expect(cleanPrivateText('   ')).toBeUndefined();
        expect(cleanPrivateText(42)).toBeUndefined();
    });

    // The third check (chk-l4a). Two tables: what is shaped like something private and must not
    // come through, and the ordinary words of a failure that must stay readable. Every name, number
    // and folder below is made up.
    describe('what must not come through', () => {
        it('a pair under a credential\'s name that follows another word and a colon', () => {
            cleaned([
                ['Error: account: lihua is frozen', 'Error: account=<value> is frozen'],
                ['Error: user: lihua is frozen', 'Error: user=<value> is frozen'],
                ['login failed: user=wangfang not allowed', 'login failed: user=<value> not allowed'],
                ['Error: nickname: Bob', 'Error: nickname=<value>'],
                ['Error: token: qwertyui', 'Error: token=<value>'],
                ['sign-in failed: password=sesame', 'sign-in failed: password=<value>'],
                ['spotify:user:lihua is not allowed', 'spotify:user=<value> is not allowed'],
            ]);
        });

        it('an unquoted Windows path whose folder name has two or more spaces', () => {
            cleaned([
                ['spawn C:\\Users\\Anna Maria Rossi\\AppData\\Local\\Programs\\Folia\\resources\\ncm-server.exe ENOENT', 'spawn <path> ENOENT'],
                [
                    "Cannot find module 'some-module'\nRequire stack:\n- C:\\Users\\Anna Maria Rossi\\AppData\\Local\\Programs\\Folia\\resources\\app.asar\\electron\\main.cjs",
                    "Cannot find module 'some-module'\nRequire stack:\n- <path>",
                ],
                ['open \\\\fileserver\\home\\Anna Maria Rossi\\folia\\x.json failed', 'open <path> failed'],
                // A path ends at a file's name: the words after it are not taken with it.
                ['copy C:\\Users\\Anna Maria\\a.json to D:\\backup\\b.json failed', 'copy <path> to <path> failed'],
            ]);
        });

        it('a name under nick, name, realName and the like, a short code, and a value of more than one word', () => {
            cleaned([
                ['{"code":0,"data":{"nick":"阿宝","uin":"o0100200300"}}', '{"code":0,"data":{nick=<value>,uin=<value>}}'],
                ['nick=阿宝 refused', 'nick=<value> refused'],
                ['name=李华 refused', 'name=<value> refused'],
                ['"signature":"爱听老歌","realName":"李华"', 'signature=<value>,realName=<value>'],
                ['uname=laoli devid=5d2e8b1f4a3c', 'uname=<value> devid=<value>'],
                ['displayName: Li Hua is frozen', 'displayName=<value> is frozen'],
                ['pass=sesame pin=7391 verify_code=264915', 'pass=<value> pin=<value> verify_code=<value>'],
                ['Authorization: Basic bGlodWE6c2VzYW1l refused', 'Authorization=<value> refused'],
            ]);
        });

        it('the word after a credential\'s name, unless it says what became of the thing', () => {
            cleaned([
                ['user bob is banned', 'user <value> is banned'],
                ['user Li Hua is banned', 'user <value> is banned'],
                ['user 小陈同学 is banned', 'user <value> is banned'],
                ['nickname 小陈同学 已登录', 'nickname <value> 已登录'],
                ['user name lihua is taken', 'user name <value> is taken'],
            ]);
        });

        it('a value under a credential\'s name that looks like a time, a date, a version or a duration', () => {
            gone([
                ['uin=12:30:45 rejected', ['12:30']],
                ['token=12:30:45.123456 rejected', ['12:30', '123456']],
                ['uid=10.0.22631 refused', ['22631']],
                ['session=2026-10-10 expired', ['2026']],
                ['uin=7654321 s', ['7654321']],
                ['user 7654321 second login refused', ['7654321']],
                ['phone=1391234 min', ['1391234']],
                ['sid: 12:30', ['12:30']],
            ]);
        });

        it('what the cut at 400 characters went through', () => {
            const head = 'GET https://accounts.example.test/authorize?state=';
            const mail = `${head}${'a'.repeat(400 - head.length - ' failed for '.length - 'lihua'.length)} failed for lihua@example.test and more`;
            expect(mail.slice(395, 400)).toBe('lihua');
            expect(cleanPrivateText(mail)).toBe('GET <address> failed for …');
            // A quoted path the cut left without its closing quote.
            const first = "rename 'C:\\Users\\Li Hua\\AppData\\Roaming\\Folia\\cache";
            const path = `${first}${'d'.repeat(400 - first.length - "' -> '".length - 'C:\\Users\\Li Hua'.length)}' -> 'C:\\Users\\Li Hua\\AppData\\Roaming\\Folia\\state.json'`;
            expect(path.slice(397, 400)).toBe('Hua');
            expect(cleanPrivateText(path)).toBe("rename '<path>' -> '<path>'…");
        });
    });

    // The fourth check (chk-e1a), one block a finding. Every name, number and folder is made up.
    describe('the fourth check', () => {
        const same = (lines: string[]) => {
            for (const said of lines) expect(cleanPrivateText(said), said).toBe(said);
        };
        // `tail` after a long address, placed so that the 400 characters end right after `before`.
        const placed = (tail: string, before: string): string => {
            expect(tail.startsWith(before)).toBe(true);
            const head = 'GET https://a.example.test/x?s=';
            return `${head}${'a'.repeat(400 - before.length - head.length - 1)} ${tail}`;
        };

        it('an unquoted path with a folder of several words, where the cut at 400 went through it', () => {
            const files = ['neteaseApi.cjs', 'main.cjs', 'bootstrap.cjs', 'preload.cjs', 'updater.cjs', 'window.cjs'];
            for (const module of ['@neteasecloudmusicapienhanced/api', 'some-module', 'electron-store', 'a']) {
                const stack = files.map(file => `- C:\\Users\\Anna Maria Rossi\\AppData\\Local\\Programs\\Folia\\resources\\app.asar\\electron\\${file}`);
                gone([[`Cannot find module '${module}'\nRequire stack:\n${stack.join('\n')}`, ['Anna', 'Maria', 'Rossi']]]);
            }
            const line = '- C:\\Users\\Anna Maria Rossi\\AppData\\Local\\Programs\\Folia\\resources\\app.asar\\electron\\main.cjs';
            cleaned([
                [placed(line, '- C:\\Users\\Anna Maria Rossi\\AppDa'), 'GET <address> - …'],
                [placed(line, '- C:\\Users\\Anna Maria'), 'GET <address> - …'],
                [placed(line, '- C:\\Users\\Anna Maria '), 'GET <address> - …'],
                [placed(line, '- C:\\Users\\Anna Mar'), 'GET <address> - …'],
                [placed('open \\\\fileserver\\home\\Anna Maria Rossi\\folia\\x.json failed', 'open \\\\fileserver\\home\\Anna Maria Ro'), 'GET <address> open …'],
                // A path that ended at a file's name before the cut stays a path; only the cut word goes.
                [placed('copy C:\\Users\\Anna Maria\\a.json to the backup folder', 'copy C:\\Users\\Anna Maria\\a.json to the back'), 'GET <address> copy <path> to the …'],
            ]);
        });

        it('a quoted path with an apostrophe in a folder name', () => {
            cleaned([
                ["ENOENT: no such file or directory, open 'C:\\Users\\D'Angelo\\AppData\\Roaming\\Folia\\ncm\\anonymous_token'", "ENOENT: no such file or directory, open '<path>'"],
                [
                    "EPERM: operation not permitted, rename 'C:\\Users\\O'Brien\\AppData\\Roaming\\Folia\\a.tmp' -> 'C:\\Users\\O'Brien\\AppData\\Roaming\\Folia\\a.json'",
                    "EPERM: operation not permitted, rename '<path>' -> '<path>'",
                ],
                ["ENOENT: no such file or directory, open '/Users/o'brien/Library/Application Support/Folia/ncm/anonymous_token'", "ENOENT: no such file or directory, open '<path>'"],
                ['open "C:\\Users\\O\'Brien\\x.json" failed', 'open "<path>" failed'],
                ["open 'C:\\Users\\Li Hua\\x.json', then retry", "open '<path>', then retry"],
            ]);
        });

        it('keeps the word after a credential\'s name when it is an ordinary word of a failure', () => {
            same([
                'user rate limit exceeded', 'User Rate Limit Exceeded', 'account suspended', 'session ended by the server', 'session terminated',
                'Session limit reached', 'account restricted', 'Account deactivated', 'Token used too late', 'User consent required', 'user offline',
                'No token provided', 'token fetch failed: 503', 'token decode error', 'key derivation failed', 'user needs to sign in again',
                'user gesture required', 'auth window closed by the user', 'OAuth 2.0 is not supported', 'token is null',
                'token 校验失败', 'token 刷新失败', 'session 超时，请重新登录', 'cookie 格式错误', 'uid 非法', 'user 登录失败', 'key 验证失败', 'account 已冻结',
            ]);
        });

        it('keeps an error code of up to six digits after the word code', () => {
            same([
                'Kugou API error: code 20028, msg 参数错误', 'QQ Music API error: code 500001', 'NetEase rejected the listening report: code 10004',
                'NetEase returned no liked-songs list (code 20001)', 'KuGou answered errcode 20028', '登录失败，错误码 20010', 'request failed: 20028',
            ]);
            cleaned([
                ['code 1234567', 'code <number>'],
                // A code that is a secret is not an error's code.
                ['sms code 264915 is wrong', 'sms code <number> is wrong'],
                ['sms code 2649 is wrong', 'sms code <number> is wrong'],
                ['auth code 264915', 'auth code <number>'],
                ['verification code: 264915', 'verification code=<value>'],
            ]);
        });

        // The fifth check (chk-h1). A verification code is made up of four to eight digits like an error's code.
        it('takes a number for a verification code where the words of its clause say so', () => {
            gone([
                // A word before the word code.
                ...['Your', 'Enter', 'confirmation', 'one-time', '2FA', 'email', 'phone', 'mobile', 'access', 'dynamic', 'check', 'device', 'authorization']
                    .flatMap((word): Array<[string, string[]]> => [[`${word} code 482913`, ['482913']], [`${word} code 4821`, ['4821']]]),
                ['your code: 482913', ['482913']],
                ['Enter code 482913 on your phone', ['482913']],
                // Any run of spaces, tabs, _ and - before the word code.
                ['sms  code 482913', ['482913']], ['sms\tcode 482913', ['482913']], ['email  code 4821', ['4821']], ['email\tcode 482913', ['482913']], ['SMS-code 4821', ['4821']],
                // A word that means verification anywhere in the clause, before or after the number.
                ['验证码 code 482913', ['482913']], ['验证码 4821', ['4821']], ['验证码：4821', ['4821']], ['校验码 4821 错误', ['4821']], ['动态码为 4821', ['4821']],
                ['您的验证码为 4821，5 分钟内有效', ['4821']], ['SMS 4821 sent', ['4821']], ['use 482913 to verify', ['482913']], ['Your code is 4821.', ['4821']],
                ['{"msg":"验证码 4821 已发送"}', ['4821']], ['verification failed: 482913', ['482913']], ['verification failed: 12345', ['12345']],
                // The word code, and the clause goes on to say what the code is for.
                ['code 482913 to sign in', ['482913']], ['code 4821 to log in', ['4821']],
                // After failed: and error: a number of six digits is no error's code, and none is where the words before name an account.
                ['failed: 482913', ['482913']], ['Error: 482913', ['482913']], ['uin error: 12345', ['12345']], ['user id failed: 10001', ['10001']],
                // Nor is one of six digits after the words status and errno.
                ['status 482913', ['482913']], ['errno 482913', ['482913']],
            ]);
            // An error's code beside a platform's sentence about a verification code: another clause, or a pair of its own.
            same([
                'code 8821: 需要行为验证码验证', 'Kugou API error: code 20021, msg 验证码错误', '{"code":8821,"message":"需要行为验证码验证"}',
                'KuGouApi[status=200 error_code=20021 detail=验证码错误]', 'KuGou request failed (operation=verify_sms status=200 error_code=20021): 验证码错误',
                'captcha required, code 8810', 'verification timed out after 15000 ms', 'the verification code has expired', 'sms code expired',
                'KuGou anonymous search failed: 20028', 'login failed: 20028', 'Error: 20028', 'QR check failed: 20028', 'exited with code 3221', 'status 20028',
                'errno -4078', 'QQMusicApi request failed: 502', 'token fetch failed: 503',
            ]);
            // A phone number in such a clause stays one number.
            cleaned([['验证码已发送至 138 1234 5678', '验证码已发送至 <number>']]);
        });

        it('takes a name that ends in id or name for an account\'s or a person\'s, but for a short list of ordinary names', () => {
            // The list, by the name's last word: valid, invalid, paid, unpaid, android, grid, kid, void, said, rename, typename, codename.
            same([
                'valid: true', '"valid":false,"paid":true', 'paid=1', 'unpaid=true', 'android: 14', 'invalid: bad request', 'Error: invalid: missing field',
                'said: hello world is here', 'grid: 3', 'void: 0', 'rename: operation not permitted', 'typename: Playlist', '"__typename":"Track"', 'kid: 1',
                'OAuth: denied', 'is_valid=0', 'isValid: false', 'IS_VALID=1', 'name: Error', 'codename: sequoia', '{"name":"Error","message":"boom"}',
            ]);
            cleaned([
                ['userId: 77123 user_id=77123 openid=abcdefgh ID: 77123', 'userId=<value> user_id=<value> openid=<value> ID=<value>'],
                ['nickname: Bob userName=bob uname=bob realname=bob accountid=bob', 'nickname=<value> userName=<value> uname=<value> realname=<value> accountid=<value>'],
                // A value that is no ordinary word is taken out under any name.
                ['songmid=003aQYLo2x8izP hostname=zhangsan-pc.lan', 'songmid=<value> hostname=<address>'],
                ['nickname: FatalError', 'nickname=<value>'],
                // Every other name that ends in id or name: a machine's, a file's, a person's, a device's.
                ['hostname=music-server filename: main.cjs', 'hostname=<value> filename=<value>'],
                ['COMPUTERNAME=LIHUA-PC LOGNAME=lihua HOSTNAME=lihua-pc', 'COMPUTERNAME=<value> LOGNAME=<value> HOSTNAME=<value>'],
                ['{"code":0,"data":{"hostuin":12345678,"hostname":"张三","total":3}}', '{"code":0,"data":{hostuin=<value>,hostname=<value>,"total":3}}'],
                ['{"givenname":"Hua","familyname":"Li"} wxid: lihua', '{givenname=<value>,familyname=<value>} wxid=<value>'],
                ['{"loginid":"lihua","memberid":"lihua","deviceid":"5d2e"}', '{loginid=<value>,memberid=<value>,deviceid=<value>}'],
                ['filename: 张三的歌单.json', 'filename=<value>'],
                ['hostname zhangsan-pc is not reachable', 'hostname <value> is not reachable'],
                // An ordinary word before id or name does not make the name ordinary.
                ['androidId=9f3a typeName: Li Hua gridid=7', 'androidId=<value> typeName=<value> gridid=<value>'],
            ]);
        });

        it('takes a name or a short secret after a credential\'s name for what it is', () => {
            cleaned([
                ['user LI HUA is banned', 'user <value> is banned'],
                ['nickname DJKING joined', 'nickname <value>'],
                ['token ABCDEFGH rejected', 'token <value> rejected'],
                ['sid AB_CD_EF refused', 'sid <value> refused'],
                ['cookie Zx81kQw rejected', 'cookie <value> rejected'],
                ['user ID LIHUA is banned', 'user ID <value> is banned'],
                ['nickname 无名之辈 已登录', 'nickname <value> 已登录'],
                ['user 不二家 is banned', 'user <value> is banned'],
                ['user 张 伟 is banned', 'user <value> is banned'],
                // After "is" comes the value.
                ['token is ab12cd', 'token is <value>'],
                ['password is sesame', 'password is <value>'],
                ['pin is 7391', 'pin is <value>'],
                ['your nickname is 阿宝', 'your nickname is <value>'],
                ['login user is zhangsan', 'login user is <value>'],
                ['user id is 4821', 'user id is <value>'],
                // A value of several words: a capitalised word after a capitalised one belongs to the name.
                ['displayName: John Q Public is frozen', 'displayName=<value> is frozen'],
                ['user Li An is banned', 'user <value> is banned'],
                ['nickname: May Read is frozen', 'nickname=<value> is frozen'],
                ['realName: Wang Do Page', 'realName=<value>'],
                ['displayName: Li  Hua frozen', 'displayName=<value> frozen'],
                ['name: Zhang, San refused', 'name=<value> refused'],
                ['data[nick]=阿宝', 'data[nick=<value>'],
            ]);
        });

        // The fifth check (chk-h1): a value goes on to the first word that says what became of the thing, however many words that is.
        it('takes every word of a long value', () => {
            cleaned([
                ['user abc def ghi jkl mno pqr', 'user <value>'],
                ['user Maria del Carmen Garcia Lopez is banned', 'user <value> is banned'],
                ['displayName: Maria Del Carmen Garcia Lopez', 'displayName=<value>'],
                ['nickname: the quick brown fox jumps', 'nickname=<value>'],
                ['name: Anna Maria Rossi Bianchi Verdi refused', 'name=<value> refused'],
                ['account zhang san feng de ge dan', 'account <value>'],
                ['nickname=Li Hua Zhang Wei Wang', 'nickname=<value>'],
                ['user 张 三 丰 的 歌 单 is banned', 'user <value> is banned'],
                ['realName: Jean Paul Marie Pierre Dupont', 'realName=<value>'],
            ]);
        });

        it('takes the word after a word that says what for a value, unless it says what too', () => {
            cleaned([
                ['password set hunter2', 'password set <value>'],
                ['password provided hunter2 is wrong', 'password provided <value> is wrong'],
                ['user removed lihua from the playlist', 'user removed <value> from the playlist'],
                ['token issued ab12cd for client', 'token issued <value> for client'],
                ['nickname set 阿宝', 'nickname set <value>'],
                ['token expired ab12cd', 'token expired <value>'],
                ['user not zhangsan', 'user not <value>'],
                ['account locked lihua', 'account locked <value>'],
                ['token refresh ab12cd failed', 'token refresh <value> failed'],
                // A value of several words after it.
                ['user online Li Hua', 'user online <value>'],
            ]);
            for (const word of ['null', 'true', 'valid', 'new', 'set', 'created', 'given', 'used', 'limit', 'access', 'sync', 'online', 'verified', 'json', 'sso']) {
                for (const name of ['user', 'token', 'password', 'nickname', 'uin']) {
                    gone([[`${name} ${word} zhangsan`, ['zhangsan']], [`${name} ${word} 4821`, ['4821']], [`${name} ${word} 阿宝`, ['阿宝']]]);
                }
            }
            // The words of an ordinary failure stay: the word after says what too, or is the next credential's name.
            same([
                'user not found', 'session expired', 'token is invalid', 'account was refused', 'user is not signed in', 'token has expired', 'account not bound',
                'user cancelled the sign-in', 'user did not complete the challenge', 'token refresh returned 401', 'password must not be empty', 'key not found in store',
                'User not authorized', 'account not allowed', 'token not supported', 'key not available', 'user not authenticated', 'session cookie not found',
                'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.',
            ]);
        });

        // The fifth check's small ones, both older than the change it checked.
        it('takes a quoted word after a word that says what, and an apostrophe inside an unquoted Windows path', () => {
            cleaned([
                ['password is "hunter2"', 'password is "<value>"'],
                ["token is 'ab12cd'", "token is '<value>'"],
                ['your nickname is "阿宝"', 'your nickname is "<value>"'],
                ['nickname set "Li Hua" today', 'nickname set "<value>" today'],
                ["- C:\\Users\\Anna O'Neil Rossi\\AppData\\Local\\x.cjs", '- <path>'],
                ["open C:\\Users\\D'Angelo\\x.json failed", 'open <path> failed'],
                [placed("- C:\\Users\\Anna O'Neil Rossi\\AppData\\Local\\Programs\\Folia\\x.cjs", "- C:\\Users\\Anna O'Neil Ro"), 'GET <address> - …'],
            ]);
            same(['token is "expired"', 'Unexpected token \'A\', "Access denied" is not valid JSON', "can't open the file"]);
        });

        it('takes a Chinese word for a value when anything else is glued to the words that say what', () => {
            cleaned([
                ['user 张三登录失败', 'user <value>'],
                ['account 张三已冻结', 'account <value>'],
                ['user 1234不存在', 'user <value>'],
                ['token ab12无效', 'token <value>'],
                ['user 李华没有权限', 'user <value>'],
                ['uin 4821错误', 'uin <value>'],
                ['account 小明的账号异常', 'account <value>'],
                ['user 登录失败的张三', 'user <value>'],
                ['nickname 失败者联盟', 'nickname <value>'],
                ['nickname 永不过期 joined', 'nickname <value>'],
                ['nickname 无法无天 joined', 'nickname <value>'],
                ['nickname 请叫我小明 joined', 'nickname <value>'],
                ['nickname 未来可期 joined', 'nickname <value>'],
                ['nickname 需要你 joined', 'nickname <value>'],
            ]);
            same([
                'token 已过期', 'cookie 已过期，请重新登录', 'token 已失效，请重新扫码登录', 'session 无效', 'user 不存在', 'account 未登录', 'cookie 未找到', 'user 没有权限',
                'account 被封禁', 'uid 不能为空', 'token 请求失败', 'key 无法解析',
            ]);
        });

        it('keeps less of what only looks like a code, a package or a run of status codes', () => {
            gone([
                ['trace QQ1234_AB5678 failed', ['QQ1234']],
                ['cookie value AB12_CD34_EF56 refused', ['AB12']],
                ['refused Zx9Kq7Lm2Error', ['Zx9Kq7Lm2']],
                ['phone 404 502 301 not bound', ['404', '502', '301']],
                ['uin 404 404 404', ['404']],
                ['@lihua1988/likes is private', ['lihua1988']],
                ['handle @zhang-san/abc12345 not found', ['zhang-san', 'abc12345']],
                ['uin (12:30:45) rejected', ['12:30']],
                ['uin=[1391234 s]', ['1391234']],
                ['token=`12:30:45`', ['12:30']],
                ['phone: +86 1391234 s', ['1391234']],
            ]);
            same(['net::ERR_HTTP_1_1_REQUIRED', 'digest SHA256_MISMATCH', "Cannot find module '@neteasecloudmusicapienhanced/api'"]);
        });

        it('prints the port after an address', () => {
            cleaned([
                ['listen EADDRINUSE: address already in use :::10754', 'listen EADDRINUSE: address already in use <ip>:10754'],
                ['connect ECONNREFUSED 127.0.0.1:10754', 'connect ECONNREFUSED <ip>:10754'],
                ['connect ETIMEDOUT 203.0.113.7:2873651094', 'connect ETIMEDOUT <ip>:<number>'],
            ]);
        });
    });

    describe('what must stay readable', () => {
        it('the codes and names of an ordinary failure', () => {
            for (const said of [
                'net::ERR_HTTP2_PROTOCOL_ERROR',
                "request failed, code: 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE'",
                'ERR_HTTP2_STREAM_ERROR: Stream closed with error code NGHTTP2_REFUSED_STREAM',
                'OAuth2Error: invalid_request',
                'IPv4/IPv6 lookup failed',
                // The app's own dependency, as Node names it when it is not there.
                "Cannot find module '@neteasecloudmusicapienhanced/api'",
                'port 52001 is already in use',
                'returned 200 404 500 in turn',
                'request timed out after 20000 milliseconds',
                'Linux 6.8.0-45-generic',
                // A code under its own name is read by that name, also behind another word and a colon.
                'Error: code=30768 need login',
            ]) expect(cleanPrivateText(said), said).toBe(said);
        });

        it('the word after a credential\'s name when it says what became of the thing', () => {
            for (const said of [
                // After the word cookie, a word all in capitals is the cookie's name.
                'cookie SAPISID is missing',
                'token EXPIRED',
                'The user ID is invalid',
                'AbortError: The user aborted a request.',
                'SyntaxError: Unexpected token S in JSON at position 0',
                'Unexpected token \'A\', "Access denied" is not valid JSON',
                'the session cookie is missing',
                'user name or password is wrong',
                'token refresh failed',
                'token 已过期',
            ]) expect(cleanPrivateText(said), said).toBe(said);
        });
    });
});

// What a log line may say of an address: its kind, and for two of them the part they differ in. Every address is made up.
describe('addressKind and addressDifference', () => {
    const blob = 'blob:http://localhost:3000/3f2a1c9e-1b2d-4c3e-9f00-aabbccddeeff';
    const signed = 'https://m701.music.example.test/20261011/abcdef/song.mp3?vkey=ABC123';

    it('say the kind of an address and nothing of the address', () => {
        for (const [address, kind] of [
            [blob, 'blob'],
            ['file:///C:/Users/Li Hua/Music/a.mp3', 'file'],
            ['data:audio/mpeg;base64,AAAA', 'data'],
            [signed, 'https remote'],
            ['http://127.0.0.1:10754/stream?id=1', 'http local'],
            ['http://localhost:3000/a.mp3', 'http local'],
            ['http://192.168.1.5:8080/a.mp3', 'http remote'],
            ['folia-transcode://audio/abc?token=made-up', 'folia-transcode'],
            // A protocol the app does not know may be a name: it is not printed.
            ['lihua:hunter2@proxy.example.test:8080', 'other'],
            ['/music/Li Hua/a.mp3', 'other'],
            ['', 'none'],
            [null, 'none'],
        ] as const) expect(addressKind(address), String(address)).toBe(kind);
    });

    it('say the first part two addresses differ in', () => {
        expect(addressDifference(blob, signed)).toBe('kind');
        expect(addressDifference(blob, blob.replace('3f2a', '7777'))).toBe('path');
        expect(addressDifference(signed, signed.replace('m701', 'm801'))).toBe('host');
        expect(addressDifference(signed, signed.replace('song', 'other'))).toBe('path');
        // The same file with another signature.
        expect(addressDifference(signed, signed.replace('ABC123', 'DEF456'))).toBe('query');
        expect(addressDifference(signed, signed)).toBeNull();
        expect(addressDifference(signed, null)).toBe('kind');
        expect(addressDifference(null, '')).toBeNull();
    });
});

describe('cleanPrivateCode', () => {
    it('keeps a short word or number and drops everything else whole', () => {
        for (const code of ['800', '8821', '50006', '-100001', 'no-browser', 'E_SEVENTH_QUOTA', 'sign-in-failed']) expect(cleanPrivateCode(code), code).toBe(code);
        for (const code of ['12345678', '203.0.113.7', 'o0123456789', '0123456789abcdef0123456789abcdef', 'exited token=abc', '', 'a'.repeat(25)]) {
            expect(cleanPrivateCode(code), code).toBeUndefined();
        }
        expect(cleanPrivateCode(800)).toBeUndefined();
    });

    // The second check's inputs: a string of letters, a mix of cases and digits and a letter before
    // a number are not codes; a number of six digits and a word are.
    it('drops what has the letters of a code and the shape of a secret', () => {
        for (const code of ['abcdefghijklmnopqrstuvwx', 'o12345', 'Zx81kQw', 'AbCdEfGhIj', '1234567']) expect(cleanPrivateCode(code), code).toBeUndefined();
        for (const code of ['123456', 'no-browser', 'ERR_HTTP2_PROTOCOL_ERROR', 'auth-required']) expect(cleanPrivateCode(code), code).toBe(code);
    });
});

describe('cleanPrivateError', () => {
    it('leaves the name of a thrown error and its sentence, cleaned', () => {
        const error = new TypeError("open 'C:\\Users\\Zhang San\\x.json' failed for uin 2873651094");
        expect(cleanPrivateError(error)).toEqual({ name: 'TypeError', message: "open '<path>' failed for uin <number>" });
        expect(cleanPrivateError('token=abc123secret')).toEqual({ name: 'Error', message: 'token=<value>' });
        expect(cleanPrivateError(undefined)).toEqual({ name: 'Error', message: 'undefined' });
    });

    it('keeps an error\'s name only where it is a name, and says what a thrown object held', () => {
        const named = (name: string) => cleanPrivateError(Object.assign(new Error('x'), { name })).name;
        for (const name of ['TypeError', 'AbortError', 'OAuth2Error', 'OnlineProviderError']) expect(named(name), name).toBe(name);
        for (const name of ['uin 7654321 at C:\\Users\\Li Hua', 'lihua@example.test', 'o0100200300', '', 'x'.repeat(41)]) expect(named(name), name).toBe('Error');
        // An adapter that throws a platform's answer: its fields are read, each by its own name.
        expect(cleanPrivateError({ code: 301, message: 'need login' })).toEqual({ name: 'Error', message: '{"code":301,"message":"need login"}' });
        expect(cleanPrivateError({ code: 301, profile: { nickname: '阿宝' } }).message).toBe('{"code":301,"profile":{nickname=<value>}}');
        const loop: Record<string, unknown> = {};
        loop.self = loop;
        expect(cleanPrivateError(loop).message).toBe('[object Object]');
    });

    it('never hands on a name that is no string, and keeps the code a thrown error carries', () => {
        const odd = Object.assign(new Error('x'), { name: { toString: () => 'abc', held: 'uin 2873651094' } });
        expect(cleanPrivateError(odd)).toEqual({ name: 'Error', message: 'x' });
        expect(cleanPrivateError(Object.assign(new Error('Sign in again'), { name: 'OnlineProviderError', code: 'auth-required' })))
            .toEqual({ name: 'OnlineProviderError', message: 'Sign in again', code: 'auth-required' });
        expect(cleanPrivateError(Object.assign(new Error('Request failed'), { code: 'ECONNRESET' })).code).toBe('ECONNRESET');
        // A code that is no code is dropped whole; an error without one has no such field.
        for (const code of ['uin 2873651094', 20, { held: 'x' }]) expect('code' in cleanPrivateError(Object.assign(new Error('x'), { code })), String(code)).toBe(false);
        expect('code' in cleanPrivateError(new Error('x'))).toBe(false);
        // An error that has no sentence of its own says the one of the first error inside it.
        expect(cleanPrivateError(new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:10754')], '')).message).toBe('connect ECONNREFUSED <ip>:10754');
    });
    // That the log lines print a thrown error through it is held by privateTextLogLines.test.ts.
});
