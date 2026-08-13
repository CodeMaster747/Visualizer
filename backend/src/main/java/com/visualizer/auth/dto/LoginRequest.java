package com.visualizer.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Sign-in carries no format rules beyond "not empty".
 *
 * Validating the shape of a password on the way in would reject an account
 * created before the rules changed, and telling someone their existing password
 * is invalid is a worse failure than letting the hash comparison say no. The
 * length cap is only there so an oversized body cannot reach BCrypt at all.
 */
public record LoginRequest(
        @NotBlank(message = "Enter an email address.")
        @Size(max = 254)
        String email,

        @NotBlank(message = "Enter your password.")
        @Size(max = 200)
        String password
) {}
