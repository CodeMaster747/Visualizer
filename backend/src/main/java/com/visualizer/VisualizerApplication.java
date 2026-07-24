package com.visualizer;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Orchestrator for the Visualizer.
 *
 * Sits in front of the language tracer services and owns everything that should
 * not live next to untrusted code being executed: request validation, rate
 * limiting, content-addressed caching, and LLM narration. The tracers stay dumb
 * and disposable; the smarts and the state live here.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class VisualizerApplication {
    public static void main(String[] args) {
        SpringApplication.run(VisualizerApplication.class, args);
    }
}
