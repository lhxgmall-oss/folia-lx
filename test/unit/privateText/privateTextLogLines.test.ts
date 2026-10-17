import { readdir, readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/privateText/privateTextLogLines.test.ts
// The rule for private text, held where nobody sees it by using the app: a log line, a note of
// the sign-in's timeline or a message on screen that carries a thrown error, an error's sentence
// or a platform's answer hands it to the cleaner (cleanPrivateError, cleanPrivateText, cleanPrivateCode,
// and for an address addressKind and addressDifference, in src/utils/privateText/privateText.ts).
// The test reads source; it does not run it.
//
// Which files: the online platforms' layer and the sign-in module (FOLDERS), and outside them
// every file under src/ that imports from the platforms' layer (IMPORTS_PLATFORMS) or is named in
// ALSO. Not src/services/automix (NOT_READ).
//
// What it reads: every `console.x(...)` call in its spellings (`console?.x(`, `console[x](`,
// `console.x.call(`), every `note(...)`, the calls that put a message on screen (SCREEN) and the
// answers to a Stage client (STAGE_ANSWER; the last of the four rules below is not asked of those).
// From the call's arguments it takes out the comments, the text of the strings, the names of
// object keys and every call of a cleaner. What is left may not hold
//   - a name a thrown thing goes by (ERROR_NAMES, and in each file the names its own catch
//     clauses and the second argument of a `.then(` bind), other than to read its `.code` or to
//     ask what it is an instance of;
//   - a name that was given a thrown thing's sentence on one line earlier in the file
//     (`const said = error.message`, `const { message } = error`), or an object written out in
//     brackets that holds one (`const report = {` ... `why: error.message,` ... `};`);
//   - a sentence or a private field read from anything (`.message`, `.msg`, `.nickname` and the
//     others of SAID), or `JSON.stringify`;
//   - an answer or a private thing standing whole as a value (a name with response, answer,
//     reply, payload or body in it, or `res`, `result`, `data`, `json`, `raw`, `profile`, `user`,
//     `cookie`). A field read from one is not counted.
//
// What it does not see: an error or an answer held under a name not listed; a name given a
// sentence over several lines other than such an object, through a function, by an assignment
// after its declaration or by a field set later (`report.why = error.message`); a rejection
// handler that is a function declared elsewhere; a private field not in SAID
// (`answer.signature`); a sentence read with a string key (`valueOf(answer, 'msg')`); `console`
// under another name (`const warn = console.warn`, `logger.warn(`); a message put on screen by
// a call not in SCREEN; a regular expression with a quote or a bracket inside such a call; the
// mods' own code outside src/ and every file that neither imports from the platforms' layer nor
// is listed.

const FOLDERS = ['src/services/onlineMusic', 'src/components/login'];
const IMPORTS_PLATFORMS = /\b(?:from|import)\s*\(?\s*['"][^'"\n]*onlineMusic[^'"\n]*['"]/;
// Files that are handed a platform's errors without importing anything from its layer, and the
// two that ask the user's own Navidrome server.
const ALSO: Array<{ file: string; why: string }> = [
    { file: 'src/utils/likePresses.ts', why: 'sends the like requests of the online platforms and prints what they threw' },
    { file: 'src/library/core/collection/resource/onlineCollectionSync.service.ts', why: 'reads the pages of an online collection and prints what a page read threw' },
    { file: 'src/services/navidromeService.ts', why: 'asks the user\'s Navidrome server and prints what a request threw; the server\'s address is private, and a request\'s address carries the user name and a token' },
    { file: 'src/components/modal/SettingsModal.tsx', why: 'tests the Navidrome server the user typed in and prints what reading its profile threw' },
];
const NOT_READ: Array<{ folder: string; why: string }> = [
    { folder: 'src/services/automix/', why: 'its six lines print what decoding or analysing a track threw; the folder was closed to the change that widened this test' },
];
// addressKind and addressDifference say what kind an address is and where two differ, never a piece of one.
const CLEANERS = ['cleanPrivateError', 'cleanPrivateText', 'cleanPrivateCode', 'addressKind', 'addressDifference'];
const ERROR_NAMES = String.raw`e\d?|ex|err|exception|failure|thrown|cause|\w*[Ee]rr(?:or)?(?:s|Message|Msg|Text)?`;
const SAID = 'message|stack|reason|cause|msg|errmsg|errMsg|error_description|error_msg|nickname';
// Calls that put a message on screen: the status line (under its own name, the name two files import it
// under, and the prop the views are handed it as), the sign-in's notices, a view's own error state.
const SCREEN = String.raw`setStatusMsg|setStatusMessage|onStatusMessage|tell|set\w*Error`;
// Calls that answer a Stage client, a program outside the app. Such an answer holds the app's own
// result and snapshot, so only a thrown thing and a sentence are looked for in it.
const STAGE_ANSWER = String.raw`completeStage\w+Request`;

// A piece of code that looks like a raw value to the rules above and is none. `has` is the code as
// it stands in the file; it is taken out of the call before the call is judged.
const ALLOWED: Array<{ file: string; has: string; why: string }> = [
    ...['src/services/onlineMusic/kugou/krcDecrypt.ts', 'src/services/onlineMusic/qq/qrcDecrypt.ts'].map(file => ({
        file,
        has: "'DecompressionStream warning (ignored):', error",
        why: "the browser's own error for lyric bytes that did not unpack whole: no request was made and no text from outside is in it",
    })),
    {
        file: 'src/library/core/account/providerLoginSession.service.ts',
        has: 'describeLoginError(error)',
        why: 'accountRules.describeLoginError spreads cleanPrivateError(error) and adds only numbers and flags (httpStatus, retryAfterMs, transient)',
    },
];

/** The source with every comment and the text of every string made blank: the same length, the same lines. What stands in a template's ${} stays. */
const codeOf = (source: string): string => {
    const out = source.split('');
    const blank = (from: number, to: number): void => {
        for (let at = from; at < to && at < out.length; at += 1) if (out[at] !== '\n') out[at] = ' ';
    };
    // One entry for each template we are inside: -1 in its text, else how many brackets are open in its ${}.
    const templates: number[] = [];
    for (let at = 0; at < source.length; at += 1) {
        const ch = source[at];
        const top = templates.length - 1;
        if (top >= 0 && templates[top] < 0) {
            if (ch === '`') templates.pop();
            else if (ch === '$' && source[at + 1] === '{') templates[top] = 0;
            if (ch === '\\' || (ch === '$' && source[at + 1] === '{')) {
                blank(at, at + 2);
                at += 1;
            } else blank(at, at + 1);
        } else if (ch === '"' || ch === "'") {
            let end = at + 1;
            while (end < source.length && source[end] !== ch && source[end] !== '\n') end += source[end] === '\\' ? 2 : 1;
            blank(at, end + 1);
            at = end;
        } else if (ch === '`') {
            templates.push(-1);
            blank(at, at + 1);
        } else if (ch === '/' && (source[at + 1] === '/' || source[at + 1] === '*')) {
            const close = source[at + 1] === '/' ? source.indexOf('\n', at) : source.indexOf('*/', at) + 2;
            const end = close < at ? source.length : close;
            blank(at, end);
            at = end - 1;
        } else if (top >= 0 && ch === '{') templates[top] += 1;
        else if (top >= 0 && ch === '}') {
            if (templates[top] === 0) {
                templates[top] = -1;
                blank(at, at + 1);
            } else templates[top] -= 1;
        }
    }
    return out.join('');
};

/** Where the bracket opened just before `from` closes. */
const closeOf = (code: string, from: number, [open, close] = '()'): number => {
    let depth = 1;
    let at = from;
    for (; at < code.length && depth > 0; at += 1) {
        if (code[at] === open) depth += 1;
        else if (code[at] === close) depth -= 1;
    }
    return at - 1;
};

/** The name the second argument of each `.then(` gives what the promise was rejected with. */
const rejectedOf = (code: string): string[] => [...code.matchAll(/\.then\s*\(/g)].flatMap(match => {
    const from = match.index + match[0].length;
    const args = code.slice(from, closeOf(code, from));
    let depth = 0;
    for (let at = 0; at < args.length; at += 1) {
        if ('([{'.includes(args[at])) depth += 1;
        else if (')]}'.includes(args[at])) depth -= 1;
        else if (args[at] === ',' && depth === 0) return /^\s*(?:async\s*)?\(?\s*(\w+)\s*(?::\s*\w+\s*)?\)?\s*=>/.exec(args.slice(at + 1))?.[1] ?? [];
    }
    return [];
});

/**
 * `code` with every call of one of `names` made blank, together with the `.message`, `.name` or
 * `.code` read from what it answers; or (`inside`) only what stands between a call's brackets.
 */
const withoutCalls = (code: string, names: string, inside = false): string => {
    let out = code;
    for (const match of code.matchAll(new RegExp(`\\b(?:${names})\\(`, 'g'))) {
        const from = match.index + (inside ? match[0].length : 0);
        const close = closeOf(code, match.index + match[0].length);
        const to = inside ? close : close + 1 + (/^\.(?:message|name|code)\b/.exec(code.slice(close + 1))?.[0].length ?? 0);
        if (to > from) out = out.slice(0, from) + ' '.repeat(to - from) + out.slice(to);
    }
    return out;
};

const ANSWER_LEFT = /\b(?:\w*(?:[Rr]esponse|[Aa]nswer|[Rr]eply|[Pp]ayload|[Bb]ody)\w*|res|result|data|json|raw|profile|user|cookies?)\b(?=\s*(?:[,})]|$))/;

/** The names that stand for a thrown thing in this file, beyond ERROR_NAMES. */
const namesOf = (code: string, cleaners: string): string[] => {
    const bound = [
        ...[...code.matchAll(/\bcatch\s*\(\s*(\w+)|\.catch\(\s*(?:async\s*)?\(?\s*(\w+)\s*(?::\s*\w+\s*)?\)?\s*=>/g)].map(match => match[1] ?? match[2]),
        ...rejectedOf(code),
    ];
    const thrown = [ERROR_NAMES, ...bound].join('|');
    const sentence = new RegExp(String.raw`\b(?:${thrown})\b\s*\??\.(?:message|stack)\b|\bString\(\s*(?:${thrown})\s*\)`);
    const uncleaned = withoutCalls(code, cleaners);
    // One line that gives a name the sentence of a thrown thing, and is no function; or an object
    // written out in brackets, over any number of lines, that holds such a sentence.
    const said = [
        ...[...uncleaned.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=;\n]+)?=(?![=>])([^;\n]*);/g)].map(match => [match[1], match[2]]),
        ...[...uncleaned.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=;\n]+)?=\s*\{/g)].map(match => {
            const from = match.index + match[0].length;
            return [match[1], uncleaned.slice(from, closeOf(uncleaned, from, '{}'))];
        }),
    ].filter(([, given]) => !given.includes('=>') && sentence.test(given)).map(([name]) => name);
    const taken = [...code.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}\n]*)\}\s*=\s*(?:${thrown})\s*;`, 'g'))]
        .flatMap(match => match[1].split(',').map(part => part.split(':').pop()!.trim()))
        .filter(name => name !== '' && name !== 'code');
    return [...new Set([...bound, ...said, ...taken])];
};

/** The log lines, notes and messages of one file that carry something raw: where each stands and how it begins. */
const rawLinesOf = (file: string, source: string, cleaners: string[]): string[] => {
    let code = codeOf(source);
    for (const allowed of ALLOWED) {
        if (allowed.file !== file) continue;
        // Every place it stands: a file can use the same allowed piece more than once.
        for (let at = source.indexOf(allowed.has); at >= 0; at = source.indexOf(allowed.has, at + allowed.has.length)) {
            code = code.slice(0, at) + ' '.repeat(allowed.has.length) + code.slice(at + allowed.has.length);
        }
    }
    const names = [ERROR_NAMES, ...namesOf(code, cleaners.join('|'))].join('|');
    const errorLeft = new RegExp(String.raw`(?<!\binstanceof\s+)\b(?:${names})\b(?!\s*(?:=>|\??\.code\b|instanceof\b))|\.(?:${SAID})\b|\bJSON\.stringify\b`);
    const raw: string[] = [];
    for (const call of code.matchAll(new RegExp(String.raw`\b(?:console\s*\??\.\s*\w+(?:\s*\.\s*(?:call|apply))?|console\s*\[[^\]\n]*\]|note|${SCREEN}|(${STAGE_ANSWER}))\s*(?:\?\.\s*)?\(`, 'g'))) {
        const from = call.index + call[0].length;
        const answersStage = call[1] !== undefined;
        // `Boolean(...)` says only whether a thing is there.
        const args = withoutCalls(code.slice(from, closeOf(code, from)), [...cleaners, 'Boolean'].join('|'))
            // The names of object keys.
            .replace(/(?<=[{,]\s*)\w+\s*:/g, key => ' '.repeat(key.length));
        if (errorLeft.test(args) || (!answersStage && ANSWER_LEFT.test(withoutCalls(args, '\\w+', true).trim()))) {
            raw.push(`${file}:${source.slice(0, call.index).split('\n').length} ${source.slice(call.index, call.index + 90).replace(/\s+/g, ' ')}`);
        }
    }
    return raw;
};

const sourcesOf = async (): Promise<Array<[string, string]>> => {
    const files = (await readdir('src', { recursive: true }))
        .map(name => `src/${name.replace(/\\/g, '/')}`)
        .filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts') && !NOT_READ.some(({ folder }) => file.startsWith(folder)));
    const all = await Promise.all(files.map(async (file): Promise<[string, string]> => [file, await readFile(file, 'utf8')]));
    return all.filter(([file, source]) => (
        FOLDERS.some(folder => file.startsWith(`${folder}/`)) || ALSO.some(also => also.file === file) || IMPORTS_PLATFORMS.test(source)
    ));
};

// A helper of a file that only passes an error to the cleaner and takes its sentence counts as a
// cleaner under its own name: `const wordsOf = (error: unknown) => cleanPrivateError(error).message`.
const HELPER = /const\s+(\w+)\s*=\s*\((\w+)(?::\s*unknown)?\)(?::\s*string)?\s*=>\s*cleanPrivateError\(\2\)\.message\s*;/g;
/**
 * Where a helper's name does not mean the cleaner: a file that declares it in another way (a
 * function, a `const` that is not that one line), or imports it from a file where it is not that helper.
 */
const otherHelpersOf = (sources: Array<[string, string]>, helpers: Iterable<string>): string[] => {
    const text = new Map(sources);
    const cleansIn = (source: string | undefined, name: string): number => [...(source ?? '').matchAll(HELPER)].filter(match => match[1] === name).length;
    return sources.flatMap(([file, source]) => [...helpers].filter(name => {
        const declared = (source.match(new RegExp(String.raw`\b(?:const|let|var|function)\s+${name}\b`, 'g')) ?? []).length;
        const imported = [...source.matchAll(new RegExp(String.raw`\bimport\b[^;]*\b${name}\b[^;]*\bfrom\s*['"]([^'"]+)['"]`, 'g'))];
        return declared !== cleansIn(source, name) || imported.some(([, path]) => {
            const from = posix.normalize(`${posix.dirname(file)}/${path}`);
            return cleansIn(text.get(`${from}.ts`) ?? text.get(`${from}.tsx`), name) === 0;
        });
    }).map(name => `${file}: ${name}`));
};

describe('the log lines and messages of the files that touch the online platforms', () => {
    const judged = (lines: string, cleaners = CLEANERS): boolean => rawLinesOf('a.ts', lines, cleaners).length > 0;

    it('the reader finds what it is for, and leaves a cleaned line alone', () => {
        for (const line of [
            "console.warn('[X] failed', error);",
            "console.warn('[X] failed', { providerId, error });",
            'console.warn(`[X] failed: ${error instanceof Error ? error.message : String(error)}`);',
            "console.warn('[X] failed', { name: error instanceof Error ? error.name : 'Error' });",
            "console.warn('[X] failed', status.error);",
            "console.warn('[X] failed', describeError);",
            'console.warn(`[X] failed (${result.error.message})`);',
            "console.warn('[X] api-error', { errCode, response: unionResponse });",
            "console.warn('[X] api-error', JSON.stringify(reply));",
            "note('check:error', { polls, message: error.message }, 'warn');",
            "console[level]('[X] failed', e);",
            'console.warn(`[X] failed: ${wordsOf(error)}`);',
        ]) expect(judged(line), line).toBe(true);
        for (const line of [
            "console.warn('[X] failed', cleanPrivateError(error));",
            "console.warn('[X] failed', { providerId, ...cleanPrivateError(error) });",
            'console.warn(`[X] failed after ${ms}ms: ${result.error.code} (${cleanPrivateText(result.error.message)})`);',
            "console.warn('[X] api-error', { errCode, status: valueOf(claimResponse, 'status') });",
            "console.info('[X] loaded', { count: playlists.length, more: Boolean(response?.more) });",
            'console.log(`[X] read ${answer.ids.length} ids, code ${home?.code}`);',
            "console.warn('[X] the error could not be told'); // error",
            "note('state', { state: 'error', polls });",
            "console.warn('[X] refused', { code: error instanceof OmniError ? error.code : 'unknown' });",
            "console.warn('[X] failed', cleanPrivateError(error).code);",
        ]) expect(judged(line), line).toBe(false);
        expect(rawLinesOf('a.ts', 'console.warn(`[X] failed: ${wordsOf(error)}`);', [...CLEANERS, 'wordsOf'])).toEqual([]);
    });

    // The shapes a later check found the reader blind to.
    it('the reader also finds a thrown thing under another name, a sentence given earlier, other spellings of the call and a message on screen', () => {
        for (const lines of [
            "console.warn('[X] failed', failure);",
            "console.warn('[X] failed', thrown);",
            "console.warn('[X] failed', ex);",
            "console.warn('[X] failed', exception);",
            "console.warn('[X] failed', cause);",
            "console.warn('[X] failed', errors);",
            "console.warn('[X] failed', e2);",
            "console.warn('[X] failed', errorMessage);",
            "console.warn('[X] failed', errMsg);",
            "console.warn('[X] failed', String(thrown));",
            "console.warn('[X] failed', { ...failure });",
            ".catch(reason => console.warn('[X] failed', reason));",
            "try { run(); } catch (oops) { console.warn('[X] failed', oops); }",
            "const said = error instanceof Error ? error.message : String(error);\nconsole.warn(`[X] failed: ${said}`);",
            "const { message } = error;\nconsole.warn('[X] failed', message);",
            'console.warn(`[X] failed: ${failure.cause}`);',
            "console.warn('[X] refused', response.msg);",
            "console.warn('[X] refused', data.errmsg);",
            "console.warn('[X] refused', answer.error_description);",
            "console.warn('[X] refused', res.data.profile.nickname);",
            "console.log('[X] signed in', profile);",
            "console.log('[X] signed in', user);",
            "console.log('[X] cookie', cookie);",
            "console?.warn('[X] failed', error);",
            "console.warn ('[X] failed', error);",
            "console.warn.call(console, '[X] failed', error);",
            "console['warn']('[X] failed', error);",
            "tell({ type: 'error', textKey: 'status.failed', params: { reason: status.error } });",
            "setStatusMsg({ type: 'error', text: error.message });",
            "setLoadError({ kind: 'generic', message: error instanceof Error ? error.message : String(error) });",
            // The fifth check's plants: what a promise was rejected with, the status line under its other names, an object written over several lines.
            "void run().then(undefined, problem => console.warn('[X] failed', problem));",
            "run().then(done => use(done, 1), (problem) => { console.warn('[X] failed', problem); });",
            "try { run(); } catch (problem) { onStatusMessage({ type: 'error', text: String(problem) }); }",
            "onStatusMessage?.({ type: 'error', text: error.message });",
            "setStatusMessage({ type: 'error', text: error.message });",
            "const report = {\n    at: Date.now(),\n    why: error instanceof Error ? error.message : String(error),\n};\nconsole.warn('[X] failed', report);",
            // An answer to a Stage client.
            "void window.electron?.completeStagePlayerControlRequest?.({ requestId, ok, error: ok ? null : error instanceof Error ? error.message : String(error) });",
            "await window.electron?.completeStageExternalPlayRequest?.({ requestId: request.requestId, ok: false, error: String(error) });",
        ]) expect(judged(lines), lines).toBe(true);
        for (const lines of [
            "const said = cleanPrivateError(error).message;\nconsole.warn(`[X] failed: ${said}`);",
            "try { run(); } catch (oops) { console.warn('[X] failed', cleanPrivateError(oops)); }",
            "setLoadError(error instanceof OmniError && error.code === 'not-public' ? { kind: 'not-public' } : { kind: 'generic', message: cleanPrivateError(error).message });",
            "setStatusMsg({ type: 'error', text: t('status.playbackFailed') });",
            "console.log('[X] signed in', { user: Boolean(user), cookies: cookies.length });",
            "void run().then(undefined, problem => console.warn('[X] failed', cleanPrivateError(problem)));",
            "run().then(done => console.info('[X] done', done.count, problem));",
            "setStatusMessage({ type: 'error', text: t('status.playbackFailed') });",
            "const report = {\n    at: Date.now(),\n    why: cleanPrivateError(error).message,\n};\nconsole.warn('[X] failed', report);",
            "void window.electron?.completeStagePlayerControlRequest?.({ requestId, ok, error: ok ? null : cleanPrivateError(error).message });",
            "await window.electron?.completeStagePlayerQueueRequest?.({ requestId: request.requestId, ok: true, result: actionData, baseSnapshot, snapshot });",
        ]) expect(judged(lines), lines).toBe(false);
    });

    it('print and show no thrown error, no sentence of one and no answer that did not pass the cleaner', async () => {
        const sources = await sourcesOf();
        expect(sources.length).toBeGreaterThan(180);
        const helpers = new Set(sources.flatMap(([, source]) => [...source.matchAll(HELPER)].map(match => match[1])));
        // A helper's name means the cleaner in every file that has it.
        const otherHelpers = otherHelpersOf(sources, helpers);
        const raw = sources.flatMap(([file, source]) => rawLinesOf(file, source, [...CLEANERS, ...helpers]));
        expect({ otherHelpers, raw }).toEqual({ otherHelpers: [], raw: [] });
        // Every allowed piece still stands in its file, and every listed file is there.
        for (const allowed of ALLOWED) {
            expect(sources.find(([file]) => file === allowed.file)?.[1], `${allowed.file}: ${allowed.why}`).toContain(allowed.has);
        }
        for (const also of ALSO) expect(sources.some(([file]) => file === also.file), `${also.file}: ${also.why}`).toBe(true);
    });

    it('a helper\'s name means the cleaner only where it is that one line, or comes from a file where it is', () => {
        const others = (sources: Array<[string, string]>): string[] => otherHelpersOf(sources, ['wordsOf']);
        const cleaning = 'export const wordsOf = (error: unknown) => cleanPrivateError(error).message;';
        expect(others([['src/a/x.ts', cleaning], ['src/a/y.ts', "import { wordsOf } from './x';"]])).toEqual([]);
        expect(others([['src/a/x.ts', 'function wordsOf(error: unknown) { return String(error); }']])).toEqual(['src/a/x.ts: wordsOf']);
        expect(others([['src/a/x.ts', 'const wordsOf = (error: unknown) => (error instanceof Error ? error.message : String(error));']])).toEqual(['src/a/x.ts: wordsOf']);
        expect(others([['src/a/x.ts', 'export const wordsOf = String;'], ['src/b/y.tsx', "import { wordsOf } from '../a/x';"]])).toEqual(['src/a/x.ts: wordsOf', 'src/b/y.tsx: wordsOf']);
    });
});
