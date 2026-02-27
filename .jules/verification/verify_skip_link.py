"""
Verify the Skip to Content accessibility feature.
Tests that the skip link appears on Tab focus and navigates to main content.
"""
import os
from playwright.sync_api import sync_playwright

SKIP_LINK_TEXT = "跳转到主要内容"
APP_URL = os.environ.get("APP_URL", "http://localhost:3000")


def verify_skip_to_content():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # Navigate to the blog homepage with retry
            max_retries = 15
            for i in range(max_retries):
                try:
                    page.goto(APP_URL, timeout=5000)
                    break
                except Exception:
                    print(f"Waiting for server... ({i + 1}/{max_retries})")
                    page.wait_for_timeout(2000)

            # Press Tab to focus the first element (should be skip link)
            page.keyboard.press("Tab")

            # Take a screenshot to show the skip link is visible when focused
            page.screenshot(path=".jules/verification/skip-link-focused.png")

            # Verify the element text and href
            element_text = page.evaluate("document.activeElement.innerText")
            element_href = page.evaluate("document.activeElement.getAttribute('href')")

            print(f"Focused element text: {element_text}")
            print(f"Focused element href: {element_href}")

            if SKIP_LINK_TEXT in element_text and element_href == "#main-content":
                print("SUCCESS: Skip to content link is focused and has correct attributes")
            else:
                print("FAILURE: Skip to content link not found or incorrect")

            # Press Enter to activate the link
            page.keyboard.press("Enter")

            # Use explicit wait instead of time.sleep()
            page.wait_for_function("document.activeElement.id === 'main-content'", timeout=3000)
            active_id = page.evaluate("document.activeElement.id")
            print(f"Active element ID after click: {active_id}")

            if active_id == "main-content":
                print("SUCCESS: Focus moved to main-content")
            else:
                print(f"FAILURE: Focus did not move to main-content. Active ID: {active_id}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()


if __name__ == "__main__":
    verify_skip_to_content()
