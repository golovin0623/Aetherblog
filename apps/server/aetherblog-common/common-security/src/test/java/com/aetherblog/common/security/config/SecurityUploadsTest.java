package com.aetherblog.common.security.config;

import com.aetherblog.common.security.filter.JwtAuthenticationFilter;
import com.aetherblog.common.security.interceptor.RateLimitInterceptor;
import com.aetherblog.common.security.service.JwtService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(classes = SecurityUploadsTest.TestApp.class, properties = {
    "jwt.secret=testSecretKeyShouldBeLongEnoughForHS256AlgorithmVerification123456",
    "jwt.expiration=3600"
})
@Import({SecurityConfig.class, JwtAuthenticationFilter.class})
public class SecurityUploadsTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @MockitoBean
    private UserDetailsService userDetailsService;

    @MockitoBean
    private JwtService jwtService;

    @MockitoBean
    private RateLimitInterceptor rateLimitInterceptor;

    @BeforeEach
    public void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    public void testUploadsSecurityHeaders_Sandbox() throws Exception {
        // This test expects STRICTER headers for uploads
        // It should FAIL until we implement the fix
        mockMvc.perform(get("/uploads/test.png"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Security-Policy", "sandbox;"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    }

    @SpringBootApplication
    @RestController
    static class TestApp {
        @GetMapping("/uploads/test.png")
        public String upload() {
            return "image-content";
        }
    }
}
