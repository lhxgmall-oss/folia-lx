import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { COMMAND_PALETTE_COMMANDS } from '../../../command-palette/commandRegistry';
import { getCommandTitle } from '../../../command-palette/commandText';
import {
    GLOBAL_SHORTCUT_COMMAND_IDS,
    GLOBAL_SHORTCUT_MODIFIER_LABELS,
    readGlobalShortcutKey,
    refuseGlobalShortcutKey,
    toGlobalShortcutAccelerator,
    type GlobalShortcutKeyRefusal,
} from '../../../command-palette/globalShortcuts/globalShortcutRules';
import { useGlobalShortcutStatusStore } from '../../../command-palette/globalShortcuts/globalShortcutStatusStore';
import { useInteractionSettingsStore } from '../../../../stores/useInteractionSettingsStore';
import { Group, KeyCapture, Row, Select, Status, option, type SettingsGroupDef } from '../kit';

// src/components/modal/settings/pages/GlobalShortcutsGroup.tsx
// The 全局快捷键 group of the 快捷操作 page: five system-wide shortcuts of the desktop app, each a key
// pressed with the fixed Ctrl+Alt+Shift and one playback command. Which keys and commands are
// allowed is globalShortcutRules' answer; whether the system took a key is the main process's,
// read from the status store. On native Wayland the desktop binds the keys, which the group says.

export const GLOBAL_SHORTCUTS: SettingsGroupDef = { id: 'globalShortcuts', titleKey: 'options.settingsHeadingGlobalShortcuts', electronOnly: true };

const O = {
    slots: option(GLOBAL_SHORTCUTS, 'globalShortcutSlots', 'options.globalShortcuts'),
};

export const GLOBAL_SHORTCUTS_OPTIONS = Object.values(O);

const REFUSAL_KEYS: Record<GlobalShortcutKeyRefusal, string> = {
    'not-letter-or-digit': 'options.globalShortcutLettersAndDigits',
    reserved: 'options.globalShortcutReserved',
    duplicate: 'options.globalShortcutDuplicate',
};

export const GlobalShortcutsGroup: React.FC = () => {
    const { t } = useTranslation();
    const { bindings, setBinding } = useInteractionSettingsStore(useShallow(state => ({
        bindings: state.globalShortcutBindings,
        setBinding: state.setGlobalShortcutBinding,
    })));
    const { backend, refused } = useGlobalShortcutStatusStore(useShallow(state => ({
        backend: state.backend,
        refused: state.refused,
    })));
    const onPortal = backend === 'portal';

    const commandOptions = useMemo(() => [
        { value: '', label: t('options.globalShortcutNoCommand') },
        ...GLOBAL_SHORTCUT_COMMAND_IDS.flatMap((id) => {
            const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === id);
            return command ? [{ value: id, label: getCommandTitle(command, t) }] : [];
        }),
    ], [t]);

    // One validator per slot, so a key is refused against the other four.
    const validators = useMemo(() => bindings.map((_, slot) => (key: string): string | null => {
        const refusal = refuseGlobalShortcutKey(key, slot, bindings);
        return refusal ? t(REFUSAL_KEYS[refusal]) : null;
    }), [bindings, t]);
    const readKey = useCallback((event: KeyboardEvent) => readGlobalShortcutKey(event), []);

    return (
        <Group def={GLOBAL_SHORTCUTS} foot={t('options.globalShortcutsFoot')}>
            <Row option={O.slots} hint={t('options.globalShortcutsDesc')} note={t('options.globalShortcutsNote')} />
            {onPortal && <Row notice={t('options.globalShortcutsWayland')} />}
            {bindings.map((binding, slot) => {
                const isRefused = !onPortal && Boolean(binding.key && binding.commandId)
                    && refused.includes(toGlobalShortcutAccelerator(binding.key ?? ''));
                return (
                    <Row
                        key={slot}
                        sub
                        label={t('options.globalShortcutSlot', { index: slot + 1 })}
                        below={isRefused ? <Status tone="error">{t('options.globalShortcutTakenBySystem')}</Status> : undefined}
                    >
                        <KeyCapture
                            value={binding.key}
                            onChange={key => setBinding(slot, { key })}
                            validate={validators[slot]}
                            prefix={GLOBAL_SHORTCUT_MODIFIER_LABELS}
                            readKey={readKey}
                        />
                        <Select
                            name={t('options.globalShortcutCommand', { index: slot + 1 })}
                            value={binding.commandId ?? ''}
                            options={commandOptions}
                            onChange={value => setBinding(slot, { commandId: value || null })}
                        />
                    </Row>
                );
            })}
        </Group>
    );
};

export default GlobalShortcutsGroup;
