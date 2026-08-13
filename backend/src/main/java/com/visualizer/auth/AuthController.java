package com.visualizer.auth;

import com.visualizer.auth.dto.AuthResponse;
import com.visualizer.auth.dto.LoginRequest;
import com.visualizer.auth.dto.RegisterRequest;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The three endpoints an account needs.
 *
 * {@code /register} and {@code /login} are the only paths under {@code /api}
 * open to an anonymous caller, for the obvious reason that requiring a token to
 * get a token cannot work. They are rate limited by IP (see RateLimitFilter),
 * which is what keeps that opening from being a free password-guessing oracle.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    AuthResponse register(@Valid @RequestBody RegisterRequest request) {
        return auth.register(request.name(), request.email(), request.password());
    }

    @PostMapping("/login")
    AuthResponse login(@Valid @RequestBody LoginRequest request) {
        return auth.login(request.email(), request.password());
    }

    /**
     * Who the bearer of this token is, according to the server.
     *
     * The browser can read the same claims out of the token without asking, and
     * for rendering it does exactly that. This exists for the case that matters:
     * confirming the token is still accepted here. A client cannot know that a
     * key was rotated or a token revoked by inspecting its own copy.
     */
    @GetMapping("/me")
    AuthResponse.Identity me(@AuthenticationPrincipal Jwt jwt) {
        return new AuthResponse.Identity(
                jwt.getClaimAsString("name"),
                jwt.getClaimAsString("email"));
    }
}
