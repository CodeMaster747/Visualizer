package com.visualizer.auth;

/**
 * A registered account.
 *
 * The hash is a BCrypt digest and the plaintext password exists only for the
 * duration of the request that carried it -- nothing in this package holds it in
 * a field, logs it, or returns it. {@code createdAt} is an ISO-8601 string
 * rather than an {@link java.time.Instant} so the store can serialise the record
 * with a plain ObjectMapper and the file stays readable by a human, which is the
 * whole point of a file-backed store.
 *
 * @param id stable opaque identifier. This is the JWT subject, so it must never
 *        change: the rate limiter buckets by subject, and an id derived from the
 *        email would move the moment someone's address did.
 */
public record User(
        String id,
        String email,
        String name,
        String passwordHash,
        String createdAt
) {}
