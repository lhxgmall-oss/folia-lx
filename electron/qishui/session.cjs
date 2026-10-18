const { randomBytes } = require('node:crypto');

// Stores only accounts explicitly authorized in Folia; never imports another application's files.
// Account IDs are opaque strings; unlike track IDs they are not necessarily decimal numbers.
const isAccountId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\s\x00-\x1f\x7f]/u.test(value);
const SESSION_KEY = 'QISHUI_SESSION_V1';
const DEVICE_KEY = 'QISHUI_DEVICE_ID';
function createSessionRepository({ store, safeStorage, warn = console.warn }) {
    let loaded = false;
    let current = null;
    let revision = 0;
    let deviceId = store.get(DEVICE_KEY);
    if (typeof deviceId !== 'string' || !/^\d{19}$/.test(deviceId)) {
        deviceId = (randomBytes(8).readBigUInt64BE() % 9000000000000000000n + 1000000000000000000n).toString();
        store.set(DEVICE_KEY, deviceId);
    }
    const canEncrypt = () => safeStorage?.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    return {
        deviceId,
        get revision() { return revision; },
        get() {
            if (!loaded) {
                loaded = true;
                try {
                    const sealed = store.get(SESSION_KEY);
                    if (typeof sealed === 'string' && canEncrypt()) {
                        const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
                        if (value.version === 1 && isAccountId(value.userId) && value.ticket && value.guardKey
                            && value.guardCert && value.guardTsSign && value.accessCode && Number.isFinite(value.expiresAt)) current = value;
                    }
                } catch { warn('[Qishui] Account could not be restored'); }
            }
            return current;
        },
        set(value) {
            loaded = true;
            current = { ...value, version: 1 };
            revision++;
            try {
                if (!canEncrypt()) throw new Error('OS credential encryption is unavailable');
                store.set(SESSION_KEY, safeStorage.encryptString(JSON.stringify(current)).toString('base64'));
            } catch {
                store.delete(SESSION_KEY);
                warn('[Qishui] Account kept in memory for this run; OS encryption is unavailable');
            }
        },
        clear() { loaded = true; current = null; revision++; store.delete(SESSION_KEY); },
    };
}
module.exports = { createSessionRepository, SESSION_KEY, DEVICE_KEY, isAccountId };
