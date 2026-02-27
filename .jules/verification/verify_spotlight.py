from playwright.sync_api import sync_playwright
import time
import os

def verify_spotlight():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # Navigate to a post page where the header spotlight is active
        # We need to wait for the server to be up
        max_retries = 30
        for i in range(max_retries):
            try:
                page.goto("http://localhost:3000/posts/hello-world", timeout=5000)
                break
            except Exception as e:
                print(f"Waiting for server... ({i+1}/{max_retries})")
                time.sleep(2)

        # Wait for the header to be visible
        # Note: The header might be initially hidden on post pages until scroll or mouse movement
        # simulating mouse movement to trigger spotlight

        # Move mouse over the header area
        page.mouse.move(100, 30)
        time.sleep(0.5)

        # Take a screenshot to verify the header is visible and rendering
        # We can't easily verify the "performance" improvement visually, but we can verify
        # that the visual effect still works and the header is not broken.

        # Ensure directory exists
        os.makedirs("verification", exist_ok=True)

        page.screenshot(path="verification/blog_header_spotlight.png")
        print("Screenshot taken at verification/blog_header_spotlight.png")

        browser.close()

if __name__ == "__main__":
    verify_spotlight()
