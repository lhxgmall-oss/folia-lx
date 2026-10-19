import { useEffect, useMemo, useRef } from 'react';
import { useInteractionSettingsStore } from '../../../stores/useInteractionSettingsStore';
import { commandForGlobalShortcut, resolveActiveGlobalShortcuts } from './globalShortcutRules';
import { useGlobalShortcutStatusStore } from './globalShortcutStatusStore';

// src/components/command-palette/globalShortcuts/useGlobalShortcuts.ts
// Keeps the main process's registered shortcuts in step with the stored bindings, and runs the
// bound command when one is pressed. Desktop only: on web `window.electron` is absent and this
// does nothing.

export const useGlobalShortcuts = (runCommand: (commandId: string) => void) => {
    const bindings = useInteractionSettingsStore(state => state.globalShortcutBindings);
    const active = useMemo(() => resolveActiveGlobalShortcuts(bindings), [bindings]);
    // A press is resolved against the bindings of that moment, so changing only the command of a
    // slot takes effect without registering the key again.
    const activeRef = useRef(active);
    activeRef.current = active;
    const runCommandRef = useRef(runCommand);
    runCommandRef.current = runCommand;

    const accelerators = active.map(shortcut => shortcut.accelerator).join(',');
    useEffect(() => {
        const setGlobalShortcuts = window.electron?.setGlobalShortcuts;
        if (!setGlobalShortcuts) {
            return;
        }
        let superseded = false;
        setGlobalShortcuts(accelerators ? accelerators.split(',') : [])
            .then((answer) => {
                if (!superseded) {
                    useGlobalShortcutStatusStore.getState().publish(answer);
                }
            })
            .catch((error) => {
                console.warn('[GlobalShortcut] registering failed', error);
            });
        return () => {
            superseded = true;
        };
    }, [accelerators]);

    useEffect(() => window.electron?.onGlobalShortcut?.((accelerator) => {
        const commandId = commandForGlobalShortcut(activeRef.current, accelerator);
        if (commandId) {
            runCommandRef.current(commandId);
        }
    }), []);
};
