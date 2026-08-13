package com.visualizer.api;

import java.io.UncheckedIOException;

import com.visualizer.auth.AuthService;
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

    /**
     * 409 rather than 400: the request was well formed, the address is simply
     * taken. The frontend keys off the status to offer the sign-in tab.
     */
    @ExceptionHandler(AuthService.EmailTakenException.class)
    ProblemDetail emailTaken(AuthService.EmailTakenException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, e.getMessage());
    }

    @ExceptionHandler(AuthService.InvalidCredentialsException.class)
    ProblemDetail invalidCredentials(AuthService.InvalidCredentialsException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, e.getMessage());
    }

    /**
     * The account file could not be written -- a read-only or unwritable data
     * directory, which is a deployment mistake rather than a user error.
     *
     * Answering 503 keeps it out of the 4xx bucket where a user might retry the
     * form forever, and the message says the part they can act on: nothing was
     * saved, so the address is still free once the operator fixes the mount.
     */
    @ExceptionHandler(UncheckedIOException.class)
    ProblemDetail storageUnavailable(UncheckedIOException e) {
        return ProblemDetail.forStatusAndDetail(
                HttpStatus.SERVICE_UNAVAILABLE,
                "Accounts cannot be saved right now, so nothing was created. Please try again later.");
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
