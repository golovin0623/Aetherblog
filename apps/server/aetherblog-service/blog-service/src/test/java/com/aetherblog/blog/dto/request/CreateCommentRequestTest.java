package com.aetherblog.blog.dto.request;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class CreateCommentRequestTest {

    private static Validator validator;

    @BeforeAll
    static void setUp() {
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @Test
    void testValidWebsiteHttps() {
        CreateCommentRequest request = new CreateCommentRequest();
        request.setNickname("User");
        request.setEmail("user@example.com");
        request.setContent("This is a comment");
        request.setWebsite("https://example.com");

        Set<ConstraintViolation<CreateCommentRequest>> violations = validator.validate(request);
        assertTrue(violations.isEmpty(), "Valid https website should not have violations");
    }

    @Test
    void testValidWebsiteHttp() {
        CreateCommentRequest request = new CreateCommentRequest();
        request.setNickname("User");
        request.setEmail("user@example.com");
        request.setContent("This is a comment");
        request.setWebsite("http://example.com");

        Set<ConstraintViolation<CreateCommentRequest>> violations = validator.validate(request);
        assertTrue(violations.isEmpty(), "Valid http website should not have violations");
    }

    @Test
    void testValidWebsiteEmpty() {
        CreateCommentRequest request = new CreateCommentRequest();
        request.setNickname("User");
        request.setEmail("user@example.com");
        request.setContent("This is a comment");
        request.setWebsite("");

        Set<ConstraintViolation<CreateCommentRequest>> violations = validator.validate(request);
        assertTrue(violations.isEmpty(), "Empty website should not have violations");
    }

    @Test
    void testValidWebsiteNull() {
        CreateCommentRequest request = new CreateCommentRequest();
        request.setNickname("User");
        request.setEmail("user@example.com");
        request.setContent("This is a comment");
        request.setWebsite(null);

        Set<ConstraintViolation<CreateCommentRequest>> violations = validator.validate(request);
        assertTrue(violations.isEmpty(), "Null website should not have violations");
    }

    @Test
    void testInvalidWebsiteScript() {
        CreateCommentRequest request = new CreateCommentRequest();
        request.setNickname("User");
        request.setEmail("user@example.com");
        request.setContent("This is a comment");
        request.setWebsite("javascript:alert(1)");

        Set<ConstraintViolation<CreateCommentRequest>> violations = validator.validate(request);
        assertFalse(violations.isEmpty(), "Javascript protocol should be rejected");

        boolean found = false;
        for (ConstraintViolation<CreateCommentRequest> violation : violations) {
            if ("website".equals(violation.getPropertyPath().toString())) {
                found = true;
                break;
            }
        }
        assertTrue(found, "Should have violation on website field");
    }

    @Test
    void testInvalidWebsiteNoProtocol() {
        CreateCommentRequest request = new CreateCommentRequest();
        request.setNickname("User");
        request.setEmail("user@example.com");
        request.setContent("This is a comment");
        request.setWebsite("example.com");

        Set<ConstraintViolation<CreateCommentRequest>> violations = validator.validate(request);
        assertFalse(violations.isEmpty(), "Website without protocol should be rejected");
    }
}
