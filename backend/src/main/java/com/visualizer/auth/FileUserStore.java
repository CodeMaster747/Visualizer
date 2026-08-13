package com.visualizer.auth;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import com.fasterxml.jackson.databind.ObjectMapper;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Accounts in a JSON file, indexed in memory.
 *
 * A database would be the reflex here and it is the wrong reflex for this
 * deployment. The binding constraint on the free instance is CPU -- 0.1 vCPU,
 * with a cold start already measured in minutes -- and Hibernate costs seconds
 * of that boot to manage a table that holds a handful of rows and is read once
 * per sign-in. This keeps the backend a single self-contained jar with no new
 * dependency, no schema migration and no second process to start, which is the
 * same reasoning that put Caffeine in front of the trace cache instead of Redis.
 *
 * What it deliberately does not try to be is a database: there is no query
 * beyond "find by email", every write rewrites the whole file, and two processes
 * sharing one file would corrupt it. All three are fine at one instance and none
 * are fine at two, which is exactly when {@link UserStore} gets a different
 * implementation.
 *
 * <p>Durability is the honest caveat. The file survives restarts, so a container
 * that sleeps and wakes -- the free tier's normal daily rhythm -- keeps its
 * accounts. It does not survive a redeploy that replaces the container's
 * filesystem, so on Render accounts are lost on each deploy unless the data
 * directory is a mounted disk. Documented rather than hidden.
 */
public class FileUserStore implements UserStore {

    private static final Logger log = LoggerFactory.getLogger(FileUserStore.class);

    private final Path file;
    private final ObjectMapper mapper;

    /**
     * Insertion-ordered so a rewrite does not shuffle the file on every save,
     * which would make each write a whole-file diff for no reason. Guarded by
     * {@code this} rather than being a concurrent map: reads are cheap and every
     * write has to be serialised against the file anyway.
     */
    private final Map<String, User> byEmail = new LinkedHashMap<>();

    public FileUserStore(Path file, ObjectMapper mapper) {
        this.file = file;
        this.mapper = mapper;
        load();
    }

    /** Normalised so "Ada@X.dev" and "ada@x.dev" cannot become two accounts. */
    static String normalise(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    @Override
    public synchronized Optional<User> findByEmail(String email) {
        return Optional.ofNullable(byEmail.get(normalise(email)));
    }

    @Override
    public synchronized boolean create(User user) {
        String key = normalise(user.email());
        if (byEmail.containsKey(key)) {
            return false;
        }
        // Stored under its normalised spelling as well as keyed by it. Letting
        // the record keep "Ada@X.dev" while the index says "ada@x.dev" would put
        // two spellings of one address in the file, and whichever one a later
        // lookup compared against would be a coin toss.
        byEmail.put(key, new User(user.id(), key, user.name(), user.passwordHash(), user.createdAt()));
        try {
            persist();
        } catch (IOException e) {
            // Roll the in-memory index back rather than leave the process
            // believing in an account that no restart would ever see again.
            byEmail.remove(key);
            throw new UncheckedIOException("Could not save the new account.", e);
        }
        return true;
    }

    @Override
    public synchronized int count() {
        return byEmail.size();
    }

    private void load() {
        if (!Files.exists(file)) {
            return;
        }
        try {
            User[] users = mapper.readValue(Files.readString(file), User[].class);
            for (User user : users) {
                byEmail.put(normalise(user.email()), user);
            }
            log.info("Loaded {} account(s) from {}.", byEmail.size(), file);
        } catch (IOException | RuntimeException e) {
            // Refusing to boot would take the whole app down -- including code
            // visualization, which needs no account file at all -- over a file
            // that a redeploy may simply have truncated. Start empty and say so
            // loudly; the file is replaced on the next successful write.
            log.error("Could not read the account file at {} ({}). Starting with no accounts; "
                    + "existing users will need to register again.", file, e.toString());
        }
    }

    /**
     * Write via a temporary file and an atomic rename.
     *
     * Writing in place means a crash mid-write leaves a half-written file, and
     * the half that survives is the account list -- every user gone. A rename is
     * atomic on the same filesystem, so a reader sees either the old file or the
     * new one and never a partial one.
     */
    private void persist() throws IOException {
        Path parent = file.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        List<User> snapshot = new ArrayList<>(byEmail.values());
        Path tmp = Files.createTempFile(parent, "users-", ".json.tmp");
        try {
            restrictPermissions(tmp);
            Files.writeString(tmp, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(snapshot));
            try {
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                // Some bind-mounted volumes cannot do it; a plain replace is
                // still better than writing in place.
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    /**
     * Owner-only, best effort.
     *
     * These are BCrypt hashes rather than passwords, so this is defence in depth
     * rather than the thing standing between an attacker and an account. Skipped
     * silently on a filesystem with no POSIX permissions (Windows, some volume
     * drivers) because failing a registration over file metadata would be a
     * worse outcome than the weaker mode.
     */
    private void restrictPermissions(Path path) {
        try {
            Files.setPosixFilePermissions(path, Set.of(
                    PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        } catch (IOException | UnsupportedOperationException e) {
            log.debug("Could not restrict permissions on {}: {}", path, e.toString());
        }
    }
}
