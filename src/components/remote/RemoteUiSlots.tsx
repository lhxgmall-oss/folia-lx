import React, { useEffect, useMemo } from 'react';
import { FoliumMountHost } from '@/mods/folium/FoliumMountHost';
import { useFoliumRegistryEntries, type FoliumRegistryEntry } from '@/mods/folium/registry';
import { createRemoteUiContext, remoteUiRegistry, updateRemoteUiSnapshot, type RemoteUiSnapshot, type RemoteUiComponent } from '@/mods/folium/remoteUi';
import { startRemoteUiClients } from '@/mods/folium/remoteUiLoader';

// src/components/remote/RemoteUiSlots.tsx
// A bounded append area below the native controls. No contributions means no DOM.
// Native transport, reaction and window-tool entries keep their original layout.
export function RemoteUiSlots({ snapshot, visible }: { snapshot: RemoteUiSnapshot; visible: boolean }) {
    const entries = useFoliumRegistryEntries(remoteUiRegistry);
    useEffect(startRemoteUiClients, []);
    useEffect(() => { updateRemoteUiSnapshot(snapshot); }, [snapshot]);
    if (!entries.length) return null;
    return <div data-folium-slot="remote-controls" hidden={!visible}
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
        style={{ position: 'absolute', bottom: 10, left: 16, right: 16, height: 32, overflow: 'auto', display: visible ? 'flex' : 'none', gap: 4, scrollbarWidth: 'thin', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {entries.map((entry) => <RemoteUiSlot key={entry.id} entry={entry} isDaylight={snapshot.isDaylight} />)}
    </div>;
}

function RemoteUiSlot({ entry, isDaylight }: { entry: FoliumRegistryEntry<RemoteUiComponent>; isDaylight: boolean }) {
    // Other mods registering/unregistering must not reset this component's input or local state.
    const ctx = useMemo(() => createRemoteUiContext(entry.id), [entry]);
    return <FoliumMountHost modId={entry.modId} entryId={entry.id}
        entryKind="remote-component" where={`remote.ui ${entry.id}`} mount={entry.def.mount} ctx={ctx} shadow
        style={{ flex: '0 0 auto', width: entry.def.width, height: 32,
            '--folium-primary': isDaylight ? '#18181b' : '#fafafa',
            '--folium-secondary': isDaylight ? '#71717a' : '#a1a1aa',
            '--folium-bg': isDaylight ? '#f5f5f4' : '#060814',
        } as React.CSSProperties} />;
}
