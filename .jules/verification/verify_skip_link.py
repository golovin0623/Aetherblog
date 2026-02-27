from playwright.sync_api import sync_playwright

def verify_skip_to_content():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # Navigate to the blog homepage
            # Wait for server to be ready - might need a retry mechanism in real scenarios
            # but for this script we'll assume the server is up after the sleep
            import time
            time.sleep(5)

            page.goto("http://localhost:3000")

            # Press Tab to focus the first element
            page.keyboard.press("Tab")

            # Check if the focused element is our skip link
            focused_element = page.evaluate("document.activeElement")

            # Take a screenshot to show the skip link is visible when focused
            # We need to make sure the element is focused when taking the screenshot
            # The CSS makes it visible on focus
            page.screenshot(path=".jules/verification/skip-link-focused.png")

            # Verify the element text and href
            element_text = page.evaluate("document.activeElement.innerText")
            element_href = page.evaluate("document.activeElement.getAttribute('href')")

            print(f"Focused element text: {element_text}")
            print(f"Focused element href: {element_href}")

            if "跳转到主要内容" in element_text and element_href == "#main-content":
                print("SUCCESS: Skip to content link is focused and has correct attributes")
            else:
                print("FAILURE: Skip to content link not found or incorrect")

            # Press Enter to activate the link
            page.keyboard.press("Enter")

            # Check if focus moved to main-content
            # Note: The main-content div has tabIndex=-1, so it receives focus but might not show a ring
            # We can check document.activeElement.id
            time.sleep(0.5)
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
