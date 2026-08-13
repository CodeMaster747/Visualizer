package com.visualizer.auth;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import com.visualizer.auth.dto.AuthResponse;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Registration and sign-in, against an in-memory store.
 *
 * The interesting assertions are negative ones: what is not returned, not
 * stored, and not distinguishable from the outside.
 */
class AuthServiceTest {

    /** The store's contract, without the file. */
    private static final class InMemoryUserStore implements UserStore {
        private final Map<String, User> users = new HashMap<>();

        @Override
        public Optional<User> findByEmail(String email) {
            return Optional.ofNullable(users.get(FileUserStore.normalise(email)));
        }

        @Override
        public boolean create(User user) {
            return users.putIfAbsent(FileUserStore.normalise(user.email()), user) == null;
        }

        @Override
        public int count() {
            return users.size();
        }
    }

    private InMemoryUserStore store;
    private AuthService auth;

    @BeforeEach
    void setUp() {
        store = new InMemoryUserStore();
        // Strength 4 is the BCrypt minimum: same algorithm, a fraction of the
        // time, because this suite hashes on nearly every test.
        PasswordEncoder passwords = new BCryptPasswordEncoder(4);
        auth = new AuthService(store, passwords,
                new TokenService(SigningKeys.fromSecret("test-secret"), Duration.ofHours(1)));
    }

    @Test
    void registeringReturnsATokenAndTheIdentity() {
        AuthResponse response = auth.register("Ada Lovelace", "ada@x.dev", "hunter2!!");

        assertThat(response.token()).isNotBlank();
        assertThat(response.user().name()).isEqualTo("Ada Lovelace");
        assertThat(response.user().email()).isEqualTo("ada@x.dev");
        assertThat(response.expiresAt()).isGreaterThan(System.currentTimeMillis());
    }

    @Test
    void thePasswordIsHashedRatherThanStored() {
        auth.register("Ada", "ada@x.dev", "hunter2!!");

        String stored = store.findByEmail("ada@x.dev").orElseThrow().passwordHash();
        assertThat(stored).doesNotContain("hunter2!!").startsWith("$2");
    }

    @Test
    void nothingInTheResponseCarriesTheHash() {
        // The identity is what the browser gets; a hash reaching it would be a
        // hash in a log, a screenshot, and every proxy in between.
        AuthResponse response = auth.register("Ada", "ada@x.dev", "hunter2!!");

        assertThat(response.user().toString()).doesNotContain("$2");
    }

    @Test
    void derivesADisplayNameWhenNoneIsGiven() {
        assertThat(auth.register("", "ada.lovelace@x.dev", "hunter2!!").user().name())
                .isEqualTo("Ada Lovelace");
        assertThat(auth.register(null, "grace_hopper@x.dev", "hunter2!!").user().name())
                .isEqualTo("Grace Hopper");
    }

    @Test
    void normalisesTheAddressSoOneMailboxIsOneAccount() {
        auth.register("Ada", "  Ada@X.Dev ", "hunter2!!");

        assertThat(store.findByEmail("ada@x.dev")).isPresent();
        assertThatThrownBy(() -> auth.register("Impostor", "ADA@x.dev", "different"))
                .isInstanceOf(AuthService.EmailTakenException.class);
    }

    @Test
    void refusesASecondAccountOnTheSameAddress() {
        auth.register("Ada", "ada@x.dev", "hunter2!!");

        assertThatThrownBy(() -> auth.register("Someone", "ada@x.dev", "another!!"))
                .isInstanceOf(AuthService.EmailTakenException.class);
        assertThat(store.count()).isEqualTo(1);
    }

    @Test
    void signsInWithTheRightPassword() {
        auth.register("Ada", "ada@x.dev", "hunter2!!");

        assertThat(auth.login("ada@x.dev", "hunter2!!").user().email()).isEqualTo("ada@x.dev");
    }

    @Test
    void signsInRegardlessOfHowTheAddressIsTyped() {
        auth.register("Ada", "ada@x.dev", "hunter2!!");

        assertThat(auth.login(" ADA@X.dev ", "hunter2!!").token()).isNotBlank();
    }

    @Test
    void rejectsTheWrongPassword() {
        auth.register("Ada", "ada@x.dev", "hunter2!!");

        assertThatThrownBy(() -> auth.login("ada@x.dev", "not-it"))
                .isInstanceOf(AuthService.InvalidCredentialsException.class);
    }

    @Test
    void answersAnUnknownAddressExactlyAsItAnswersAWrongPassword() {
        // Telling them apart hands anyone who asks a list of which addresses are
        // registered here. Same exception, same message, and -- because login
        // hashes before it decides -- roughly the same time.
        auth.register("Ada", "ada@x.dev", "hunter2!!");

        Throwable unknown = org.assertj.core.api.Assertions
                .catchThrowable(() -> auth.login("nobody@x.dev", "hunter2!!"));
        Throwable wrong = org.assertj.core.api.Assertions
                .catchThrowable(() -> auth.login("ada@x.dev", "wrong"));

        assertThat(unknown).isInstanceOf(AuthService.InvalidCredentialsException.class);
        assertThat(wrong).isInstanceOf(AuthService.InvalidCredentialsException.class);
        assertThat(unknown.getMessage()).isEqualTo(wrong.getMessage());
    }

    @Test
    void twoAccountsWithTheSamePasswordGetDifferentHashes() {
        // BCrypt salts per hash, so a leaked file cannot be scanned for users
        // who share a password. Worth pinning: an unsalted digest would pass
        // every other test in this class.
        auth.register("Ada", "ada@x.dev", "same-password");
        auth.register("Grace", "grace@x.dev", "same-password");

        assertThat(store.findByEmail("ada@x.dev").orElseThrow().passwordHash())
                .isNotEqualTo(store.findByEmail("grace@x.dev").orElseThrow().passwordHash());
    }

    @Test
    void everyAccountGetsItsOwnSubject() {
        AuthResponse ada = auth.register("Ada", "ada@x.dev", "hunter2!!");
        AuthResponse grace = auth.register("Grace", "grace@x.dev", "hunter2!!");

        assertThat(ada.token()).isNotEqualTo(grace.token());
        assertThat(store.findByEmail("ada@x.dev").orElseThrow().id())
                .isNotEqualTo(store.findByEmail("grace@x.dev").orElseThrow().id());
    }

    @Test
    void nameFromEmailHandlesTheAwkwardCases() {
        assertThat(AuthService.nameFromEmail("ada.lovelace@x.dev")).isEqualTo("Ada Lovelace");
        assertThat(AuthService.nameFromEmail("ada@x.dev")).isEqualTo("Ada");
        assertThat(AuthService.nameFromEmail("@x.dev")).isEqualTo("Guest");
    }
}
