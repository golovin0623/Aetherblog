from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

        try:
            print("Navigating to /test-featured...")
            page.goto("http://localhost:3000/test-featured")

            card_title = page.get_by_role("heading", name="Test Featured Post")
            expect(card_title).to_be_visible()

            print("Taking screenshot...")
            page.screenshot(path="verification/featured_post.png")
            print("Verification successful!")

        except Exception as e:
            print(f"Verification failed: {e}")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    run()
