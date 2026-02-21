from playwright.sync_api import sync_playwright
import os

def test_mobile_menu():
    # Ensure verification directory exists
    os.makedirs("/home/jules/verification", exist_ok=True)

    with sync_playwright() as p:
        print("Launching browser...")
        browser = p.chromium.launch(headless=True)
        # Emulate iPhone 12 Pro
        context = browser.new_context(viewport={'width': 390, 'height': 844}, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1')
        page = context.new_page()

        print("Navigating to http://localhost:3000...")
        try:
            page.goto("http://localhost:3000")
        except Exception as e:
            print(f"Navigation failed: {e}")
            browser.close()
            return

        print("Page loaded.")

        # Click the burger menu
        # Look for the button with aria-label="Toggle Menu"
        try:
            menu_button = page.get_by_label("Toggle Menu")
            # Wait for it to be visible
            menu_button.wait_for(state="visible", timeout=5000)
            menu_button.click()
            print("Clicked Toggle Menu")
        except Exception as e:
            print(f"Could not find or click Toggle Menu: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
            browser.close()
            return

        # Wait for the menu to open (transition)
        page.locator("#mobile-menu-drawer").wait_for(state="visible")

        # Check for "Archives" (归档) link
        try:
            archives_link = page.get_by_role("link", name="归档")
            if archives_link.count() > 0:
                print("SUCCESS: Archives link found")
                href = archives_link.get_attribute('href')
                print(f"Href: {href}")
                if href == "/archives":
                    print("Href is correct")
                else:
                    print(f"Href is incorrect: {href}")
            else:
                print("FAILURE: Archives link not found or is not a role='link'")
                # Try to find it by text to see if it exists as something else
                text_link = page.get_by_text("归档")
                if text_link.count() > 0:
                    print(f"Found '归档' text but not as link. Tag name: {text_link.evaluate('el => el.tagName')}")

        except Exception as e:
            print(f"Error checking Archives link: {e}")

        # Take screenshot
        screenshot_path = "/home/jules/verification/mobile_menu.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    test_mobile_menu()
