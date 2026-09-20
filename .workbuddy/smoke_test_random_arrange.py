import asyncio
import json
import sys
sys.path.insert(0, r"C:/Users/xingz/AppData/Local/Programs/Python/Python313/Lib/site-packages")
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8123/seats-generator.html"

# 10 个学生:5 男 5 女
STUDENTS = [
    {"id": "s01", "name": "张一", "groupId": None, "gender": "male",   "tags": [], "checkedIn": False},
    {"id": "s02", "name": "李二", "groupId": None, "gender": "female", "tags": [], "checkedIn": False},
    {"id": "s03", "name": "王三", "groupId": None, "gender": "male",   "tags": [], "checkedIn": False},
    {"id": "s04", "name": "赵四", "groupId": None, "gender": "female", "tags": [], "checkedIn": False},
    {"id": "s05", "name": "钱五", "groupId": None, "gender": "male",   "tags": [], "checkedIn": False},
    {"id": "s06", "name": "孙六", "groupId": None, "gender": "female", "tags": [], "checkedIn": False},
    {"id": "s07", "name": "周七", "groupId": None, "gender": "male",   "tags": [], "checkedIn": False},
    {"id": "s08", "name": "吴八", "groupId": None, "gender": "female", "tags": [], "checkedIn": False},
    {"id": "s09", "name": "郑九", "groupId": None, "gender": "male",   "tags": [], "checkedIn": False},
    {"id": "s10", "name": "冯十", "groupId": None, "gender": "female", "tags": [], "checkedIn": False},
]

def make_config():
    return {
        "students": STUDENTS,
        "groups": [],
        "rows": 7,
        "cols": 7,
        "seats": [None] * 49,
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "title": "班级座位表",
        "version": "1.3.1"
    }

async def main():
    errors = []
    console_errors = []
    dialogs = []

    config_json = json.dumps(make_config())
    init_script = f"localStorage.setItem('classroomConfig', '{config_json}');"

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
        await ctx.add_init_script(init_script)
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"PAGEERROR: {e}"))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        async def on_dialog(d):
            dialogs.append({"type": d.type, "msg": d.message[:60]})
            await d.accept()
        page.on("dialog", on_dialog)

        resp = await page.goto(URL, wait_until="networkidle", timeout=30000)
        print("HTTP:", resp.status if resp else "N/A")
        await page.wait_for_timeout(1000)

        # ── 场景 1: 学生加载(预设 localStorage 后应自动渲染) ──
        s1 = {
            "students": await page.evaluate("document.querySelectorAll('#studentList .student-item').length"),
            "total": await page.evaluate("document.getElementById('totalStudents').textContent"),
            "assigned": await page.evaluate("document.getElementById('assignedStudents').textContent"),
        }
        print("场景 1 学生加载:", s1)
        assert s1["students"] == 10
        assert s1["total"] == "10"
        assert s1["assigned"] == "0"

        # ── 场景 2: 完全随机 ──
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(200)
        await page.wait_for_timeout(500)
        s2 = {
            "assigned": await page.evaluate("document.getElementById('assignedStudents').textContent"),
            "non_empty": await page.evaluate("document.querySelectorAll('#classroom .seat:not(.empty)').length"),
        }
        print("场景 2 完全随机:", s2)
        assert s2["assigned"] == "10"
        assert s2["non_empty"] == 10

        # ── 场景 3: 重置 + 男女同桌 ──
        await page.evaluate("localStorage.removeItem('classroomConfig');")
        await page.evaluate(f"localStorage.setItem('classroomConfig', '{config_json}');")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(1000)

        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(200)
        await page.click("#randomDropdown [data-toggle='mixed']")
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(500)
        s3 = {
            "assigned": await page.evaluate("document.getElementById('assignedStudents').textContent"),
        }
        print("场景 3 男女同桌:", s3)
        assert s3["assigned"] == "10"

        # ── 场景 4: 重置 + 男女不同桌 ──
        await page.evaluate("localStorage.removeItem('classroomConfig');")
        await page.evaluate(f"localStorage.setItem('classroomConfig', '{config_json}');")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(1000)

        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(200)
        await page.click("#randomDropdown [data-toggle='samegender']")
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(500)
        s4 = {
            "assigned": await page.evaluate("document.getElementById('assignedStudents').textContent"),
        }
        print("场景 4 男女不同桌:", s4)
        assert s4["assigned"] == "10"

        print("\ndialogs:", len(dialogs), "条(全 accepted)")
        print("errors:", errors or "无")
        print("console errors:", console_errors or "无")

        await page.screenshot(path=r"C:\Users\xingz\WorkBuddy\Worktrees\huangdiv.com\master-93f997c3\.workbuddy\smoke_test_random_arrange.png", full_page=False)
        await browser.close()

    ok = (not errors) and (not console_errors)
    print("\n=== 模块化 random-arrange 验证:", "通过 ✅" if ok else "失败 ❌", "===")

asyncio.run(main())