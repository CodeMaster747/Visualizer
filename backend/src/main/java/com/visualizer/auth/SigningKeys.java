package com.visualizer.auth;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Base64;
import java.util.Set;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import com.visualizer.config.AppProperties;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The HMAC key that signs and verifies access tokens.
 *
 * Three ways to get one, in order of preference, and the ordering is the whole
 * design:
 *
 * <ol>
 *   <li>{@code VISUALIZER_AUTH_SECRET} from the environment. What production
 *       should use, because it is the only source that survives the container
 *       being replaced.</li>
 *   <li>A key file in the data directory, written the first time the app runs
 *       without a configured secret.</li>
 *   <li>A freshly generated key, persisted to that file.</li>
 * </ol>
 *
 * Step 2 is the one worth explaining. Generating a key per boot would be the
 * obvious "zero configuration" answer and it produces a specific, miserable bug:
 * the free instance sleeps after fifteen minutes idle, so every morning's first
 * visitor wakes a process holding a brand new key, every token minted yesterday
 * fails verification, and the app tells a user who did nothing wrong that their
 * session expired. Persisting the generated key means an unconfigured deployment
 * still survives sleeps and restarts, and only loses sessions when the
 * filesystem itself is replaced.
 */
public final class SigningKeys {

    private static final Logger log = LoggerFactory.getLogger(SigningKeys.class);

    /** HS256 requires a key of at least 256 bits; this is exactly that. */
    private static final int KEY_BYTES = 32;

    static final String KEY_FILE = "jwt-secret";

    private SigningKeys() {}

    public static SecretKey resolve(AppProperties.Auth auth) {
        if (auth.hasConfiguredSecret()) {
            return fromSecret(auth.secret());
        }

        Path keyFile = auth.dataPath().resolve(KEY_FILE);
        String stored = readIfPresent(keyFile);
        if (stored != null && !stored.isBlank()) {
            return fromSecret(stored);
        }

        byte[] fresh = new byte[KEY_BYTES];
        new SecureRandom().nextBytes(fresh);
        String encoded = Base64.getEncoder().encodeToString(fresh);
        write(keyFile, encoded);

        log.warn("No VISUALIZER_AUTH_SECRET set: generated a signing key and saved it to {}. "
                + "Sessions survive restarts, but not a redeploy that replaces the filesystem. "
                + "Set the variable in production to keep users signed in across deploys.", keyFile);

        // Derived from the encoded text, exactly as the next boot will derive it
        // when it reads that same text back. Returning the raw bytes here would
        // make the generating process the only one holding this key, so the
        // first restart would reject every token it had issued -- the failure
        // this whole class is written to prevent.
        return fromSecret(encoded);
    }

    /**
     * Any secret becomes a 256-bit key by hashing it.
     *
     * A raw {@code SecretKeySpec} over the given bytes would reject anything
     * shorter than 32 bytes, which turns a short passphrase in an env var into a
     * container that crash-loops at boot with a Nimbus stack trace. Hashing
     * accepts whatever the operator sets and still yields a full-length key. It
     * does not manufacture entropy -- a weak secret stays weak, which is why the
     * docs tell you to generate one with `openssl rand -base64 32`.
     */
    static SecretKey fromSecret(String secret) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(secret.trim().getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(digest, "HmacSHA256");
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is required of every JVM; unreachable in practice.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String readIfPresent(Path keyFile) {
        try {
            return Files.exists(keyFile) ? Files.readString(keyFile).trim() : null;
        } catch (IOException e) {
            log.warn("Could not read the signing key at {} ({}). A new one will be generated, "
                    + "which signs everyone out once.", keyFile, e.toString());
            return null;
        }
    }

    private static void write(Path keyFile, String encoded) {
        try {
            Path parent = keyFile.toAbsolutePath().getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(keyFile, encoded);
            try {
                Files.setPosixFilePermissions(keyFile, Set.of(
                        PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
            } catch (IOException | UnsupportedOperationException e) {
                log.debug("Could not restrict permissions on {}: {}", keyFile, e.toString());
            }
        } catch (IOException e) {
            // The alternative is booting with a key that dies with the process,
            // which is the exact "session expired every cold start" failure this
            // class exists to prevent. Better to fail at boot, where the log is
            // read, than at 3am in a user's browser.
            throw new UncheckedIOException(
                    "Could not write the signing key to " + keyFile
                            + ". Make the directory writable or set VISUALIZER_AUTH_SECRET.", e);
        }
    }
}
