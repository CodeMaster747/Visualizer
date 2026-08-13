package com.visualizer.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Who may call the API.
 *
 * Authentication is self-hosted: the tokens on these requests were minted by
 * this same application (see {@link com.visualizer.auth.TokenService}) and are
 * verified with the same key. There is no identity provider to reach, so there
 * is nothing here that can be unreachable, misconfigured, or configured on one
 * side only -- the three ways the previous Entra integration could fail.
 *
 * The rule is one line long: everything under {@code /api} needs a token, except
 * the two endpoints that hand one out and the health check that has none to
 * give. It is not conditional on any property, and that is the point. A security
 * configuration with a mode that only runs in production is the kind that is
 * wrong for months before anyone notices.
 */
@Configuration
public class SecurityConfig {

    /** Anonymous by necessity: you cannot present a token to obtain a token. */
    private static final String[] PUBLIC_PATHS = {
        "/api/auth/register",
        "/api/auth/login",
        // The platform's probe calls this and has no token to offer. It exposes
        // which languages are up and nothing user-specific.
        "/api/health",
        "/actuator/health",
    };

    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http, JwtDecoder jwtDecoder) throws Exception {
        http
                // No browser-session state to protect: every call carries its own
                // bearer token, so there is no ambient authority for a cross-site
                // request to borrow and nothing for CSRF tokens to defend. This
                // is also why the token is handed to the browser rather than set
                // as a cookie.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // CORS is configured in WebConfig; this just tells the security
                // chain to honour it, so a preflight is not answered with a 401.
                .cors(cors -> {})
                .authorizeHttpRequests(reg -> reg
                        .requestMatchers(PUBLIC_PATHS).permitAll()
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        // Anything not under /api is static frontend served by
                        // Caddy in every real deployment; if it reaches Spring at
                        // all, it is not something to guard behind a token.
                        .anyRequest().permitAll())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.decoder(jwtDecoder)));

        return http.build();
    }
}
