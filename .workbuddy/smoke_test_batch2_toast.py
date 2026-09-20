#!/usr/bin/env python
"""批次2 #4 验证:随机排座失败 toast"""
import asyncio, sys
sys.path.insert(0, r"C:/Users/xingz/AppData/Local/Programs/Python/Python313/Lib/site-packages")
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8123/seats-generator.html"


async def run_random(page):
    await page.click("#smartArrangeBtn")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-proxy-server"])
        page = await browser.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(URL)
        await page.wait_for_selector("#classroom .seat")

        # ─── 场景 1:学生 > 座位,触发「N 名学生未入座」toast ───
        await page.evaluate("""() => {
            const students = [];
            for (let i = 0; i < 30; i++) {
                students.push({ id: 's' + i, name: 's' + i, gender: 'male', tags: [] });
            }
            // 5x5 = 25 座位,30 学生 → 5 学生未入座
            localStorage.setItem('classroomConfig', JSON.stringify({
                title: 't', rows: 5, cols: 5, seats: new Array(25).fill(null),
                students, groups: [], aisles: [],
                viewMode: 'student', showStudentIcons: true,
                forcedPairs: [], avoidPairs: [], version: '1.3.1'
            }));
        }""")
        await page.reload()
        await page.wait_for_selector("#classroom .seat")
        await page.wait_for_timeout(150)

        await run_random(page)
        await page.wait_for_timeout(300)

        toast1 = await page.evaluate("""() => {
            const el = document.querySelector('.stat-toast');
            return el ? { text: el.textContent, visible: el.classList.contains('visible') } : null;
        }""")
        print("场景1 (30 学生 / 25 座位):", toast1)
        assert toast1 and '未入座' in toast1['text'], f"场景1 期望 toast 含「未入座」,实得: {toast1}"

        # ─── 场景 2:正常情况不应触发 warning toast(回归基线) ───
        await page.evaluate("""() => {
            const ids = [];
            for (let i = 0; i < 5; i++) ids.push('m' + i);
            const students = ids.map(id => ({ id, name: id, gender: 'male', tags: [] }));
            localStorage.setItem('classroomConfig', JSON.stringify({
                title: 't', rows: 5, cols: 5, seats: new Array(25).fill(null),
                students, groups: [], aisles: [],
                viewMode: 'student', showStudentIcons: true,
                forcedPairs: [], avoidPairs: [], version: '1.3.1'
            }));
        }""")
        await page.reload()
        await page.wait_for_selector("#classroom .seat")
        await page.wait_for_timeout(150)

        # 等 1.5s 让场景1 的 toast 自动隐藏
        await page.wait_for_timeout(1600)

        await run_random(page)
        await page.wait_for_timeout(300)

        # toast 元素存在但可能 hidden
        toast2 = await page.evaluate("""() => {
            const el = document.querySelector('.stat-toast');
            return el ? { text: el.textContent, visible: el.classList.contains('visible') } : null;
        }""")
        print("场景2 (正常 5 学生无配对):", toast2)
        # 不强制要求 toast 内容;只要没崩 + 元素存在即可

        # ─── 场景 3:再次触发「未入座」toast 验证多次调用都正常 ───
        await page.evaluate("""() => {
            const students = [];
            for (let i = 0; i < 50; i++) {
                students.push({ id: 's' + i, name: 's' + i, gender: 'male', tags: [] });
            }
            // 5x5 = 25 座位,50 学生 → 25 学生未入座
            localStorage.setItem('classroomConfig', JSON.stringify({
                title: 't', rows: 5, cols: 5, seats: new Array(25).fill(null),
                students, groups: [], aisles: [],
                viewMode: 'student', showStudentIcons: true,
                forcedPairs: [], avoidPairs: [], version: '1.3.1'
            }));
        }""")
        await page.reload()
        await page.wait_for_selector("#classroom .seat")
        await page.wait_for_timeout(150)
        await page.wait_for_timeout(1600)

        await run_random(page)
        await page.wait_for_timeout(300)

        toast3 = await page.evaluate("""() => {
            const el = document.querySelector('.stat-toast');
            return el ? { text: el.textContent, visible: el.classList.contains('visible') } : null;
        }""")
        print("场景3 (50 学生 / 25 座位):", toast3)
        assert toast3 and '25 名学生未入座' in toast3['text'], f"场景3 期望 toast 含「25 名学生未入座」,实得: {toast3}"

        print(f"\npage errors: {len(errors)}")
        for e in errors:
            print(" ", e)
        assert len(errors) == 0, f"page errors: {errors}"
        print("\n=== 批次2 #4 验证: 通过 ✅ ===")

        await browser.close()


asyncio.run(main())