package com.bidderr.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keeps the API keys encrypted (AES-GCM with a key that never leaves the Android Keystore),
 * like the Windows app does with DPAPI. Only the names in NAMES can be stored.
 */
final class SecretStore {
    private static final String ALIAS = "bidderr-secrets";
    private static final String PREFS = "secrets";
    private static final int IV_BYTES = 12;

    private SecretStore() {
    }

    static boolean isAllowed(String name) {
        return "key".equals(name) || "backupKey".equals(name);
    }

    /** The saved value, or "" if there is none (or it can't be read). */
    static synchronized String get(Context context, String name) {
        if (!isAllowed(name)) return "";
        String saved = prefs(context).getString(name, null);
        if (saved == null) return "";
        try {
            byte[] all = Base64.decode(saved, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 0, IV_BYTES));
            return new String(cipher.doFinal(all, IV_BYTES, all.length - IV_BYTES), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    /** Saves (or with an empty value, removes) a secret. Returns false if it could not be saved. */
    static synchronized boolean set(Context context, String name, String value) {
        if (!isAllowed(name)) return false;
        SharedPreferences.Editor editor = prefs(context).edit();
        if (value == null || value.isEmpty()) return editor.remove(name).commit();
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] data = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] all = new byte[iv.length + data.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(data, 0, all, iv.length, data.length);
            return editor.putString(name, Base64.encodeToString(all, Base64.NO_WRAP)).commit()
                    && value.equals(get(context, name));
        } catch (Exception e) {
            return false;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }
}
