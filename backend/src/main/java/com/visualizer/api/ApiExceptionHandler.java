package com.visualizer.api;

import com.visualizer.trace.TracerClient;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;

/**
 * Maps infrastructure failures to clean HTTP responses.
 *
 * The goal is that the frontend never sees a raw stack trace or a confusing 500:
 * a tracer being down is a 503 with a plain message, an unknown language is a
 * 400. Everything the user sees is actionable.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(TracerClient.UnsupportedLanguageException.class)
    ProblemDetail unsupportedLanguage(TracerClient.UnsupportedLanguageException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(ResourceAccessException.class)
    ProblemDetail tracerUnreachable(ResourceAccessException e) {
        // Connection refused / timeout to a tracer.
        return ProblemDetail.forStatusAndDetail(
                HttpStatus.SERVICE_UNAVAILABLE,
                "The execution service is unavailable. Please try again shortly.");
    }

    @ExceptionHandler(RestClientException.class)
    ProblemDetail tracerError(RestClientException e) {
        return ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_GATEWAY,
                "The execution service returned an unexpected response.");
    }
}
