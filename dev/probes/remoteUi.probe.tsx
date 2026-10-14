import React, { useEffect, useState } from 'react';
import RemoteControlApp from '../../src/components/remote/RemoteControlApp';
import { PlayerState } from '../../src/types';
import { idleVideoExportState } from '../../src/types/videoExport';
import type { RemoteControlSnapshot } from '../../src/types/remoteControl';
import { createRemoteUiApi, remoteUiRegistry } from '../../src/mods/folium/remoteUi';
import type { FoliumRegistryHandle } from '../../src/mods/folium/contract';
import { remoteUi } from '../folium/sample-remote-ui/client.mjs';
import type { ProbeDefinition } from './definition';

// dev/probes/remoteUi.probe.tsx
// Real companion UI and the actual offline sample; only Electron IPC is mocked.
declare global { interface Window { remoteUiProbe: { enable(): void; disable(): void; fail(): void; clearFailure(): void; daylight(): void; log: string[] }; } }
function RemoteUiProbe() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const handles = new Set<FoliumRegistryHandle>(); let enabled = false; let count = 0;
        const log: string[] = []; let dispose: (() => void) | undefined;
        const state: RemoteControlSnapshot = {
            hasTrack: true, trackKey: 'probe:a', title: 'Remote component demo', artist: 'Offline fixture', coverUrl: null,
            currentTime: 12, duration: 180, playerState: PlayerState.PLAYING, loopMode: 'off',
            canGoPrevious: true, canGoNext: true, prevTrackKey: null, prevTrackTitle: null, prevTrackArtist: null,
            prevTrackCoverUrl: null, nextTrackKey: null, nextTrackTitle: null, nextTrackArtist: null, nextTrackCoverUrl: null,
            trackTransition: null, controlsDisabled: false, isStageActive: false, transparentModeEnabled: false,
            mainWindowClickThroughEnabled: false, mainWindowAlwaysOnTop: false, mainWindowBorderVisible: false,
            playerChromeHidden: false, playerChromeVisibilityMode: 'auto-hide', exportState: idleVideoExportState(),
            isDaylight: false, isLiked: false, canLike: true, updatedAt: 0,
        };
        let listener: ((snapshot: RemoteControlSnapshot) => void) | undefined;
        const previous = window.electron;
        window.electron = {
            getRemoteControlSnapshot: async () => ({ ...state }),
            onRemoteControlSnapshot: (callback: (snapshot: RemoteControlSnapshot) => void) => { listener = callback; return () => { listener = undefined; }; },
            sendRemoteControlCommand: async (command: { type: string }) => { log.push(command.type); return true; },
            mods: { invokeRemoteUiRpc: async (_modId: string, _url: string, name: string) => { log.push(name); return { ok: true, result: ++count }; } },
        } as unknown as NonNullable<typeof window.electron>;
        const disable = () => { enabled = false; dispose?.(); handles.forEach((handle) => handle.unregister()); remoteUiRegistry.unregisterAll('broken'); };
        window.remoteUiProbe = {
            enable: () => { if (enabled) return; enabled = true; dispose = remoteUi(createRemoteUiApi('sample', 'folia-mod://sample/client.mjs?v=1', () => enabled, handles)); },
            disable,
            fail: () => { remoteUiRegistry.register('broken', { id: 'bad', width: 24, mount: () => { throw new Error('expected sample error'); } }); },
            clearFailure: () => remoteUiRegistry.unregisterAll('broken'),
            daylight: () => { state.isDaylight = !state.isDaylight; listener?.({ ...state }); }, log,
        };
        setReady(true);
        return () => { disable(); window.electron = previous; };
    }, []);
    return ready ? <RemoteControlApp /> : null;
}
export default { id: 'remoteUi', title: 'Remote component slots', description: 'Append-only mod components, native controls, keyboard input and teardown.', Component: RemoteUiProbe } satisfies ProbeDefinition;
