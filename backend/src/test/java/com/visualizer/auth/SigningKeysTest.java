package com.visualizer.auth;

import java.nio.file.Files;
import java.nio.file.Path;

import javax.crypto.SecretKey;

import com.visualizer.config.AppProperties;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Key resolution decides whether a restart signs everybody out, which is the
 * exact complaint this whole rewrite started from. These tests pin the three
 * sources and, more importantly, that the generated one is stable.
 */
class SigningKeysTest {

    @TempDir
    Path dir;

    private AppProperties.Auth auth(String secret) {
        return new AppProperties.Auth(secret, dir.toString(), 0);
    }

    @Test
    void usesTheConfiguredSecretWhenThereIsOne() {
        SecretKey key = SigningKeys.resolve(auth("a-configured-secret-value"));

        assertThat(key.getEncoded()).isEqualTo(SigningKeys.fromSecret("a-configured-secret-value").getEncoded());
        // Nothing written: a configured deployment does not need the key file,
        // and writing one would leave a second, stale source of truth behind.
        assertThat(dir.resolve(SigningKeys.KEY_FILE)).doesNotExist();
    }

    @Test
    void generatesAndPersistsAKeyWhenNoneIsConfigured() {
        SecretKey first = SigningKeys.resolve(auth(""));

        assertThat(dir.resolve(SigningKeys.KEY_FILE)).exists();
        assertThat(first.getEncoded()).hasSize(32);
    }

    @Test
    void reusesTheGeneratedKeyOnEveryLaterBoot() {
        // The bug this prevents: a key generated per boot means the free
        // instance waking from sleep rejects every token minted before it slept,
        // and tells users who did nothing wrong that their session expired.
        SecretKey first = SigningKeys.resolve(auth(""));
        SecretKey second = SigningKeys.resolve(auth(""));

        assertThat(second.getEncoded()).isEqualTo(first.getEncoded());
    }

    @Test
    void aConfiguredSecretWinsOverAPreviouslyGeneratedFile() throws Exception {
        SigningKeys.resolve(auth(""));
        assertThat(dir.resolve(SigningKeys.KEY_FILE)).exists();

        SecretKey configured = SigningKeys.resolve(auth("now-there-is-a-real-secret"));

        assertThat(configured.getEncoded())
                .isEqualTo(SigningKeys.fromSecret("now-there-is-a-real-secret").getEncoded());
        assertThat(Files.readString(dir.resolve(SigningKeys.KEY_FILE))).isNotBlank();
    }

    @Test
    void acceptsAShortPassphraseRatherThanCrashingAtBoot() {
        // HS256 needs 256 bits and a raw SecretKeySpec would throw on anything
        // less, turning a weak env var into a container that will not start.
        SecretKey key = SigningKeys.resolve(auth("short"));

        assertThat(key.getEncoded()).hasSize(32);
    }

    @Test
    void ignoresSurroundingWhitespaceInASecret() {
        // A secret pasted into a dashboard field or a .env line often carries a
        // trailing newline; the same secret must not produce two different keys.
        assertThat(SigningKeys.fromSecret("  the-secret\n").getEncoded())
                .isEqualTo(SigningKeys.fromSecret("the-secret").getEncoded());
    }

    @Test
    void differentSecretsProduceDifferentKeys() {
        assertThat(SigningKeys.fromSecret("secret-one").getEncoded())
                .isNotEqualTo(SigningKeys.fromSecret("secret-two").getEncoded());
    }
}
