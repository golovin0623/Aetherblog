
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 720})
    page = context.new_page()

    try:
        print("Navigating to blog...")
        page.goto("http://localhost:3000")

        # Wait for page to load
        page.wait_for_load_state("networkidle")

        print("Clicking search button...")
        # Search button in header
        page.get_by_role("button", name="搜索").first.click()

        print("Waiting for search panel...")
        # Wait for search input
        search_input = page.get_by_placeholder("搜索文章、标签、分类... (支持自然语言)")
        search_input.wait_for(state="visible")

        print("Typing query...")
        search_input.fill("React")

        # Wait for results
        # The mocked search returns results after 300ms debounce + 300ms delay = 600ms
        print("Waiting for results...")
        page.wait_for_timeout(1000)

        # Verify results are present
        results_list = page.locator("#search-results-list")
        results_list.wait_for(state="visible")

        print("Navigating with keyboard...")
        # Press ArrowDown to highlight first result
        page.keyboard.press("ArrowDown")

        # Wait for highlight transition
        page.wait_for_timeout(200)

        print("Taking screenshot...")
        page.screenshot(path="verification_search_panel.png")

    except Exception as e:
        print(f"Error: {e}")
        page.screenshot(path="verification_error.png")
        raise e
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
