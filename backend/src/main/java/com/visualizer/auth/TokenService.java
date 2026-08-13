package com.visualizer.auth;

import java.time.Duration;
import java.time.Instant;

import javax.crypto.SecretKey;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.OctetSequenceKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;

import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

/**
 * Mints the access tokens this API accepts.
 *
 * HS256 rather than RS256 because the same process signs and verifies: there is
 * no third party who needs a public key, and asymmetric keys would add key
 * management for no one's benefit. If a second service ever needs to verify
 * these tokens independently, that is the moment to switch -- not before.
 *
 * The token carries name and email so the browser can render the account menu
 * straight from it, which is what removes the need for a "who am I" round trip
 * on every page load. They are display claims and nothing is authorised by them;
 * the subject is the only claim any decision is made on.
 */
public class TokenService {

    /**
     * Both signer and verifier check this, so a token minted by some other
     * Nimbus-based service that happened to share a key would still be rejected.
     */
    public static final String ISSUER = "visualizer";

    private final JwtEncoder encoder;
    private final Duration ttl;

    public TokenService(SecretKey key, Duration ttl) {
        OctetSequenceKey jwk = new OctetSequenceKey.Builder(key)
                .algorithm(JWSAlgorithm.HS256)
                .build();
        this.encoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
        this.ttl = ttl;
    }

    /** A signed token for this user, plus the expiry the client should plan around. */
    public MintedToken mint(User user) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(ttl);

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .issuedAt(now)
                .expiresAt(expiresAt)
                .subject(user.id())
                .claim("email", user.email())
                .claim("name", user.name())
                .build();

        String value = encoder.encode(
                JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();

        return new MintedToken(value, expiresAt);
    }

    public record MintedToken(String value, Instant expiresAt) {}
}
