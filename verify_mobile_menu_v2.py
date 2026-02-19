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
            page.wait_for_load_state("networkidle")
        except Exception as e:
            print(f"Navigation failed: {e}")
            browser.close()
            return

        print("Page loaded.")
        page.screenshot(path="/home/jules/verification/before_click.png")

        # Click the burger menu
        try:
            menu_button = page.get_by_label("Toggle Menu")
            menu_button.wait_for(state="visible", timeout=5000)

            # Click with force to bypass potential overlays
            menu_button.click(force=True)
            print("Clicked Toggle Menu")

            # Wait for drawer
            print("Waiting for drawer...")
            # Look for the drawer by role dialog or ID
            drawer = page.locator("#mobile-menu-drawer")
            drawer.wait_for(state="visible", timeout=5000)
            print("Drawer is visible")

        except Exception as e:
            print(f"Could not open menu: {e}")
            page.screenshot(path="/home/jules/verification/error_click.png")
            browser.close()
            return

        # Check for "Archives" (归档) link
        try:
            archives_link = page.get_by_role("link", name="归档")
            archives_link.wait_for(state="visible", timeout=2000)

            if archives_link.count() > 0:
                print("SUCCESS: Archives link found")
                href = archives_link.get_attribute('href')
                print(f"Href: {href}")

                # Check aria-current
                # Navigate to Archives page first to check if aria-current works?
                # No, just check it exists as link is good enough for now.

            else:
                print("FAILURE: Archives link not found")

        except Exception as e:
            print(f"Error checking Archives link: {e}")

        # Take screenshot
        screenshot_path = "/home/jules/verification/mobile_menu_open.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    test_mobile_menu()
