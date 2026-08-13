package com.visualizer.auth.dto;

/**
 * What a successful register or login returns.
 *
 * The token is handed to the browser rather than set as a cookie, because the
 * API is stateless and CSRF-free precisely by not having an ambient credential a
 * cross-site request could ride on -- see SecurityConfig. The frontend stores it
 * in sessionStorage and attaches it explicitly.
 *
 * @param expiresAt epoch millis, so the client can drop a dead token before
 *        spending a request to discover it is dead.
 */
public record AuthResponse(String token, long expiresAt, Identity user) {

    /** Everything the UI needs to render an account; deliberately nothing more. */
    public record Identity(String name, String email) {}
}
