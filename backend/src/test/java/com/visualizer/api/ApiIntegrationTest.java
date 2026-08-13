package com.visualizer.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Exercises the full HTTP wiring (filters, controllers, exception handling)
 * without any tracer running: the tracers are simply unreachable, which is a
 * state the app must handle gracefully.
 *
 * Requests that reach a guarded endpoint carry `.with(jwt())`, which installs an
 * authenticated context without minting a real token -- what is under test here
 * is the endpoint, and SecurityConfigTest already owns the question of who gets
 * through the door.
 */
@SpringBootTest(properties = {
    "visualizer.auth.data-dir=target/test-auth-data",
    "visualizer.auth.secret=a-fixed-secret-so-the-suite-is-deterministic",
})
@AutoConfigureMockMvc
class ApiIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper mapper;

    /** Unique per run, so a leftover account file cannot fail the suite. */
    private static String freshEmail() {
        return "user-" + java.util.UUID.randomUUID() + "@x.dev";
    }

    @Test
    void healthReportsOkAndTracersDown() throws Exception {
        // No tracer is running in the test, so python is reported down but the
        // endpoint itself must still succeed.
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.narration").value(false))
                .andExpect(jsonPath("$.languages.python").value(false));
    }

    @Test
    void healthReportsEveryConfiguredLanguage() throws Exception {
        // Health probes the routing table rather than a hardcoded list, so a
        // language added there shows up here without touching this controller.
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.languages.java").exists())
                .andExpect(jsonPath("$.languages.javascript").exists())
                .andExpect(jsonPath("$.languages.typescript").exists());
    }

    @Test
    void unsupportedLanguageIsRejectedBeforeAnyTracerCall() throws Exception {
        mvc.perform(post("/api/trace").with(jwt())
                        .contentType("application/json")
                        .content("{\"language\":\"ruby\",\"source\":\"puts 1\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void blankSourceFailsValidation() throws Exception {
        mvc.perform(post("/api/trace").with(jwt())
                        .contentType("application/json")
                        .content("{\"language\":\"python\",\"source\":\"\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void narrateWithoutAKeyReturnsEmptyNotes() throws Exception {
        mvc.perform(post("/api/narrate").with(jwt())
                        .contentType("application/json")
                        .content("{\"language\":\"python\",\"source\":\"x=1\",\"steps\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notes").isEmpty());
    }

    @Test
    void unknownShareLinkIsNotFound() throws Exception {
        mvc.perform(get("/api/trace/" + "a".repeat(64)).with(jwt()))
                .andExpect(status().isNotFound());
    }

    @Test
    void malformedShareLinkIsAlsoJustNotFound() throws Exception {
        // Same answer as an unknown id on purpose. The id is a hash of the
        // source, so telling callers apart would let one probe for whose code
        // has been run here.
        mvc.perform(get("/api/trace/not-a-hash").with(jwt()))
                .andExpect(status().isNotFound());
    }

    @Test
    void registeringThenSigningInYieldsAUsableToken() throws Exception {
        // The round trip a new user makes, end to end through the real filter
        // chain: register, sign in again with the same credentials, and present
        // the resulting token to a guarded endpoint. A break anywhere in that
        // chain is the failure that makes the app unusable while every
        // individual unit test still passes.
        String email = freshEmail();
        String credentials = mapper.writeValueAsString(
                java.util.Map.of("name", "Ada Lovelace", "email", email, "password", "hunter2!!"));

        String registered = mvc.perform(post("/api/auth/register")
                        .contentType("application/json").content(credentials))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user.email").value(email))
                .andReturn().getResponse().getContentAsString();

        assertThat(mapper.readTree(registered).get("token").asText()).isNotBlank();

        String loggedIn = mvc.perform(post("/api/auth/login")
                        .contentType("application/json")
                        .content(mapper.writeValueAsString(
                                java.util.Map.of("email", email, "password", "hunter2!!"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        JsonNode token = mapper.readTree(loggedIn).get("token");
        assertThat(token.asText()).isNotBlank();

        // The token the API just issued is one the API accepts.
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token.asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email))
                .andExpect(jsonPath("$.name").value("Ada Lovelace"));
    }

    @Test
    void aSecondRegistrationOnTheSameAddressIsAConflict() throws Exception {
        String email = freshEmail();
        String body = mapper.writeValueAsString(
                java.util.Map.of("name", "Ada", "email", email, "password", "hunter2!!"));

        mvc.perform(post("/api/auth/register").contentType("application/json").content(body))
                .andExpect(status().isCreated());
        // 409 rather than 400, so the sign-in screen can offer the other tab.
        mvc.perform(post("/api/auth/register").contentType("application/json").content(body))
                .andExpect(status().isConflict());
    }

    @Test
    void aWrongPasswordIsRejectedWithoutSayingWhichHalfWasWrong() throws Exception {
        String email = freshEmail();
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content(mapper.writeValueAsString(java.util.Map.of(
                                "name", "Ada", "email", email, "password", "hunter2!!"))))
                .andExpect(status().isCreated());

        mvc.perform(post("/api/auth/login").contentType("application/json")
                        .content(mapper.writeValueAsString(
                                java.util.Map.of("email", email, "password", "not-the-password"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("Incorrect email or password."));
    }

    @Test
    void garbageInTheCredentialsIsA400RatherThanA500() throws Exception {
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"email\":\"\",\"password\":\"\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void theApiRefusesAnonymousCallers() throws Exception {
        // The inverse of the old assertion here, which pinned that the API was
        // open. It is not open any more, and that is now the invariant worth
        // guarding: authentication is unconditional, so there is no
        // configuration that can silently switch it off.
        mvc.perform(post("/api/trace")
                        .contentType("application/json")
                        .content("{\"language\":\"python\",\"source\":\"x=1\"}"))
                .andExpect(status().isUnauthorized());
    }
}
