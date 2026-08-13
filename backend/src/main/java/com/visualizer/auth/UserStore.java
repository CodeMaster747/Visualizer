package com.visualizer.auth;

import java.util.Optional;

/**
 * Where accounts live.
 *
 * An interface for the same reason {@link com.visualizer.trace.TraceArchive} is
 * one: the file-backed implementation is right for a single free-tier instance
 * and wrong the moment there are two, and the swap should be one class rather
 * than a refactor. A Postgres or Redis implementation satisfies this contract
 * with no change above it.
 */
public interface UserStore {

    /** Looked up by normalised (lowercased, trimmed) email. */
    Optional<User> findByEmail(String email);

    /**
     * Create an account, refusing to overwrite one.
     *
     * Returning a boolean rather than throwing keeps the check and the write in
     * one atomic step. A "does this email exist" call followed by a write is two
     * steps with a race between them, and the loser of that race would silently
     * replace someone else's account -- including their password hash.
     *
     * @return false if the email is already registered.
     */
    boolean create(User user);

    int count();
}
