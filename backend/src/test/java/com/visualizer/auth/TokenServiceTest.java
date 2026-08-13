package com.visualizer.auth;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

import javax.crypto.SecretKey;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

/**
 * The round trip that everything else rests on: a token this app mints is a
 * token this app accepts, and nothing else is.
 */
class TokenServiceTest {

    private static final User ADA =
            new User("user-1", "ada@x.dev", "Ada Lovelace", "$2a$10$hash", "2026-01-01T00:00:00Z");

    private final SecretKey key = SigningKeys.fromSecret("the-test-signing-secret");

    /** The same decoder AuthConfig builds, kept in step by construction. */
    private JwtDecoder decoderFor(SecretKey signingKey) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(signingKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        OAuth2TokenValidator<Jwt> validator = new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(), new JwtIssuerValidator(TokenService.ISSUER));
        decoder.setJwtValidator(validator);
        return decoder;
    }

    @Test
    void mintsATokenThisApiAccepts() {
        TokenService tokens = new TokenService(key, Duration.ofHours(12));

        Jwt decoded = decoderFor(key).decode(tokens.mint(ADA).value());

        assertThat(decoded.getSubject()).isEqualTo("user-1");
        assertThat(decoded.getClaimAsString("email")).isEqualTo("ada@x.dev");
        assertThat(decoded.getClaimAsString("name")).isEqualTo("Ada Lovelace");
    }

    @Test
    void carriesTheUserIdAsSubjectRatherThanTheEmail() {
        // The rate limiter buckets by subject, so this has to be the identifier
        // that never changes -- an email-keyed bucket would move if an address
        // ever did, and the id is also what an account is joined on later.
        TokenService tokens = new TokenService(key, Duration.ofHours(12));

        assertThat(decoderFor(key).decode(tokens.mint(ADA).value()).getSubject())
                .isEqualTo(ADA.id())
                .isNotEqualTo(ADA.email());
    }

    @Test
    void rejectsATokenSignedWithADifferentKey() {
        // What a rotated or regenerated secret looks like from the verifying
        // side: everyone is signed out, nobody is let in on a stale token.
        TokenService elsewhere = new TokenService(SigningKeys.fromSecret("some-other-secret"),
                Duration.ofHours(12));
        String foreign = elsewhere.mint(ADA).value();

        assertThatThrownBy(() -> decoderFor(key).decode(foreign)).isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsAnExpiredToken() throws Exception {
        // Signed by hand rather than by TokenService, which refuses to mint a
        // token that expires before it was issued. An hour past expiry clears
        // the validator's default sixty seconds of clock skew, so this does not
        // depend on how fast the suite runs.
        Instant now = Instant.now();
        SignedJWT stale = new SignedJWT(
                new JWSHeader(JWSAlgorithm.HS256),
                new JWTClaimsSet.Builder()
                        .issuer(TokenService.ISSUER)
                        .subject(ADA.id())
                        .issueTime(Date.from(now.minus(Duration.ofHours(2))))
                        .expirationTime(Date.from(now.minus(Duration.ofHours(1))))
                        .build());
        stale.sign(new MACSigner(key.getEncoded()));

        assertThatThrownBy(() -> decoderFor(key).decode(stale.serialize()))
                .isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsATokenFromAnotherIssuerEvenOnTheRightKey() throws Exception {
        // Cheap insurance against the secret being reused for anything else
        // later: sharing a key would otherwise be enough to be believed here.
        Instant now = Instant.now();
        SignedJWT foreign = new SignedJWT(
                new JWSHeader(JWSAlgorithm.HS256),
                new JWTClaimsSet.Builder()
                        .issuer("some-other-service")
                        .subject(ADA.id())
                        .issueTime(Date.from(now))
                        .expirationTime(Date.from(now.plus(Duration.ofHours(1))))
                        .build());
        foreign.sign(new MACSigner(key.getEncoded()));

        assertThatThrownBy(() -> decoderFor(key).decode(foreign.serialize()))
                .isInstanceOf(JwtException.class);
    }

    @Test
    void reportsTheExpiryItActuallySet() {
        // The browser drops a token once this passes, so a wrong value here
        // shows up as a session that ends early or one that outstays the server.
        TokenService tokens = new TokenService(key, Duration.ofHours(12));

        TokenService.MintedToken minted = tokens.mint(ADA);

        assertThat(minted.expiresAt())
                .isCloseTo(Instant.now().plus(Duration.ofHours(12)), within(5, ChronoUnit.SECONDS));
    }
}
