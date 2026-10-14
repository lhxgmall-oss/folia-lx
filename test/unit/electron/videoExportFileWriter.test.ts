import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// test/unit/electron/videoExportFileWriter.test.ts

const {
    PART_FILE_SUFFIX,
    createVideoExportFileWriter,
} = require('../../../electron/videoExportFileWriter.cjs') as {
    PART_FILE_SUFFIX: string;
    createVideoExportFileWriter: () => {
        open: (filePath: string) => Promise<string>;
        append: (id: string, data: unknown) => Promise<number>;
        finish: (id: string) => Promise<{ filePath: string; bytesWritten: number }>;
        abort: (id: string) => Promise<boolean>;
        disposeSync: () => void;
    };
};

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe('videoExportFileWriter', () => {
    let dir: string;
    let target: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-video-export-'));
        target = path.join(dir, 'song.webm');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('appends chunks in call order and renames the part file on finish', async () => {
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);

        // Not awaited one by one: concurrent IPC calls must still land in order.
        await Promise.all([
            writer.append(id, bytes(1, 2)),
            writer.append(id, bytes(3)),
            writer.append(id, new Uint8Array([4, 5, 6]).subarray(1)),
        ]);
        expect(fs.existsSync(target)).toBe(false);

        const result = await writer.finish(id);
        expect(result).toEqual({ filePath: target, bytesWritten: 5 });
        expect([...fs.readFileSync(target)]).toEqual([1, 2, 3, 5, 6]);
        expect(fs.existsSync(`${target}${PART_FILE_SUFFIX}`)).toBe(false);
    });

    it('replaces an existing file only once the export finished', async () => {
        fs.writeFileSync(target, 'previous');
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);
        await writer.append(id, bytes(9));
        expect(fs.readFileSync(target, 'utf8')).toBe('previous');

        await writer.finish(id);
        expect([...fs.readFileSync(target)]).toEqual([9]);
    });

    it('abort deletes the partial file and leaves the target untouched', async () => {
        fs.writeFileSync(target, 'previous');
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);
        await writer.append(id, bytes(1));

        expect(await writer.abort(id)).toBe(true);
        expect(fs.existsSync(`${target}${PART_FILE_SUFFIX}`)).toBe(false);
        expect(fs.readFileSync(target, 'utf8')).toBe('previous');
        await expect(writer.append(id, bytes(2))).rejects.toThrow(/not open/);
        expect(await writer.abort(id)).toBe(false);
    });

    it('opening a new session discards the stale one', async () => {
        const writer = createVideoExportFileWriter();
        const stale = await writer.open(path.join(dir, 'stale.webm'));
        await writer.append(stale, bytes(1));

        const fresh = await writer.open(target);
        expect(fs.existsSync(path.join(dir, `stale.webm${PART_FILE_SUFFIX}`))).toBe(false);
        await expect(writer.finish(stale)).rejects.toThrow(/not open/);

        await writer.append(fresh, bytes(7));
        await writer.finish(fresh);
        expect([...fs.readFileSync(target)]).toEqual([7]);
    });

    it('rejects non-binary chunks', async () => {
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);
        await expect(writer.append(id, 'text')).rejects.toThrow(/binary/);
        await writer.abort(id);
    });

    it('disposeSync removes the partial file on quit', async () => {
        const writer = createVideoExportFileWriter();
        const id = await writer.open(target);
        await writer.append(id, bytes(1));

        writer.disposeSync();
        expect(fs.existsSync(`${target}${PART_FILE_SUFFIX}`)).toBe(false);
        expect(await writer.abort(id)).toBe(false);
    });
});
