# -*- coding: utf-8 -*-
"""
批次23 — 打印/PDF 下拉新增「导出为 CSV 座位表」

需求:
  在「打印/PDF」选项列表增加「导出为 CSV 座位表」,按**当前视角**导出各行列座位上的学生姓名。

断言(共 7 项):
  1. 下拉菜单中存在 [data-action="exportSeatCsv"] 菜单项,文案含 CSV
  2. 点击后能触发浏览器下载,文件名形如 <标题>_座位表_YYYY-MM-DD.csv
  3. 文件以 UTF-8 BOM 开头(Windows Excel 中文不乱码)
  4. 学生视角:讲台在首行、行列正序、空座位留空、表头为 第1列…第N列
  5. 教师视角:行列镜像(首行为最后一排、首列为最后一列)
  6. 教师视角:讲台移到末行、行标签仍写真实排号
  7. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
"""
import asyncio
import json
import re
import sys

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

PASSED = 0
FAILED = 0
ERRORS = []


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


async def read_download_text(download):
    path = await download.path()
    with open(path, "rb") as f:
        raw = f.read()
    return raw, raw.decode("utf-8-sig")


async def export_csv(page):
    await page.click("#printDropdownBtn")
    await page.wait_for_timeout(250)
    async with page.expect_download(timeout=8000) as dl_info:
        await page.click('[data-action="exportSeatCsv"]')
    dl = await dl_info.value
    await page.wait_for_timeout(150)
    return dl, *await read_download_text(dl)


async def main():
    students = [
        {"id": "s1", "name": "张三", "groupId": None, "tags": [], "checkedIn": False},
        {"id": "s2", "name": "李四", "groupId": None, "tags": [], "checkedIn": False},
        {"id": "s3", "name": "王五", "groupId": None, "tags": [], "checkedIn": False},
        {"id": "s4", "name": "赵六", "groupId": None, "tags": [], "checkedIn": False},
    ]
    cfgs = {
        "title": "批次23测试",
        "rows": 2,
        "cols": 3,
        "seats": ["s1", "s2", None, "s3", None, "s4"],
        "students": students,
        "groups": [],
        "viewMode": "student",
        "aisles": [{"afterCol": 2, "width": 30}],
        "showStudentIcons": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "version": "1.3.1",
    }

    async with async_playwright() as p:
        # 复用系统 Edge,免下载 Chromium
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page(accept_downloads=True)
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)

        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_timeout(1200)
        await page.evaluate(
            "(cfg) => localStorage.setItem('classroomConfig', JSON.stringify(cfg))",
            cfgs,
        )
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

        # ─── 1. 菜单项存在 ───
        print("=== 1. 打印/PDF 下拉包含 CSV 导出项 ===")
        await page.click("#printDropdownBtn")
        await page.wait_for_timeout(250)
        item = page.locator('[data-action="exportSeatCsv"]')
        if await item.count() == 1:
            ok("存在 [data-action=exportSeatCsv] 菜单项")
        else:
            bad(f"CSV 菜单项数量应为 1,实际 {await item.count()}")
        text = (await item.inner_text()).strip()
        if "CSV" in text:
            ok(f"菜单文案正确: {text}")
        else:
            bad(f"菜单文案不含 CSV: {text}")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        # ─── 2~5. 学生视角导出 ───
        print("=== 2~5. 学生视角导出 ===")
        dl, raw, csv_student = await export_csv(page)
        if re.search(r"_座位表_\d{4}-\d{2}-\d{2}\.csv$", dl.suggested_filename):
            ok(f"文件名格式正确: {dl.suggested_filename}")
        else:
            bad(f"文件名格式不符: {dl.suggested_filename}")

        if raw.startswith(b"\xef\xbb\xbf"):
            ok("文件以 UTF-8 BOM 开头")
        else:
            bad("文件缺少 UTF-8 BOM")

        expect_student = [
            "讲台,,,",
            "排\\列,第1列,第2列,第3列",
            "第1排,张三,李四,",
            "第2排,王五,,赵六",
        ]
        got_student = csv_student.split("\r\n")
        if got_student == expect_student:
            ok("学生视角 CSV 内容正确(讲台在上 / 行列正序 / 空座位留空)")
        else:
            bad(f"学生视角内容不符:\n      期望 {expect_student}\n      实际 {got_student}")

        # ─── 6~8. 教师视角导出 ───
        print("=== 6~8. 教师视角导出 ===")
        await page.click("#toggleViewBtn")
        await page.wait_for_timeout(600)
        dl2, raw2, csv_teacher = await export_csv(page)

        expect_teacher = [
            "排\\列,第3列,第2列,第1列",
            "第2排,赵六,,王五",
            "第1排,,李四,张三",
            "讲台,,,",
        ]
        got_teacher = csv_teacher.split("\r\n")
        if got_teacher == expect_teacher:
            ok("教师视角 CSV 行列镜像、讲台在末行、标签仍为真实坐标")
        else:
            bad(f"教师视角内容不符:\n      期望 {expect_teacher}\n      实际 {got_teacher}")

        # ─── 9. 无 JS 报错 ───
        print("=== 9. 控制台 ===")
        if not ERRORS:
            ok("全程无 JS 报错")
        else:
            bad("出现 JS 报错: " + " | ".join(ERRORS[:5]))

        await browser.close()

    print("\n" + "=" * 60)
    print(f"总计: {PASSED} 通过, {FAILED} 失败")
    if FAILED:
        print("❌ 存在失败项")
        return 1
    print("✅ 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
