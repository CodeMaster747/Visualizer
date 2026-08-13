package com.visualizer.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The access matrix, asserted rather than assumed.
 *
 * This is a short file guarding a rule that is one line long and catastrophic in
 * both directions: too open and anyone can spend the instance's CPU running
 * code, too closed and the sign-in endpoints demand the token they exist to
 * issue. The previous version of this test checked a token-audience helper,
 * which was the detail; this checks the thing every request is actually decided
 * by.
 */
@SpringBootTest(properties = {
    // Keep the suite off the developer's real account file, and out of the
    // repository. `target` is already ignored and wiped by `mvn clean`.
    "visualizer.auth.data-dir=target/test-auth-data",
    "visualizer.auth.secret=a-fixed-secret-so-the-suite-is-deterministic",
})
@AutoConfigureMockMvc
class SecurityConfigTest {

    @Autowired
    MockMvc mvc;

    private static final String TRACE_BODY = "{\"language\":\"python\",\"source\":\"x=1\"}";

    @Test
    void runningCodeRequiresAToken() throws Exception {
        mvc.perform(post("/api/trace").contentType("application/json").content(TRACE_BODY))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void narrationRequiresAToken() throws Exception {
        // Narration spends LLM credits, so an open endpoint here is somebody
        // else's bill rather than merely somebody else's CPU.
        mvc.perform(post("/api/narrate").contentType("application/json")
                        .content("{\"language\":\"python\",\"source\":\"x=1\",\"steps\":[]}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void readingATraceRequiresAToken() throws Exception {
        mvc.perform(get("/api/trace/" + "a".repeat(64))).andExpect(status().isUnauthorized());
    }

    @Test
    void aTokenGetsYouPastTheGate() throws Exception {
        // 400 for the unsupported language, not 401: the request was let in and
        // then judged on its merits, which is the whole point.
        mvc.perform(post("/api/trace").with(jwt())
                        .contentType("application/json")
                        .content("{\"language\":\"ruby\",\"source\":\"puts 1\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void healthIsOpenBecauseTheProbeHasNoToken() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk());
    }

    @Test
    void theEndpointsThatIssueTokensDoNotRequireOne() throws Exception {
        // 401 here would be the deadlock: you cannot present a token to get a
        // token. These must fail on the credentials, never on the absence of a
        // bearer header.
        mvc.perform(post("/api/auth/login").contentType("application/json")
                        .content("{\"email\":\"nobody@x.dev\",\"password\":\"wrong-password\"}"))
                .andExpect(status().isUnauthorized());

        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"name\":\"\",\"email\":\"not-an-email\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest());
    }
}
