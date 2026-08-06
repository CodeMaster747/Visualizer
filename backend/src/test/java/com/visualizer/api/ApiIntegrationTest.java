package com.visualizer.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Exercises the full HTTP wiring (filters, controllers, exception handling)
 * without any tracer running: the tracers are simply unreachable, which is a
 * state the app must handle gracefully.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApiIntegrationTest {

    @Autowired
    MockMvc mvc;

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
        mvc.perform(post("/api/trace")
                        .contentType("application/json")
                        .content("{\"language\":\"ruby\",\"source\":\"puts 1\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void blankSourceFailsValidation() throws Exception {
        mvc.perform(post("/api/trace")
                        .contentType("application/json")
                        .content("{\"language\":\"python\",\"source\":\"\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void narrateWithoutAKeyReturnsEmptyNotes() throws Exception {
        mvc.perform(post("/api/narrate")
                        .contentType("application/json")
                        .content("{\"language\":\"python\",\"source\":\"x=1\",\"steps\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notes").isEmpty());
    }

    @Test
    void unknownShareLinkIsNotFound() throws Exception {
        mvc.perform(get("/api/trace/" + "a".repeat(64)))
                .andExpect(status().isNotFound());
    }

    @Test
    void malformedShareLinkIsAlsoJustNotFound() throws Exception {
        // Same answer as an unknown id on purpose. The id is a hash of the
        // source, so telling callers apart would let one probe for whose code
        // has been run here.
        mvc.perform(get("/api/trace/not-a-hash"))
                .andExpect(status().isNotFound());
    }

    @Test
    void apiIsOpenWhileNoEntraTenantIsConfigured() throws Exception {
        // The test context sets no issuer, so the security chain must permit
        // everything -- a 401 here would mean the unauthenticated deployments
        // (laptop, docker compose, Render) had just been broken.
        mvc.perform(get("/api/health")).andExpect(status().isOk());
        mvc.perform(post("/api/trace")
                        .contentType("application/json")
                        .content("{\"language\":\"python\",\"source\":\"x=1\"}"))
                .andExpect(status().is(not(401)))
                .andExpect(status().is(not(403)));
    }
}
