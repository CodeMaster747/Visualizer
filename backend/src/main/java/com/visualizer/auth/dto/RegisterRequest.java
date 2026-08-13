package com.visualizer.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * @param password bounded at both ends. The floor is the usual minimum; the
 *        ceiling is not arbitrary -- BCrypt hashes at most 72 bytes and ignores
 *        everything after, so a 200-character password would silently be a
 *        72-character one. Rejecting it is honest where truncating is not.
 */
public record RegisterRequest(
        @Size(max = 80, message = "That name is too long.")
        String name,

        @NotBlank(message = "Enter an email address.")
        @Email(message = "That does not look like an email address.")
        @Size(max = 254)
        String email,

        @NotBlank(message = "Choose a password.")
        @Size(min = 8, max = 64, message = "Passwords must be 8 to 64 characters.")
        String password
) {}
