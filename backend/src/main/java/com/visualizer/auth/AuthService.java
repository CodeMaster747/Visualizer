package com.visualizer.auth;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import com.visualizer.auth.dto.AuthResponse;

import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Registration and sign-in.
 *
 * Small on purpose: the interesting decisions here are about what NOT to leak
 * and what NOT to skip, not about the flow, which is two lines each way.
 */
public class AuthService {

    /**
     * A BCrypt hash of nothing in particular, compared against when no account
     * exists. See {@link #login}.
     */
    private final String decoyHash;

    private final UserStore users;
    private final PasswordEncoder passwords;
    private final TokenService tokens;

    public AuthService(UserStore users, PasswordEncoder passwords, TokenService tokens) {
        this.users = users;
        this.passwords = passwords;
        this.tokens = tokens;
        this.decoyHash = passwords.encode("a password that is nobody's");
    }

    public AuthResponse register(String name, String email, String password) {
        String normalised = FileUserStore.normalise(email);
        String display = name == null || name.isBlank() ? nameFromEmail(normalised) : name.trim();

        User user = new User(
                UUID.randomUUID().toString(),
                normalised,
                display,
                passwords.encode(password),
                Instant.now().toString());

        if (!users.create(user)) {
            throw new EmailTakenException();
        }

        return respond(user);
    }

    public AuthResponse login(String email, String password) {
        Optional<User> found = users.findByEmail(email);

        // Hash even when there is no such account, and only then decide.
        //
        // BCrypt is deliberately slow, so returning early on an unknown email
        // makes "no such user" measurably faster than "wrong password" -- which
        // turns the login endpoint into an oracle for whether an address has an
        // account here. Doing the work either way costs one hash on a failed
        // login and removes the signal.
        String hash = found.map(User::passwordHash).orElse(decoyHash);
        boolean matches = passwords.matches(password, hash);

        if (found.isEmpty() || !matches) {
            throw new InvalidCredentialsException();
        }

        return respond(found.get());
    }

    private AuthResponse respond(User user) {
        TokenService.MintedToken token = tokens.mint(user);
        return new AuthResponse(
                token.value(),
                token.expiresAt().toEpochMilli(),
                new AuthResponse.Identity(user.name(), user.email()));
    }

    /**
     * "ada.lovelace@x.dev" -> "Ada Lovelace". The frontend derives the same name
     * when a form omits one, but a client is not the place to enforce that the
     * stored account has a display name at all.
     */
    static String nameFromEmail(String email) {
        String local = email.split("@")[0];
        String[] words = local.split("[._+\\-]+");
        StringBuilder out = new StringBuilder();
        for (String word : words) {
            if (word.isBlank()) {
                continue;
            }
            if (!out.isEmpty()) {
                out.append(' ');
            }
            out.append(Character.toUpperCase(word.charAt(0)))
               .append(word.substring(1).toLowerCase(Locale.ROOT));
        }
        return out.isEmpty() ? "Guest" : out.toString();
    }

    /** 409: the address is spoken for. */
    public static class EmailTakenException extends RuntimeException {
        public EmailTakenException() {
            super("That email address already has an account. Sign in instead.");
        }
    }

    /**
     * 401, with one message for both "no such account" and "wrong password".
     *
     * Telling them apart is friendlier and hands anyone who asks a list of which
     * addresses are registered here, which is the more expensive mistake.
     */
    public static class InvalidCredentialsException extends RuntimeException {
        public InvalidCredentialsException() {
            super("Incorrect email or password.");
        }
    }
}
