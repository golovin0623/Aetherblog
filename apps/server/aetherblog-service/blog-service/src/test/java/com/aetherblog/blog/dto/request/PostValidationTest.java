package com.aetherblog.blog.dto.request;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;

class PostValidationTest {

    private static Validator validator;

    @BeforeAll
    static void setUp() {
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @Test
    void testCreatePostValid() {
        CreatePostRequest request = new CreatePostRequest(
            "Title",
            "Content",
            "Summary",
            "https://example.com/image.jpg",
            1L,
            Collections.emptyList(),
            "DRAFT"
        );

        Set<ConstraintViolation<CreatePostRequest>> violations = validator.validate(request);
        assertTrue(violations.isEmpty(), "Valid https url should pass");
    }

    @Test
    void testCreatePostValidRelative() {
        CreatePostRequest request = new CreatePostRequest(
            "Title",
            "Content",
            "Summary",
            "/uploads/2026/01/01/image.jpg",
            1L,
            Collections.emptyList(),
            "DRAFT"
        );

        Set<ConstraintViolation<CreatePostRequest>> violations = validator.validate(request);
        assertTrue(violations.isEmpty(), "Valid relative url should pass");
    }

    @Test
    void testCreatePostInvalidJavascript() {
        CreatePostRequest request = new CreatePostRequest(
            "Title",
            "Content",
            "Summary",
            "javascript:alert(1)",
            1L,
            Collections.emptyList(),
            "DRAFT"
        );

        Set<ConstraintViolation<CreatePostRequest>> violations = validator.validate(request);
        assertFalse(violations.isEmpty(), "Javascript protocol should fail");

        boolean found = violations.stream()
            .anyMatch(v -> v.getPropertyPath().toString().equals("coverImage"));
        assertTrue(found, "Should have violation on coverImage field");
    }

    @Test
    void testCreatePostInvalidText() {
        CreatePostRequest request = new CreatePostRequest(
            "Title",
            "Content",
            "Summary",
            "not-a-url",
            1L,
            Collections.emptyList(),
            "DRAFT"
        );

        Set<ConstraintViolation<CreatePostRequest>> violations = validator.validate(request);
        assertFalse(violations.isEmpty(), "Invalid text should fail");
    }

    @Test
    void testUpdatePostPropertiesValid() {
        UpdatePostPropertiesRequest request = new UpdatePostPropertiesRequest(
            "Title",
            "Summary",
            "https://example.com/image.jpg",
            1L,
            Collections.emptyList(),
            "PUBLISHED",
            false,
            0,
            true,
            null,
            "slug",
            null
        );

        Set<ConstraintViolation<UpdatePostPropertiesRequest>> violations = validator.validate(request);
        assertTrue(violations.isEmpty(), "Valid https url should pass");
    }

    @Test
    void testUpdatePostPropertiesInvalid() {
        UpdatePostPropertiesRequest request = new UpdatePostPropertiesRequest(
            "Title",
            "Summary",
            "javascript:alert(1)",
            1L,
            Collections.emptyList(),
            "PUBLISHED",
            false,
            0,
            true,
            null,
            "slug",
            null
        );

        Set<ConstraintViolation<UpdatePostPropertiesRequest>> violations = validator.validate(request);
        assertFalse(violations.isEmpty(), "Javascript protocol should fail");
    }
}
