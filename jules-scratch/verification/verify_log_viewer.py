import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # The application is running on port 5006
        await page.goto("http://localhost:5006")

        # Wait for the log viewer to be visible
        await expect(page.get_by_text("Logs")).to_be_visible()
        await page.screenshot(path="jules-scratch/verification/log-viewer-initial.png")

        # Click on the first log file
        await page.get_by_role("button").first.click()
        await page.screenshot(path="jules-scratch/verification/log-viewer-with-content.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())