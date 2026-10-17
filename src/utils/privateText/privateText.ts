// src/utils/privateText/privateText.ts
// 一段不是自己写的文字（平台的原话、服务器的回答、抛出的错的那句话）要给人看、要进日志或者诊断报告之前，
// 都先过这里的 cleanPrivateText：这是唯一的一处，登录、播放、曲库和各个平台的代码都用它。它按形状把可能带着
// 私人信息的片段换成占位词。
// 按形状认不全，所以抛出的错的原话不进登录失败的事实（services/onlineMusic/login/loginFailureCase.ts），只进报告的时间线。
//
// 规则一条接一条地套。一条规则认下来的一段（换成了占位词，或者认定要原样留下）就此定了，后面的规则
// 不再读它：占位词不会被再切一刀，留下的钟点也不会被后面的规则当成号码。
// 拿不准的时候宁可多换：一个普通的词被换掉只是难读一点，一段凭据漏出去收不回来。可一句话要是连
// 「哪里坏了」都读不出来也是毛病，所以常见的错误代号、错误的类名和应用自己的模块名有规则把它们留下。

// 先截到这么长再套规则：规则的耗时由它封顶，一段几万字的文字不会卡住窗口。
const INPUT_LIMIT = 400;
const OUTPUT_LIMIT = 160;

const URL_CHARS = "[\\w.~:/?#\\[\\]@!$&'()*+,;=%\\\\-]";
const PATH_PIECE = '[^\\s"\'`<>|]';
// 不带引号的路径里，夹在两个字母中间的撇号是文件夹名字里的（O'Neil），不是引号。
const PATH_APOSTROPHE = "(?<=[A-Za-z])'(?=[A-Za-z])";

// 一个词：小写的、大写的、首字母大写的，或者驼峰写法的名字，后面可以跟至多四位数字（HTTP2、utf8）。
// 同一种大小写连着超过 15 个字母的不是词，是一串字母。
const WORD_RUN = /^(?:[a-z]{1,15})?(?:[A-Z]{1,6}[a-z]{1,15})*[A-Z]{0,15}\d{0,4}$/;
/** 一段文字里每一截字母数字都是上面那样的词，或者四位以内的数。没有字母数字的（中文的一句话）也算。 */
const isPlain = (value: string): boolean => (value.match(/[A-Za-z0-9]+/g) ?? []).every(run => WORD_RUN.test(run));

// 这些词后面的 code 是一个验证码，不是错误的代号（your code、email code、check code）。
const SECRET_CODES = 'verify|verification|confirm|confirmation|sms|auth|authentication|authorization|pass|pin|otp|captcha|security|login|invite'
    + '|one[- ]?time|email|phone|mobile|access|dynamic|check|device|your|enter|entered';
// 说的是验证码的词：同一小句里 4 到 8 位的数是一个验证码。
const VERIFY = /verif|captcha|(?<![A-Za-z])(?:sms|otp|2fa)|验证码|校验码|动态码/i;
// 一小句：到最近的标点或者 = : 为止。
const CLAUSE = String.raw`[^,;:=()\[\]{}\n，；：。（）]*`;
// 名字以这些词结尾的东西是凭据、账号，或者一个人的名字、一个验证码：它的值不管是什么都换掉。
// 验证码的名字可以是分开写的两个词，中间隔着空格、制表符、_ 或者 -（sms code、sms  code）。
const SECRET_WORDS = `(?:${SECRET_CODES})[ \\t_-]*code|cookie|token|secret|session|passw(?:or)?d|pass|pwd|auth|authorization|csrf|ticket|sig|signature|uin|uid|sid|key|user|account|phone|mobile|email|nick|pin|otp|captcha|openid|unionid`;
const SECRET_WORD = new RegExp(`^(?:${SECRET_WORDS}|name)$`, 'i');
// 以 id 或者 name 结尾的名字也都是：它的值是一个账号、一台设备，或者一个人、一台机器、一个文件的名字
// （wxid、deviceid、hostname、COMPUTERNAME、filename）。只有下面这几个普通的名字不是，看的是名字的最后一个词
// （is_valid、isValid、__typename）：valid、invalid、paid、unpaid 的值是真假；android 是系统的名字；grid 是版式；
// kid 是 JWT 里公开的密钥编号；void、said、rename 是普通的词；typename 是 GraphQL 的类型名；codename 是
// 系统版本的代号。不在这里的名字一律算，拿不准的时候宁可多换。
const ORDINARY_NAMES = new Set('valid invalid paid unpaid android grid kid void said rename typename codename'.split(' '));
const lastWordOf = (name: string): string => (/[A-Z]?[a-z]+$|[A-Z]+$/.exec(name)?.[0] ?? '').toLowerCase();
/**
 * 这个名字（已经以上面的一个词、id 或者 name 结尾）是不是凭据、账号或者人名的名字。OAuth 是协议的名字，不是；
 * 那几个普通的名字不是。
 */
const isSecretName = (name: string): boolean => !/^oauth\d?$/i.test(name) && !ORDINARY_NAMES.has(lastWordOf(name));
// 名字说了它是一个码：至多六位的数留下。
const CODE_NAME = /(?:code|errno|status)$/i;
// 两段的「名字.后缀」是文件名而不是主机名的那些后缀；路径到一个这样的文件名为止。
const FILE_ENDINGS = '[cm]?js|tsx?|json|node|html?|css|txt|log|exe|dll|asar|db|tmp|lock';
const FILE_ENDING = new RegExp(`\\.(?:${FILE_ENDINGS})$`);
// 一个错误的类名（Error、TypeError、OAuth2Error）：在 name= 下面、在抛出的错的名字里、在一长串里都留下。
// 里面至多一位数字：数字散在好几处的是一串凭据后面接了 Error。
const ERROR_CLASS = /^(?:[A-Z][A-Za-z]{0,40}\d?[A-Za-z]{0,40})?(?:Error|Exception)$/;
// 带着数字却不是凭据的一长串：用 _ 连着的全大写的词，每个词后面至多三位数字，中间可以有一两位的数
// （ERR_HTTP2_PROTOCOL_ERROR、ERR_HTTP_1_1_REQUIRED），里面至少有一处连着三个字母；IPv4/IPv6 这样的写法。
const KNOWN_RUN = /^(?:(?=[A-Z\d_]*[A-Z]{3})[A-Z]+\d{0,3}(?:_(?:[A-Z]+\d{0,3}|\d{1,2}))+|[A-Za-z]{2,6}v\d(?:\/[A-Za-z]{2,6}v\d)*)$/;
// HTTP 的状态码。
const HTTP_STATUS = '(?:10[0-3]|20[0-8]|226|30[0-8]|4[0-2]\\d|43[01]|451|50\\d|51[01])';

// 凭据的名字后面的词，或者它的值后面的词，是这些的时候不是值：它在说那样东西怎么了，或者是这个名字的另一半。
const SAYS_WHAT = new Set((
    'is are was were be been being has have had does did do can cannot could will would should must may might not no none never already still yet again now then too also only '
    + 'and or of for to in on at by with from as the a an this that it its if when while after before because but so than via per into over under through up down out off about '
    + 'expired invalid missing required refused rejected denied failed found error mismatch revoked unknown unavailable unauthorized forbidden blocked banned frozen locked disabled '
    + 'exists changed empty wrong incorrect malformed timeout timed aborted cancelled canceled closed declined logged signed left gone needed expected returned received sent '
    + 'id agent header value field parameter data info status state code type refresh request response check login logout exchange lookup store file jar expiry validation verification '
    + 'authentication server address number network length size endpoint flow resolution risk profile read page service detected list settings interaction input '
    + 'null undefined true false valid active inactive new old stale present absent set unset ready pending ok '
    + 'suspended restricted deactivated terminated ended invalidated deleted removed created started stopped lost issued limited exceeded reached provided supplied given used reused '
    + 'expires expire expiring fails failure errors needs need requires require limit rate quota consent gesture window popup callback redirect scope access attempt attempts retry retries '
    + 'fetch decode decoding encode encoding parse parsing derivation generation rotation renewal creation import export sync sign signing format '
    + 'offline online late early short long large small many few much more less bound unbound verified unverified registered unregistered temporarily permanently currently '
    + 'other another any all some each both such same authorized authenticated allowed permitted supported available accepted established enabled completed '
    + 'json api url http https qr jwt sso'
).split(' '));
// 中文里在说「怎么了」的一截：从头到第一个不是汉字的字符，整个由下面这些词拼成（已过期、校验失败、
// 超时，请重新登录）。前面或者后面粘着别的字的是一个值（张三登录失败、登录失败的张三、无法无天）。
const SAYS_WHAT_CN = new RegExp('^(?:已|未|被|请|需要?|失败|失效|错误|有误|超时|过期|无效|无法|非法|异常|冻结|封禁|受限|频繁|拒绝|不存在|不正确|不匹配|不合法|不支持|不能|不可|不对'
    + '|没有|缺少|为空|找到|存在|绑定|注册|登录|校验|刷新|格式|验证|获取|解析|请求|认证|授权|签名|参数|状态|权限|重新|重试|稍后|再试)+(?!\\p{Script=Han})', 'u');
/**
 * 这个词是不是在说「怎么了」：上面那些词（大写的也算：EXPIRED）；凭据的名字自己（session cookie、
 * user name）；只有一个英文字母、数字或者符号的。别的词（一个名字、一小段凭据、别的全大写的一串）不是。
 */
const saysWhat = (word: string): boolean => {
    const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    return bare === '' || /^[\x20-\x7E]$/.test(bare) || SAYS_WHAT.has(bare.toLowerCase()) || SECRET_WORD.test(bare) || SAYS_WHAT_CN.test(bare);
};

// 一个不带引号的值，和它后面隔着空格的那几个词（到下一个分隔符、或者下一对「名字=值」为止）。词前面可以有一个逗号。
const BARE = String.raw`[^\s;,&"'<>)}\]]+`;
const TAIL = String.raw`((?:,? +(?![A-Za-z_][\w.-]*\s*[=:])${BARE})*)`;
// 像人名里的一个词：首字母大写的（Hua），或者单个大写字母（Q）。
const NAME_WORD = /^[A-Z][a-z]*$/;
/**
 * 那几个词里还算在值里面的有多长：数到第一个在说「怎么了」的词为止（Zhang San is frozen 里是 San）。
 * 值像人名的时候，紧跟着的像人名的词不管是什么都算（Li An、John Q Public、Zhang, San）；逗号后面只认这一种。
 */
const valueGoesOn = (tail: string, value: string): number => {
    let taken = 0;
    let named = NAME_WORD.test(value);
    for (const [whole, gap, word] of tail.matchAll(/(,? +)(\S+)/g)) {
        named = named && NAME_WORD.test(word);
        if (!(named || (gap[0] !== ',' && !saysWhat(word)))) break;
        taken += whole.length;
    }
    return taken;
};

// 一条规则对认出来的一段说：换成什么；原样留下（回它自己）；这不是我的（回 null，留给后面的规则）；
// 或者认下的比匹配到的多或者少（回 [换成什么, 从匹配的开头起认下多少个字符]，剩下的接着读）。
type Settled = string | null | [text: string, used: number];
type Rule = [RegExp, string | ((...match: string[]) => Settled)];

// 凭据的名字后面紧跟着的东西（隔着 = : 或者空格，前面可以有引号或者括号），不管像不像钟点、日期、版本号，
// 都不在这里留下：它由下面管名字的规则去换。
const AFTER_SECRET = `(?<!(?:${SECRET_WORDS}|name)["'\`]?(?:\\s*[=:]\\s*|\\s+)["'\`(\\[]?)`;
const kept = (pattern: RegExp): Rule => [new RegExp(AFTER_SECRET + pattern.source, 'gi'), whole => whole];

const RULES: Rule[] = [
    // 日期、钟点、时长和版本号（两段短的、一段至多五位的，后面可以跟内核版本那样的 -45-generic）原样留下。
    // 钟点的前后不能挨着冒号：那是 IPv6 地址里的一截。时长至多六位数：七位的是号码。
    kept(/(?<![\w.:-])\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\w:-])/),
    kept(/(?<![\w:.])\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?![\w:])/),
    kept(/(?<![\w.])\d{1,6}(?:\.\d+)?\s?(?:ms|s|sec|seconds?|min|minutes?|milliseconds?)\b/),
    kept(/(?<![\w.])\d{1,2}\.\d{1,2}\.\d{1,5}(?:-\d{1,4})?(?:-[a-z]{2,12})?(?![\w.])/),
    // 端口号，和连着写的几个 HTTP 状态码（200 404 500）：不是号码。前面还有一个数的不算，那是一串数字的后半截。
    [/\bport\s+\d{1,5}(?![\w.])/gi, whole => whole],
    kept(new RegExp(`(?<![\\w.:-]|\\d )${HTTP_STATUS}(?: ${HTTP_STATUS})+(?![\\w.:-])`)),
    // 带协议的地址，到第一个不会出现在地址里的字符为止；地址中间的一截非英文字符（后面还跟着 / ? # & =）也算在里面。
    [new RegExp(`[a-z][a-z0-9+.-]*:\\\\*/\\\\*/(?:${URL_CHARS}|[^\\x00-\\x7F]+(?=[/?#&=]))*`, 'gi'), '<address>'],
    [/[\w.+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/gi, '<email>'],
    // 文件路径。引号里的：到那个引号为止，路径里的空格也在里面。同一个引号后面紧跟着字母、数字或者分隔符的
    // 不是结尾，是文件夹名字里的撇号（O'Brien）。引号没有合上（被截断了）就到这一行的末尾。
    [/(["'`])(?:[A-Za-z]:[\\/]|\\\\|~?\/)[^\n]*?(?:\1(?![\w\\/])|(?=\n)|$)/g, (_whole, quote) => `${quote}<path>${quote}`],
    // 盘符或者网络共享（\\server\share）开头的。路径里的空格：这一行后面还有分隔符就接着算（文件夹的名字可以是
    // 好几个词），到一个文件名为止。会多带走几个普通的词；拿不准的时候宁可多换。
    [new RegExp(`(?:[A-Za-z]:[\\\\/]|\\\\\\\\(?=[^\\s\\\\]))(?:(?:${PATH_PIECE}|${PATH_APOSTROPHE})+(?:(?<!\\.(?:${FILE_ENDINGS})) (?=(?:[^\\\\/\\n"'\`<>|]|${PATH_APOSTROPHE})*[\\\\/]))?)*`, 'g'), '<path>'],
    // 至少两段的 /a/b、~/a/b。路径里的空格跟到下一段。
    [new RegExp(`(?<![\\w<])~?/(?:[^\\s"'\`<>|/]+/)+${PATH_PIECE}*(?: (?=${PATH_PIECE}*/)${PATH_PIECE}+)*`, 'g'), '<path>'],
    // 不带协议的主机名，连同端口和后面的路径、查询。只认小写的：句号后面紧跟着大写字母的是两句话。
    [new RegExp(`(?<![\\w.@-])(localhost|(?:[a-z0-9-]+\\.)+[a-z]{2,})(?![\\w-])((?::\\d+)?(?:[/?#]${URL_CHARS}*)?)`, 'g'), (_whole, host, tail) => (
        /^[a-z0-9-]+\.[a-z]+$/.test(host) && FILE_ENDING.test(host) && /^(?::\d+)?$/.test(tail) ? null : '<address>'
    )],
    // 剩下的查询串（?a=b&c=d），前面是什么都一样。
    [/\?[\w.%~-]+=[^\s"'<>]*/g, '?<query>'],
    // IPv6，连同 ::ffff: 后面的那四段和 %网卡；IPv4。后面的端口（至多五位）不是私人的，留在占位词后面：
    // 它说的是哪一个服务。IPv6 不带方括号的时候，四位以内的端口分不出来，算在地址里。
    [/(?<![\w:.])(?:[0-9a-f]{1,4})?(?::[0-9a-f]{0,4}){2,}(?:(?:\.\d{1,3}){3})?(?:%\w+)?(:\d{1,5}(?!\d))?(?![\w:])/gi, (_whole, port) => `<ip>${port ?? ''}`],
    [/\d{1,3}(?:\.\d{1,3}){3}(:\d{1,5}(?!\d))?/g, (_whole, port) => `<ip>${port ?? ''}`],
    // 「名字=值」「名字: 值」和 JSON 里的 "名字":"值"，名字是凭据、账号或者人名的（isSecretName：userId、openid、
    // nickName、data[nick]）：值整个换掉，前面是什么都一样（Error: user: …）。不带引号的值可以是好几个词。
    // 只有 name 自己下面的一个错误的类名留下。
    [new RegExp(String.raw`(?<![\w.-])(["']?)((?:[A-Za-z_][\w.-]*)?(?:${SECRET_WORDS}|name|id))\1\]?\s*[=:]\s*(?:Bearer\s+)?(?:"([^"]*)"|'([^']*)'|(${BARE})(?=${TAIL}))`, 'gi'), (whole, _quote, name, double, single, bare, tail) => {
        if (!isSecretName(name) || (/^name$/i.test(name) && ERROR_CLASS.test(double ?? single ?? bare))) return null;
        return [`${name}=<value>`, whole.length + (tail ? valueGoesOn(tail, bare) : 0)];
    }],
    // 验证码：一个 4 到 8 位的数（不是隔着空格或者短横的一串数字里的一截），它所在的那一小句里有说验证码的词
    // （VERIFY；紧挨在数前面的那个 = : 不算断句：验证码：4821、verification failed: 4821），或者它跟在 code 后面、
    // 后面接着 to sign in：换掉。排在留下错误代号的那几条规则前面；别的小句里的代号不受影响
    // （code 8821: 需要行为验证码验证）。
    [new RegExp(String.raw`(?<![\w./-]|\d[ -])\d{4,8}(?![\w/-]|\.\w|[ -]\d)(?<=(${CLAUSE}(?:[:=：]\s*["']?)?)\d{4,8})(?=(${CLAUSE}))`, 'g'), (_whole, before, after) => (
        VERIFY.test(before) || VERIFY.test(after) || (/\bcode\W*$/i.test(before) && /^\s+to\s+(?:sign|log)[\s-]?in\b/i.test(after)) ? '<number>' : null
    )],
    // failed: 20028、error: 20028：冒号后面至多五位的数是错误的代号，留下。同一小句里前面的词有凭据或者账号的
    // 名字的不算（uin error: 12345），那个数可能就是账号。
    [new RegExp(String.raw`(?<![\w.-])(?:failed|error)["']?\s*[:=：]\s*-?\d{1,5}(?![\w.-])(?<!(?:${SECRET_WORDS}|name|id)\b${CLAUSE}(?:failed|error)["']?\s*[:=：]\s*-?\d{1,5})`, 'gi'), whole => whole],
    // 别的名字：值不是普通的词就换掉。值自己又是一对「名字=值」的，留给那一对自己的名字去定。
    [/(?<![\w.-])(["']?)([A-Za-z_][\w.-]*)\1\s*[=:]\s*(?:Bearer\s+)?(?:"([^"]*)"|'([^']*)'|((?![A-Za-z_][\w.-]*[=:])[^\s;,&"'<>)}\]]+))/g, (whole, _quote, name, double, single, bare) => {
        const value = double ?? single ?? bare;
        if (CODE_NAME.test(name) && /^-?\d{1,6}$/.test(value)) return whole;
        return isPlain(value) ? null : `${name}=<value>`;
    }],
    [/\bBearer\s+[^\s"',;]+/gi, 'Bearer <value>'],
    // 引号里的包名（'@scope/name'）原样留下：应用自己的模块找不到时，那句话说的就是它。
    [/(?<=["'`])@[a-z][a-z0-9-]*\/[a-z][a-z0-9._-]*/g, whole => whole],
    // 8 个字符以上的串：字母和数字混着的，和不是普通词的一串字母。没有字母的留给下面的号码。
    [/[\w+/~%-]{8,}/g, run => (
        /[a-z]/i.test(run) && !KNOWN_RUN.test(run) && !ERROR_CLASS.test(run) && (/\d/.test(run) || !isPlain(run)) ? '<long>' : null
    )],
    // 错误的代号：code、errcode、错误码 后面隔着空格的至多六位的数留下（code 20028），errno、status 后面的至多五位
    // （六位的更像一个验证码）。前面的词说它是验证码的不算（sms code、your code，中间隔着多少空格、制表符、_ - 都一样）。
    [new RegExp(String.raw`(?<![A-Za-z\d])(?:err(?:or)?[_ ]?)?(?:code(?<!(?:${SECRET_CODES})[\s_-]*code)\s+-?\d{1,6}|(?:errno|status)\s+-?\d{1,5})(?![\w.-])|(?:错误码|状态码)[:：]?\s*-?\d{1,6}(?![\w.-])`, 'gi'), whole => whole],
    // 号码：中间隔着空格或短横的 7 位以上数字（前面可以有括号里的区号），用点隔开的三四位一组的，和连着的 5 位以上数字。
    [/(?:\(\d{2,4}\)\s*)?\+?\d(?:[ -]?\d){6,}/g, '<number>'],
    [/\d{3,4}(?:\.\d{3,4}){2,}/g, '<number>'],
    [/\d{5,}/g, '<number>'],
    // 凭据或者账号的名字后面隔着空格的那个词（token abc、user 1234）：不是在说「怎么了」的词就换掉，
    // 连同它后面还算在值里的词（user Zhang San is banned）。它在说「怎么了」的，再后面的那个词也得是这样的词
    // （user not found、token is invalid），不是的就是值（token is abc、password set abc）。它自己又是一个凭据的
    // 名字的，轮到它的时候再看（session cookie SAPISID）。再后面是引号的，引号里的整个是那个词（password is "abc"）。
    // cookie 后面全大写的一个词是那个 cookie 的名字（cookie SAPISID），不是值。
    [new RegExp(String.raw`\b(\w*(?:${SECRET_WORDS}|name)|id)(?=(\s+["']?)([^\s"'<>;,=:]+)(?=( +(["']))((?:(?!\5)[^\n])+)|)${TAIL})`, 'gi'), (name, _name, gap, value, open, _quote, quoted, tail) => {
        if (!isSecretName(name) || (/cookie$/i.test(name) && /^[A-Z]+(?:_[A-Z]+)*$/.test(value))) return null;
        if (!saysWhat(value)) return [`${name}${gap}<value>`, name.length + gap.length + value.length + valueGoesOn(tail, value)];
        if (SECRET_WORD.test(value) || /^id$/i.test(value)) return null;
        const after = open ? [open + quoted, open, quoted] : /^( +)(\S+)/.exec(tail);
        if (!after || saysWhat(after[2])) return null;
        const used = name.length + gap.length + value.length + after[0].length;
        return [`${name}${gap}${value}${after[1]}<value>`, used + (open ? 0 : valueGoesOn(tail.slice(after[0].length), after[2]))];
    }],
];

// 一段文字：`done` 的是一条规则已经认下来的，后面的规则不读。
type Piece = { text: string; done: boolean };

const applyRule = (pieces: Piece[], [pattern, by]: Rule): Piece[] => pieces.flatMap(piece => {
    if (piece.done) return [piece];
    const out: Piece[] = [];
    let from = 0;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(piece.text); match; match = pattern.exec(piece.text)) {
        const settled = typeof by === 'string' ? by : by(...match);
        if (settled === null) continue;
        const [text, used]: [string, number] = typeof settled === 'string' ? [settled, match[0].length] : settled;
        out.push({ text: piece.text.slice(from, match.index), done: false }, { text, done: true });
        from = match.index + used;
        pattern.lastIndex = from;
    }
    out.push({ text: piece.text.slice(from), done: false });
    return out;
});

// 截断处前面是一条不带引号的盘符路径（或者网络共享），它还没有到一个文件名：这一行后面有没有分隔符已经看不到，
// 路径到哪里为止说不准（文件夹的名字可以是好几个词，里面可以有跟在字母后面的撇号）。从这条路径的开头起都不要。
const CUT_PATH = new RegExp(`(?<![\\w"'\`])(?:[A-Za-z]:[\\\\/]|\\\\\\\\(?=[^\\s\\\\]))(?:(?!\\.(?:${FILE_ENDINGS}) )(?:[^\\n"'\`<>|]|(?<=[A-Za-z])'))*$`);

/** 把一段文字里像地址、路径、邮箱、IP、凭据、长串和号码的片段换成占位词，再截到 160 字。 */
export const cleanPrivateText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const head = value.slice(0, INPUT_LIMIT);
    // 截断处落在一条路径里（见上），或者落在一个词的中间：这一截不要了，半截的邮箱、半截的号码已经认不出形状。
    // 它的位置留一个省略号。
    const cut = value.length <= INPUT_LIMIT ? null : CUT_PATH.exec(head) ?? (/\S/.test(value[INPUT_LIMIT]) ? /\S+$/.exec(head) : null);
    const pieces: Piece[] = cut ? [{ text: head.slice(0, cut.index), done: false }, { text: '…', done: true }] : [{ text: head, done: false }];
    const text = RULES
        .reduce(applyRule, pieces)
        .map(piece => piece.text)
        .join('')
        .trim()
        .slice(0, OUTPUT_LIMIT)
        .trimEnd();
    return text || undefined;
};

// 一个地址拆成四截：协议、主机、路径、查询。读不成地址的整个算路径；没有的是 null。只在下面两处用，不往外给。
const addressParts = (value: unknown): [scheme: string, host: string, path: string, query: string] | null => {
    if (typeof value !== 'string' || !value) return null;
    try {
        const url = new URL(value);
        return [url.protocol.slice(0, -1), url.host, url.pathname, url.search + url.hash];
    } catch {
        return ['', '', value, ''];
    }
};
const LOCAL_HOST = /^(?:localhost|[^:]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/;

/**
 * 一个地址是哪一种，地址本身一个字都不带：blob、file、data，应用自己的协议的名字（folia- 开头的），http 和 https
 * 再说主机是这台机器还是别的（http local、https remote）。别的协议和读不成地址的是 other，没有的是 none。
 */
export const addressKind = (value: unknown): string => {
    const parts = addressParts(value);
    if (!parts) return 'none';
    const [scheme, host] = parts;
    if (/^https?$/.test(scheme)) return `${scheme} ${LOCAL_HOST.test(host) ? 'local' : 'remote'}`;
    return /^(?:blob|file|data|folia-[a-z-]{1,20})$/.test(scheme) ? scheme : 'other';
};

const ADDRESS_PARTS = ['kind', 'host', 'path', 'query'] as const;
/**
 * 两个地址从哪一截起不一样：kind（协议）、host（主机）、path（路径）、query（查询）；一样的是 null。只说是哪一截。
 * 只有查询不一样的两个地址是同一个文件换了签名；路径不一样的是两个文件。
 */
export const addressDifference = (one: unknown, other: unknown): typeof ADDRESS_PARTS[number] | null => {
    const [a, b] = [addressParts(one), addressParts(other)];
    if (!a || !b) return a === b ? null : 'kind';
    return ADDRESS_PARTS.find((_part, at) => a[at] !== b[at]) ?? null;
};

// 状态码和代号只能是一个数（至多 6 位），或者用 _ 和 - 连着的几个全小写、全大写的词（至多 24 个字符），
// 别的整个不要。
const CODE_WORDS = /^(?:[a-z]{1,15}|[A-Z]{1,15})\d{0,4}(?:[_-](?:[a-z]{1,15}|[A-Z]{1,15}|\d{1,4})\d{0,4})*$/;

export const cleanPrivateCode = (value: unknown): string | undefined => (
    typeof value === 'string' && (/^-?\d{1,6}$/.test(value) || (value.length <= 24 && CODE_WORDS.test(value))) ? value : undefined
);

// 抛出来的东西的那句话。一个错自己没有话（AggregateError）：是它里面第一个错的话。抛的不是错而是一个对象
// （一个 adapter 把平台的回答原样抛了）：是它的 JSON，里面的每一项由清洗按各自的名字去读。
const sentenceOf = (thrown: unknown): string => {
    if (thrown instanceof Error) {
        if (thrown.message) return thrown.message;
        const { errors, cause } = thrown as { errors?: unknown; cause?: unknown };
        const inside = Array.isArray(errors) ? errors[0] : cause;
        return inside instanceof Error ? inside.message : '';
    }
    if (typeof thrown !== 'object' || thrown === null) return String(thrown);
    try {
        return JSON.stringify(thrown) ?? Object.prototype.toString.call(thrown);
    } catch {
        return Object.prototype.toString.call(thrown);
    }
};

/**
 * 一个抛出的错在日志和诊断报告的时间线里留下的：它的名字，洗过的那句话，和它带着的代号（auth-required、
 * ECONNRESET；不像代号的整个不要，没有的就没有这一项）。名字只在它是一个名字的时候留下（一个字符串，至多
 * 40 个字母，或者一个错误的类名）：名字也可以是从外面来的数据设的，那样的换成 Error。
 */
export const cleanPrivateError = (error: unknown): { name: string; message: string; code?: string } => {
    const { name, code: held } = (error instanceof Error ? error : {}) as { name?: unknown; code?: unknown };
    const code = cleanPrivateCode(held);
    return {
        name: typeof name === 'string' && (/^[A-Za-z]{1,40}$/.test(name) || ERROR_CLASS.test(name)) ? name : 'Error',
        message: cleanPrivateText(sentenceOf(error)) ?? '',
        ...(code ? { code } : {}),
    };
};
