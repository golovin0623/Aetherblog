from playwright.sync_api import sync_playwright, expect

def verify_search_panel(page):
    # Navigate to the test page
    page.goto("http://localhost:3000/test-search")

    # Click the "Open Search" button
    page.get_by_role("button", name="Open Search").click()

    # Wait for the search input to be visible
    search_input = page.get_by_label("搜索框")
    expect(search_input).to_be_visible()

    # Verify the role="combobox"
    expect(search_input).to_have_attribute("role", "combobox")

    # Type into the search input
    search_input.type("Spring")

    # Wait for results to appear
    # The listbox should appear
    results_list = page.locator("#search-results-list")
    expect(results_list).to_be_visible()
    expect(results_list).to_have_attribute("role", "listbox")

    # Wait for the first result
    first_result = page.locator("#search-result-1")
    expect(first_result).to_be_visible()
    expect(first_result).to_have_attribute("role", "option")

    # Test keyboard navigation
    search_input.press("ArrowDown")

    # Verify the first result is selected
    expect(first_result).to_have_attribute("aria-selected", "true")

    # Verify aria-activedescendant on the input
    expect(search_input).to_have_attribute("aria-activedescendant", "search-result-1")

    # Take a screenshot
    page.screenshot(path="/home/jules/verification/search_panel.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_search_panel(page)
            print("Verification successful!")
        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="/home/jules/verification/search_panel_failure.png")
            raise e
        finally:
            browser.close()
