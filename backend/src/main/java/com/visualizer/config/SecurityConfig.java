package com.visualizer.config;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

/**
 * API authentication against Microsoft Entra External ID -- when there is a
 * tenant to authenticate against, and not otherwise.
 *
 * The whole configuration hinges on one property. With `visualizer.azure.auth.
 * issuer-uri` blank the chain permits everything, which is the behaviour this
 * API has always had and the reason `docker compose up`, a bare `mvn test` and
 * a laptop with no Azure account all still work. Set the property and the same
 * endpoints start demanding a bearer token. Nothing else in the application
 * knows which mode it is in.
 *
 * Keeping both modes in one chain, rather than behind a profile, means the
 * unauthenticated path is the same code in development and production -- there
 * is no security configuration that only ever runs in one environment, which is
 * the kind that is wrong for months without anyone noticing.
 */
@Configuration
public class SecurityConfig {

    private static final Logger log = LoggerFactory.getLogger(SecurityConfig.class);

    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http, AppProperties props) throws Exception {
        var auth = props.azure().auth();

        http
                // No browser-session state to protect: every call carries its own
                // bearer token, so there is no ambient authority for a cross-site
                // request to borrow and nothing for CSRF tokens to defend.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // CORS is configured in WebConfig; this just tells the security
                // chain to honour it, so a preflight is not answered with a 401.
                .cors(cors -> {});

        if (!auth.enabled()) {
            log.info("API authentication disabled: no Entra issuer configured. "
                    + "Every endpoint is open, as in the pre-Azure build.");
            http.authorizeHttpRequests(reg -> reg.anyRequest().permitAll());
            return http.build();
        }

        log.info("API authentication enabled: validating tokens from {}.", auth.issuerUri());

        http
                .authorizeHttpRequests(reg -> reg
                        // Health is what the platform's probe calls, and it has no
                        // token to offer. It exposes nothing user-specific.
                        .requestMatchers("/api/health", "/actuator/health").permitAll()
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        // Anything not under /api is static frontend served by
                        // Caddy in every real deployment; if it reaches Spring at
                        // all, it is not something to guard behind a token.
                        .anyRequest().permitAll())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.decoder(decoder(auth))));

        return http.build();
    }

    /**
     * Decoder for Entra External ID tokens.
     *
     * `withIssuerLocation` resolves the tenant's OIDC metadata on first use
     * rather than at construction. That matters more here than it looks: this
     * runs on a free instance whose cold start is already measured in minutes,
     * and an eager `JwtDecoders.fromIssuerLocation` would add a network round
     * trip to every boot and refuse to start at all if Azure were briefly
     * unreachable -- turning an identity provider blip into a dead deployment.
     */
    private NimbusJwtDecoder decoder(AppProperties.Azure.Auth auth) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withIssuerLocation(auth.issuerUri()).build();

        OAuth2TokenValidator<Jwt> validator = JwtValidators.createDefaultWithIssuer(auth.issuerUri());
        if (auth.audience() != null && !auth.audience().isBlank()) {
            validator = new DelegatingOAuth2TokenValidator<>(
                    validator, new AudienceValidator(auth.audience()));
        } else {
            // Worth shouting about. Every application registered in the tenant
            // can mint tokens with this issuer, so issuer-only validation means
            // a token issued for some unrelated app is accepted here as if it
            // were meant for us.
            log.warn("No Entra audience configured: any token from this tenant will be accepted. "
                    + "Set VISUALIZER_AZURE_AUTH_AUDIENCE to the API's client id.");
        }
        decoder.setJwtValidator(validator);
        return decoder;
    }

    /** Rejects tokens minted for a different application in the same tenant. */
    record AudienceValidator(String audience) implements OAuth2TokenValidator<Jwt> {
        @Override
        public OAuth2TokenValidatorResult validate(Jwt token) {
            List<String> audiences = token.getAudience();
            if (audiences != null && audiences.contains(audience)) {
                return OAuth2TokenValidatorResult.success();
            }
            return OAuth2TokenValidatorResult.failure(new OAuth2Error(
                    "invalid_token",
                    "The token was not issued for this API.",
                    "https://tools.ietf.org/html/rfc6750#section-3.1"));
        }
    }
}
