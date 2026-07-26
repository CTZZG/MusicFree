package `fun`.upup.musicfree.securecredential

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureCredentialModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val MODULE_NAME = "SecureCredential"
        private const val KEY_ALIAS = "MusicFreeSecureCredentialKeyV1"
        private const val PREFERENCES_NAME = "secure-credentials-v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val MAX_KEY_LENGTH = 128
        private const val MAX_VALUE_LENGTH = 64 * 1024
    }

    private val preferences by lazy {
        reactApplicationContext.getSharedPreferences(
            PREFERENCES_NAME,
            Context.MODE_PRIVATE
        )
    }

    override fun getName() = MODULE_NAME

    private fun validateKey(key: String) {
        require(key.isNotBlank() && key.length <= MAX_KEY_LENGTH) {
            "Credential key is invalid"
        }
        require(key.matches(Regex("[A-Za-z0-9._-]+"))) {
            "Credential key contains unsupported characters"
        }
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
        }
        val existing = keyStore.getKey(KEY_ALIAS, null)
        if (existing is SecretKey) {
            return existing
        }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        keyGenerator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return keyGenerator.generateKey()
    }

    private fun encrypt(key: String, value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        cipher.updateAAD(key.toByteArray(StandardCharsets.UTF_8))
        val encrypted = cipher.doFinal(
            value.toByteArray(StandardCharsets.UTF_8)
        )
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val ciphertext = Base64.encodeToString(encrypted, Base64.NO_WRAP)
        return "v1:$iv:$ciphertext"
    }

    private fun decrypt(key: String, payload: String): String {
        val parts = payload.split(":", limit = 3)
        require(parts.size == 3 && parts[0] == "v1") {
            "Credential payload is invalid"
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            getOrCreateSecretKey(),
            GCMParameterSpec(
                128,
                Base64.decode(parts[1], Base64.NO_WRAP)
            )
        )
        cipher.updateAAD(key.toByteArray(StandardCharsets.UTF_8))
        return String(
            cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)),
            StandardCharsets.UTF_8
        )
    }

    @ReactMethod
    fun setCredential(key: String, value: String, promise: Promise) {
        try {
            validateKey(key)
            require(value.length <= MAX_VALUE_LENGTH) {
                "Credential value exceeds the size limit"
            }
            val committed = preferences.edit()
                .putString(key, encrypt(key, value))
                .commit()
            check(committed) { "Credential persistence failed" }
            promise.resolve(null)
        } catch (_: Exception) {
            promise.reject(
                "E_SECURE_CREDENTIAL_WRITE",
                "Unable to store secure credential"
            )
        }
    }

    @ReactMethod
    fun getCredential(key: String, promise: Promise) {
        try {
            validateKey(key)
            val payload = preferences.getString(key, null)
            promise.resolve(payload?.let { decrypt(key, it) })
        } catch (_: Exception) {
            promise.reject(
                "E_SECURE_CREDENTIAL_READ",
                "Unable to read secure credential"
            )
        }
    }

    @ReactMethod
    fun hasCredential(key: String, promise: Promise) {
        try {
            validateKey(key)
            val payload = preferences.getString(key, null)
            if (payload == null) {
                promise.resolve(false)
                return
            }
            decrypt(key, payload)
            promise.resolve(true)
        } catch (_: Exception) {
            promise.reject(
                "E_SECURE_CREDENTIAL_READ",
                "Unable to verify secure credential"
            )
        }
    }

    @ReactMethod
    fun deleteCredential(key: String, promise: Promise) {
        try {
            validateKey(key)
            val committed = preferences.edit().remove(key).commit()
            check(committed) { "Credential deletion failed" }
            promise.resolve(null)
        } catch (_: Exception) {
            promise.reject(
                "E_SECURE_CREDENTIAL_DELETE",
                "Unable to delete secure credential"
            )
        }
    }
}
