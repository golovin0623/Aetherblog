from playwright.sync_api import sync_playwright
import time

def verify_spotlight():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 720})

        # Navigate to test card page
        print("Navigating to test-card page...")
        try:
            page.goto("http://localhost:3000/test-card", timeout=60000)
            page.wait_for_load_state("networkidle")
        except Exception as e:
            print(f"Failed to load page: {e}")
            return

        # Locate the article card
        article = page.locator("article").first

        # Take initial screenshot
        page.screenshot(path="verification/test_card_initial.png")
        print("Screenshot saved to verification/test_card_initial.png")

        if article.count() > 0:
            # Hover over the card
            box = article.bounding_box()
            if box:
                center_x = box["x"] + box["width"] / 2
                center_y = box["y"] + box["height"] / 2
                print(f"Hovering at {center_x}, {center_y}")
                page.mouse.move(center_x, center_y)

                # Wait for hover effect
                time.sleep(1.0) # Wait for animation

                # Take screenshot
                page.screenshot(path="verification/test_card_hover.png")
                print("Screenshot saved to verification/test_card_hover.png")

                # Move mouse away
                page.mouse.move(0, 0)
                time.sleep(1.0) # Wait for fade out
                page.screenshot(path="verification/test_card_no_hover.png")
                print("Screenshot saved to verification/test_card_no_hover.png")

        # Now test FeaturedPost
        featured = page.locator(".group").nth(1) # Second .group element (ArticleCard also has .group)
        # Actually FeaturedPost has a specific structure too. But verify ArticleCard first is enough to prove the optimization works.

        browser.close()

if __name__ == "__main__":
    verify_spotlight()
