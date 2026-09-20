import asyncio
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8123/seats-generator.html"

async def main():
    errors = []
    console_errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: errors.append(f"PAGEERROR: {e}"))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        resp = await page.goto(URL, wait_until="networkidle", timeout=30000)
        print("HTTP 状态:", resp.status if resp else "N/A")

        await page.wait_for_timeout(800)

        # 关键探针
        seats_count = await page.evaluate("document.querySelectorAll('#classroom .seat').length")
        classroom_children = await page.evaluate("document.getElementById('classroom').children.length")
        version = await page.evaluate("document.getElementById('appVersion').textContent")
        title = await page.title()

        print("页面标题:", title)
        print("座位元素 .seat 数量:", seats_count)
        print("#classroom 子元素数:", classroom_children)
        print("版本号:", version)
        print("page errors:", errors if errors else "无")
        print("console errors:", console_errors if console_errors else "无")

        await page.screenshot(path=r"C:\Users\xingz\WorkBuddy\Worktrees\huangdiv.com\master-93f997c3\.workbuddy\smoke_test.png", full_page=False)
        await browser.close()

    # 判定
    ok = (not errors) and (not console_errors) and (seats_count > 0)
    print("\n=== 冒烟测试结论:", "通过 ✅" if ok else "失败 ❌", "===")

asyncio.run(main())
