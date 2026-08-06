package com.visualizer.config;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.visualizer.config.SecurityConfig.AudienceValidator;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Audience checking is the part of token validation that is easy to leave out
 * and invisible when you do: an issuer-only check still rejects forgeries and
 * still accepts tokens minted for a completely different application in the
 * same tenant.
 */
class SecurityConfigTest {

    private static final String OURS = "11111111-1111-1111-1111-111111111111";

    private final AudienceValidator validator = new AudienceValidator(OURS);

    private Jwt tokenFor(String... audiences) {
        return new Jwt(
                "token-value",
                Instant.now(),
                Instant.now().plusSeconds(300),
                Map.of("alg", "RS256"),
                Map.of("sub", "user-1", "aud", List.of(audiences)));
    }

    @Test
    void acceptsATokenIssuedForThisApi() {
        assertThat(validator.validate(tokenFor(OURS)).hasErrors()).isFalse();
    }

    @Test
    void acceptsWhenOurAudienceIsOneOfSeveral() {
        assertThat(validator.validate(tokenFor("other-api", OURS)).hasErrors()).isFalse();
    }

    @Test
    void rejectsATokenForAnotherApplicationInTheSameTenant() {
        assertThat(validator.validate(tokenFor("some-other-app")).hasErrors()).isTrue();
    }

    @Test
    void rejectsATokenWithNoAudienceAtAll() {
        assertThat(validator.validate(tokenFor()).hasErrors()).isTrue();
    }

    @Test
    void authIsDisabledUntilAnIssuerIsConfigured() {
        // The switch the whole configuration turns on. Blank means the API
        // behaves exactly as it did before Azure, which is what lets the rest of
        // the test suite call it without a token.
        assertThat(AppProperties.Azure.disabled().auth().enabled()).isFalse();
        assertThat(new AppProperties.Azure.Auth("  ", "").enabled()).isFalse();
        assertThat(new AppProperties.Azure.Auth("https://tenant.ciamlogin.com/x/v2.0", OURS)
                .enabled()).isTrue();
    }
}
