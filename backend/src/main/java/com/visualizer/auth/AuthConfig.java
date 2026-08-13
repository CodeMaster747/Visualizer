package com.visualizer.auth;

import javax.crypto.SecretKey;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizer.config.AppProperties;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * Wires the account system together.
 *
 * Everything here is constructed explicitly rather than component-scanned, so
 * the dependency arrows are visible in one file: the key is resolved once, the
 * encoder and decoder are built from that same key, and a test can construct any
 * of these with its own inputs.
 */
@Configuration
public class AuthConfig {

    @Bean
    SecretKey authSigningKey(AppProperties props) {
        return SigningKeys.resolve(props.auth());
    }

    @Bean
    TokenService tokenService(SecretKey authSigningKey, AppProperties props) {
        return new TokenService(authSigningKey, props.auth().tokenTtl());
    }

    /**
     * The verifying half, and the only place a token is trusted.
     *
     * Timestamp and issuer are both checked. Without the issuer check any token
     * that happened to be signed with the same key would be accepted, which
     * matters if the secret is ever reused for something else -- a mistake that
     * costs nothing to make impossible here.
     */
    @Bean
    JwtDecoder jwtDecoder(SecretKey authSigningKey) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(authSigningKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();

        OAuth2TokenValidator<Jwt> validator = new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(),
                new JwtIssuerValidator(TokenService.ISSUER));
        decoder.setJwtValidator(validator);
        return decoder;
    }

    /**
     * BCrypt at the default strength of 10.
     *
     * The instinct is to raise it, and on this hardware that instinct is wrong.
     * The free instance gets 0.1 vCPU, where the cost of each extra round is
     * paid in seconds of a user's sign-in rather than milliseconds. Strength 10
     * lands under a second there and still means an attacker holding the file
     * cannot test candidate passwords in bulk -- which is the property that
     * matters, and the reason the hash is not a bare SHA-256.
     */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    UserStore userStore(AppProperties props, ObjectMapper mapper) {
        return new FileUserStore(props.auth().dataPath().resolve("users.json"), mapper);
    }

    @Bean
    AuthService authService(UserStore userStore, PasswordEncoder passwordEncoder, TokenService tokenService) {
        return new AuthService(userStore, passwordEncoder, tokenService);
    }
}
