"use strict";

// electron/aiCredentialStore.cjs
// AI provider API keys at rest. electron-store writes config.json as plain JSON, so keys saved with
// a bare `store.set` end up readable by anything that can read the file (issue #586). Here they are
// sealed with Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux)
// and only the ciphertext reaches disk.
//
// Linux without a real keyring selects `basic_text`, which "encrypts" with a hardcoded key. Unlike
// the KuGou/QQ/Bodian sessions, an API key is something the user typed in by hand, so dropping it on
// every restart would be a regression; in that case the key stays in plaintext, as before.

const AI_CREDENTIAL_KEYS = Object.freeze(['GEMINI_API_KEY', 'OPENAI_API_KEY']);
const SEALED_SUFFIX = '_SEALED';

const sealedKeyOf = (key) => `${key}${SEALED_SUFFIX}`;
const isAiCredentialKey = (key) => AI_CREDENTIAL_KEYS.includes(key);
const isSealedAiCredentialKey = (key) => AI_CREDENTIAL_KEYS.some((name) => sealedKeyOf(name) === key);

/**
 * Wraps an electron-store instance so AI API keys are read and written through safeStorage.
 * Decryption is lazy: Linux safeStorage is only usable after `app.whenReady()`.
 */
function createAiCredentialStore({ store, safeStorage, platform = process.platform, warn = console.warn }) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new TypeError('A compatible electron-store instance is required');
  }
  const cache = new Map();
  // Keys whose sealed blob exists but could not be decrypted (keyring locked, or a blob from another
  // user/machine). The renderer then sees '' and saves '' back on every settings save; that must not
  // be taken as "clear the key", or a locked keyring at startup would cost the user their key.
  const undecryptable = new Set();
  const warned = new Set();
  const warnOnce = (id, ...args) => {
    if (!warned.has(id)) {
      warned.add(id);
      warn(...args);
    }
  };

  const canEncrypt = () => {
    try {
      if (!safeStorage?.isEncryptionAvailable?.()) {
        return false;
      }
      if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
        return safeStorage.getSelectedStorageBackend() !== 'basic_text';
      }
      return true;
    } catch {
      return false;
    }
  };

  const remove = (name) => {
    if (typeof store.delete === 'function') {
      store.delete(name);
    } else {
      store.set(name, undefined);
    }
  };

  const get = (key) => {
    if (!isAiCredentialKey(key)) {
      return store.get(key);
    }
    if (cache.has(key)) {
      return cache.get(key);
    }
    const plain = store.get(key);
    const plainValue = typeof plain === 'string' ? plain : '';
    const sealed = store.get(sealedKeyOf(key));
    if (typeof sealed === 'string' && sealed) {
      try {
        if (!canEncrypt()) {
          throw new Error('Encryption unavailable');
        }
        const value = safeStorage.decryptString(Buffer.from(sealed, 'base64'));
        undecryptable.delete(key);
        cache.set(key, value);
        return value;
      } catch {
        // Not cached, so the key comes back once the keyring unlocks. A plaintext copy (written by
        // an older build, or by the basic_text fallback) is still a usable key in the meantime.
        undecryptable.add(key);
        warnOnce(`decrypt:${key}`, `[AiCredentials] ${key} could not be decrypted; re-enter it in settings`);
        return plainValue;
      }
    }
    cache.set(key, plainValue);
    return plainValue;
  };

  const set = (key, rawValue) => {
    if (!isAiCredentialKey(key)) {
      store.set(key, rawValue);
      return;
    }
    const value = typeof rawValue === 'string' ? rawValue : '';
    if (!value && undecryptable.has(key)) {
      // The renderer never saw this key, so its '' is not a deliberate clear.
      return;
    }
    undecryptable.delete(key);
    cache.set(key, value);
    if (!value) {
      remove(key);
      remove(sealedKeyOf(key));
      return;
    }
    if (canEncrypt()) {
      try {
        store.set(sealedKeyOf(key), safeStorage.encryptString(value).toString('base64'));
        remove(key);
        return;
      } catch (error) {
        warn(`[AiCredentials] Encrypting ${key} failed; keeping it unencrypted`, error);
      }
    } else {
      warnOnce(`plain:${key}`, `[AiCredentials] OS credential encryption unavailable; ${key} is stored unencrypted`);
    }
    store.set(key, value);
    remove(sealedKeyOf(key));
  };

  /** Re-saves any plaintext key left by older versions so it gets sealed. Call after app ready. */
  const migrate = () => {
    if (!canEncrypt()) {
      return;
    }
    for (const key of AI_CREDENTIAL_KEYS) {
      const plain = store.get(key);
      if (typeof plain === 'string' && plain) {
        set(key, plain);
      }
    }
  };

  /** Settings snapshot for the renderer: sealed blobs dropped, keys decrypted in their usual names. */
  const toPublicSettings = (settings) => {
    const result = { ...settings };
    for (const key of AI_CREDENTIAL_KEYS) {
      delete result[sealedKeyOf(key)];
      result[key] = get(key);
    }
    return result;
  };

  return {
    get,
    set,
    migrate,
    toPublicSettings,
    isEncrypted: canEncrypt,
    // Read-only store view for aiTextClient, which looks keys up with `store.get(name)`.
    settingsView: { get },
  };
}

module.exports = {
  AI_CREDENTIAL_KEYS,
  createAiCredentialStore,
  isAiCredentialKey,
  isSealedAiCredentialKey,
};
