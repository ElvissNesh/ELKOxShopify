from playwright.sync_api import sync_playwright

def test_app():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:3000/app/settings")
        # Let the page load
        page.wait_for_timeout(2000)
        page.screenshot(path="screenshot.png")
        browser.close()

if __name__ == "__main__":
    test_app()
