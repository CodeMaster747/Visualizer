package com.visualizer.auth;

import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import com.fasterxml.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The account file is the only durable state the app has, so the cases that
 * matter are the ones where it would be silently lost or silently duplicated.
 */
class FileUserStoreTest {

    @TempDir
    Path dir;

    private final ObjectMapper mapper = new ObjectMapper();
    private Path file;

    @BeforeEach
    void setUp() {
        file = dir.resolve("users.json");
    }

    private FileUserStore store() {
        return new FileUserStore(file, mapper);
    }

    private User user(String email) {
        return new User("id-" + email, email, "Ada", "$2a$10$hash", "2026-01-01T00:00:00Z");
    }

    @Test
    void storesAndFindsAnAccount() {
        FileUserStore store = store();

        assertThat(store.create(user("ada@x.dev"))).isTrue();

        assertThat(store.findByEmail("ada@x.dev")).map(User::name).contains("Ada");
        assertThat(store.count()).isEqualTo(1);
    }

    @Test
    void refusesASecondAccountOnTheSameAddress() {
        FileUserStore store = store();
        store.create(user("ada@x.dev"));

        // Returning false rather than overwriting is the whole point: the loser
        // of this race would otherwise replace someone else's password hash.
        assertThat(store.create(user("ada@x.dev"))).isFalse();
        assertThat(store.count()).isEqualTo(1);
    }

    @Test
    void treatsAddressesCaseInsensitively() {
        FileUserStore store = store();
        store.create(user("Ada@X.dev"));

        assertThat(store.create(user("ada@x.dev"))).isFalse();
        assertThat(store.findByEmail("ADA@X.DEV")).isPresent();
        // Stored normalised, so the file does not carry two spellings of one id.
        assertThat(store.findByEmail("ada@x.dev")).map(User::email).contains("ada@x.dev");
    }

    @Test
    void accountsSurviveARestart() {
        // The property that makes this a store rather than a cache: a second
        // instance over the same file is the process having been restarted.
        store().create(user("ada@x.dev"));

        FileUserStore reopened = store();

        assertThat(reopened.findByEmail("ada@x.dev")).isPresent();
        assertThat(reopened.count()).isEqualTo(1);
    }

    @Test
    void startsEmptyRatherThanRefusingToBootOnACorruptFile() throws Exception {
        Files.writeString(file, "{ this is not json");

        FileUserStore store = store();

        // Visualization needs no account file at all, so a truncated one must
        // not take the whole application down with it.
        assertThat(store.count()).isZero();
        assertThat(store.create(user("ada@x.dev"))).isTrue();
    }

    @Test
    void missingFileIsSimplyAnEmptyStore() {
        assertThat(store().count()).isZero();
        assertThat(store().findByEmail("nobody@x.dev")).isEqualTo(Optional.empty());
    }

    @Test
    void createsTheDirectoryItWasPointedAt() {
        // The data directory does not exist on a first run, and failing there
        // would mean the very first registration is the one that breaks.
        FileUserStore store = new FileUserStore(dir.resolve("nested/deeper/users.json"), mapper);

        assertThat(store.create(user("ada@x.dev"))).isTrue();
        assertThat(dir.resolve("nested/deeper/users.json")).exists();
    }

    @Test
    void anUnwritableDirectoryFailsLoudlyAndChangesNothing() throws Exception {
        Path readOnly = dir.resolve("locked");
        Files.createDirectory(readOnly);
        FileUserStore store = new FileUserStore(readOnly.resolve("users.json"), mapper);
        assertThat(readOnly.toFile().setWritable(false)).isTrue();

        try {
            assertThatThrownBy(() -> store.create(user("ada@x.dev")))
                    .isInstanceOf(UncheckedIOException.class);

            // Rolled back, so the process does not believe in an account that no
            // restart would ever see -- and the address stays free.
            assertThat(store.count()).isZero();
            assertThat(store.findByEmail("ada@x.dev")).isEmpty();
        } finally {
            readOnly.toFile().setWritable(true);
        }
    }
}
