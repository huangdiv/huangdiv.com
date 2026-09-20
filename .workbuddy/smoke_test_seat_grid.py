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
        print("HTTP:", resp.status if resp else "N/A")
        await page.wait_for_timeout(800)

        async def probe(label):
            return {
                "label": label,
                "seats": await page.evaluate("document.querySelectorAll('#classroom .seat').length"),
                "empty": await page.evaluate("document.querySelectorAll('#classroom .seat.empty').length"),
                "children": await page.evaluate("document.getElementById('classroom').children.length"),
                "total": await page.evaluate("document.getElementById('totalStudents').textContent"),
                "assigned": await page.evaluate("document.getElementById('assignedStudents').textContent"),
                "version": await page.evaluate("document.getElementById('appVersion').textContent"),
            }

        # ── 场景 1: 默认加载 ──
        s1 = await probe("初始加载")
        print(s1)
        assert s1["seats"] == 64, f"期望 64 座位,实际 {s1['seats']}"
        assert s1["version"] == "1.3.1"

        # ── 场景 2: 点击 toggleViewBtn 切到教师视角 ──
        await page.click("#toggleViewBtn")
        await page.wait_for_timeout(300)
        s2 = await probe("教师视角")
        print(s2)
        assert s2["seats"] == 64, f"教师视角:期望 64,实际 {s2['seats']}"
        # 教师视角:无起始讲台,64 座位 + 24 走道占位(3走道x8行) + 末尾讲台 = 89
        assert s2["children"] == 89, f"教师视角:期望 89 子元素(64座位+3走道x8行占位+末尾讲台),实际 {s2['children']}"
        teacher_desk_count = await page.evaluate("document.querySelectorAll('#classroom .teacher-desk.teacher-view').length")
        assert teacher_desk_count == 1, f"教师视角:teacher-view 讲台应有 1 个,实际 {teacher_desk_count}"

        # ── 场景 3: 切回学生视角 ──
        await page.click("#toggleViewBtn")
        await page.wait_for_timeout(300)
        s3 = await probe("学生视角(回到)")
        print(s3)
        assert s3["children"] == 89, f"学生视角:期望 89 子元素(64座位+3走道x8行占位+起始讲台),实际 {s3['children']}"
        teacher_desk_back = await page.evaluate("document.querySelectorAll('#classroom .teacher-desk:not(.teacher-view)').length")
        assert teacher_desk_back == 1, f"学生视角:起始讲台应有 1 个,实际 {teacher_desk_back}"

        # ── 场景 4: 点击 modeSwitchBtn(轮换按钮)进入签到模式 ──
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(300)
        s4 = await probe("签到模式")
        print(s4)
        assert s4["seats"] == 64
        banner_visible = await page.evaluate("!!document.querySelector('#classroom .mode-banner.checkin-banner.visible')")
        assert banner_visible, "签到模式 banner 未出现"
        checkin_class = await page.evaluate("document.getElementById('classroom').classList.contains('checkin-mode')")
        assert checkin_class, "classroom 缺少 checkin-mode 类"

        # ── 场景 5: 轮换退出签到(签到→分组→普通),确认 banner 消失 ──
        await page.click("#modeSwitchBtn")   # 签到 → 分组
        await page.wait_for_timeout(300)
        await page.click("#modeSwitchBtn")   # 分组 → 普通
        await page.wait_for_timeout(300)
        s5 = await probe("退出签到")
        print(s5)
        banner_after = await page.evaluate("!!document.querySelector('#classroom .mode-banner')")
        assert not banner_after, "退出签到后 banner 应消失"
        checkin_class_after = await page.evaluate("document.getElementById('classroom').classList.contains('checkin-mode')")
        assert not checkin_class_after, "退出签到后 checkin-mode 类应移除"

        # ── 场景 6: 点击 toggleIconsBtn 不报错 ──
        before_text = await page.evaluate("document.getElementById('toggleIconsBtn').textContent")
        await page.click("#toggleIconsBtn")
        await page.wait_for_timeout(200)
        after_text = await page.evaluate("document.getElementById('toggleIconsBtn').textContent")
        print(f"图标按钮文本切换: {before_text!r} → {after_text!r}")

        print("\nerrors:", errors or "无")
        print("console errors:", console_errors or "无")

        await page.screenshot(path=r"C:\Users\xingz\WorkBuddy\Worktrees\huangdiv.com\master-93f997c3\.workbuddy\smoke_test_seat_grid.png", full_page=False)
        await browser.close()

    ok = (not errors) and (not console_errors)
    print("\n=== 模块化 seat-grid 验证:", "通过 ✅" if ok else "失败 ❌", "===")

asyncio.run(main())