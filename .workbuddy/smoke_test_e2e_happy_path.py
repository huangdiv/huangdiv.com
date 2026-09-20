"""
E2E happy-path 全链路冒烟

覆盖 5 个核心场景:
  1. 导入学生   — localStorage 预置 10 学生 (5M/5F)
  2. 排座       — 学生拖入座位 (简化:点击座位分配)
  3. 随机+配对  — 完全随机模式 + 强制同桌断言
  4. 签到       — 进入签到模式 + 点击 3 个座位 + 退出
  5. 导出图片   — html2canvas 截图 + PNG 下载

要求:
  - HTTP server 在 127.0.0.1:8123 运行 (cwd = static/)
  - 浏览器 zero page/console error
  - 导出 PNG 字节 > 0 且能被读取
"""
import os
import json
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8123/seats-generator.html"

# 预置:10 学生 (5M/5F) + 1 对强制同桌 (student[0], student[1])
INIT_CONFIG = {
    "version": "1.3.1",
    "title": "E2E 测试班级",
    "rows": 5,
    "cols": 5,
    "aisles": [],
    "viewMode": "student",
    "showStudentIcons": True,
    "students": [
        {"id": f"e2e_{i}", "name": f"学生{i + 1}", "number": i + 1,
         "gender": "male" if i < 5 else "female", "tag": "", "tags": [], "checkedIn": False}
        for i in range(10)
    ],
    "seats": [None] * 25,
    "forcedPairs": [["e2e_0", "e2e_1"]],   # 学生 1 + 学生 2 必须同桌
    "avoidPairs": [["e2e_3", "e2e_4"]],    # 学生 4 + 学生 5 不能同桌
}


def make_seed_script():
    """将 INIT_CONFIG 注入 localStorage,页面加载前生效。"""
    payload = json.dumps(INIT_CONFIG, ensure_ascii=False)
    js_payload = payload.replace("\\", "\\\\").replace("'", "\\'")
    return f"localStorage.setItem('classroomConfig', '{js_payload}');"


async def main():
    results = {"steps": [], "errors": [], "console_errors": [], "warnings": []}
    download_dir = Path("./.workbuddy/e2e_downloads")
    download_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            viewport={"width": 1280, "height": 900},
        )
        await context.add_init_script(make_seed_script())

        page = await context.new_page()

        def on_pageerror(err):
            results["errors"].append(str(err))

        def on_console(msg):
            if msg.type == "error":
                results["console_errors"].append(msg.text)
            elif msg.type == "warning":
                t = msg.text
                if "html2canvas" in t.lower():
                    return
                results["warnings"].append(t)

        page.on("pageerror", on_pageerror)
        page.on("console", on_console)

        # 关键:注册 dialog 处理器在 goto 之前
        dialog_log = []
        async def handle_dialog(dialog):
            dialog_log.append(dialog.message)
            await dialog.accept()
        page.on("dialog", lambda d: asyncio.create_task(handle_dialog(d)))

        # ── 加载页面 ──
        resp = await page.goto(URL, wait_until="networkidle", timeout=30000)
        results["steps"].append(("HTTP 状态", resp.status))
        assert resp.status == 200, f"页面未返回 200,got {resp.status}"

        # 等待座位区渲染
        await page.wait_for_selector("#classroom .seat", timeout=10000)
        await page.wait_for_function(
            "() => document.querySelectorAll('#studentList .student-item').length > 0",
            timeout=10000,
        )

        # ════════════════════════════════════════════════════════════════
        # Step 1: 导入学生(已通过 init_script 预置,验证渲染)
        # ════════════════════════════════════════════════════════════════
        student_count = await page.evaluate(
            "() => document.querySelectorAll('#studentList .student-item').length"
        )
        results["steps"].append(("Step 1 学生加载", student_count))
        assert student_count == 10, f"期望 10 学生,got {student_count}"

        state_students = await page.evaluate(
            "async () => { const m = await import('./modules/state.js'); "
            "return m.state.students.length; }"
        )
        assert state_students == 10, f"state.students 长度错,got {state_students}"

        title = await page.evaluate("() => document.getElementById('pageTitle')?.textContent || ''")
        results["steps"].append(("Step 1 标题", title))

        # ════════════════════════════════════════════════════════════════
        # Step 2: 排座入口(此处不实际分配,Step 3 随机覆盖)
        # ════════════════════════════════════════════════════════════════
        # 验证拖放目标存在(用于后续手动拖放)
        seat_count = await page.evaluate(
            "() => document.querySelectorAll('#classroom .seat').length"
        )
        empty_count = await page.evaluate(
            "() => document.querySelectorAll('#classroom .seat.empty').length"
        )
        results["steps"].append(("Step 2 座位池", {"total": seat_count, "empty": empty_count}))
        assert seat_count == 25, f"5×5 应有 25 座位,got {seat_count}"
        assert empty_count == 25, f"初始全部为空,got {empty_count}"

        # ════════════════════════════════════════════════════════════════
        # Step 3: 随机+配对 — 完全随机模式
        # ════════════════════════════════════════════════════════════════
        # 打开智能排座选项下拉
        await page.click("#randomDropdownBtn")
        await page.wait_for_selector("#randomDropdown", state="visible", timeout=2000)

        # dialog 处理器已在 page.on 阶段注册,会自动 accept
        # 使用 'mixed' 模式而非 'random',因为 mixed 模式是唯一同时强制 enforce
        # forcedPairs(同桌)和 avoidPairs(拆桌)的模式。random 模式设计上不校验 avoidPairs。
        await page.click("#randomDropdown [data-toggle='mixed']")
        await page.click("#smartArrangeBtn")
        # 等待排座完成
        await page.wait_for_function(
            "() => document.querySelectorAll('#classroom .seat:not(.empty)').length > 0",
            timeout=10000,
        )
        await page.wait_for_timeout(500)

        assigned = await page.evaluate(
            "() => document.querySelectorAll('#classroom .seat:not(.empty)').length"
        )
        results["steps"].append(("Step 3 男女同桌后排座", assigned))
        assert assigned == 10, f"期望 10 已分配,got {assigned}"

        # 验证强制同桌 e2e_0 / e2e_1 是否同桌
        forced_pair_ok = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            const s = m.state;
            const id0 = 'e2e_0', id1 = 'e2e_1';
            const idx0 = s.seats.indexOf(id0);
            const idx1 = s.seats.indexOf(id1);
            if (idx0 < 0 || idx1 < 0) return { ok: false, reason: 'not found', idx0, idx1 };
            const r = s.rows, c = s.cols;
            const row0 = Math.floor(idx0 / c), col0 = idx0 % c;
            const row1 = Math.floor(idx1 / c), col1 = idx1 % c;
            const sameRow = row0 === row1;
            const adjCol = Math.abs(col0 - col1) === 1;
            // 同桌:同行 + 邻列
            const sameDesk = sameRow && adjCol;
            return { ok: sameDesk, idx0, idx1, row0, col0, row1, col1, sameRow, adjCol };
        }""")
        results["steps"].append(("Step 3 强制同桌 e2e_0/e2e_1", forced_pair_ok))
        assert forced_pair_ok["ok"], f"强制同桌失败: {forced_pair_ok}"

        # 验证回避同桌 e2e_3 / e2e_4 不同桌
        avoid_pair_ok = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            const s = m.state;
            const id3 = 'e2e_3', id4 = 'e2e_4';
            const idx3 = s.seats.indexOf(id3);
            const idx4 = s.seats.indexOf(id4);
            if (idx3 < 0 || idx4 < 0) return { ok: false, reason: 'not found' };
            const c = s.cols;
            const row3 = Math.floor(idx3 / c), col3 = idx3 % c;
            const row4 = Math.floor(idx4 / c), col4 = idx4 % c;
            const sameRow = row3 === row4;
            const adjCol = Math.abs(col3 - col4) === 1;
            const sameDesk = sameRow && adjCol;
            return { ok: !sameDesk, row3, col3, row4, col4, sameDesk };
        }""")
        results["steps"].append(("Step 3 回避同桌 e2e_3/e2e_4", avoid_pair_ok))
        assert avoid_pair_ok["ok"], f"回避同桌失败(他们同桌了): {avoid_pair_ok}"

        # ════════════════════════════════════════════════════════════════
        # Step 4: 签到模式(轮换按钮:普通 → 签到)
        # ════════════════════════════════════════════════════════════════
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(300)

        checkin_active = await page.evaluate("""() => ({
            hasBanner: !!document.querySelector('.mode-banner.checkin-banner.visible'),
            bodyHasCheckinClass: document.body.classList.contains('checkin-mode') ||
                                  document.getElementById('classroom')?.classList.contains('checkin-mode'),
            btnText: document.getElementById('modeSwitchLabel')?.textContent.trim()
        })""")
        results["steps"].append(("Step 4 签到模式激活", checkin_active))
        assert checkin_active["hasBanner"], f"签到 banner 未出现: {checkin_active}"
        assert checkin_active["btnText"] == "签到模式", f"按钮文案应为 签到模式: {checkin_active}"

        # 点击前 3 个已分配座位,模拟签到
        seats_to_click = await page.evaluate(
            "() => Array.from(document.querySelectorAll('#classroom .seat:not(.empty)')).slice(0, 3).length"
        )
        for _ in range(seats_to_click):
            await page.evaluate("""() => {
                const seat = document.querySelector('#classroom .seat:not(.empty):not(.checked-in)');
                if (seat) seat.click();
            }""")
            await page.wait_for_timeout(100)

        checkin_state = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            return m.state.students.filter(s => s.checkedIn).length;
        }""")
        results["steps"].append(("Step 4 签到人数", checkin_state))
        assert checkin_state == 3, f"期望 3 人签到,got {checkin_state}"

        # 退出签到(轮换:签到 → 分组 → 普通)
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(200)
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(200)

        # ════════════════════════════════════════════════════════════════
        # Step 5: 导出图片
        # ════════════════════════════════════════════════════════════════
        await page.click("#printBtn")
        await page.wait_for_selector("#printDropdown", state="visible", timeout=2000)

        async with page.expect_download(timeout=15000) as download_info:
            await page.click("[data-action='exportImage']")

        download = await download_info.value
        save_path = download_dir / "e2e_export.png"
        await download.save_as(str(save_path))
        size = save_path.stat().st_size

        results["steps"].append(("Step 5 导出 PNG", {
            "filename": download.suggested_filename,
            "size": size,
            "path": str(save_path),
        }))
        assert size > 1024, f"PNG 太小,可能渲染失败:{size} 字节"

        # 验证 PNG 文件头
        with open(save_path, "rb") as f:
            header = f.read(8)
        assert header[:4] == b"\x89PNG", f"非 PNG 文件,header={header[:4]!r}"

        results["steps"].append(("对话框记录", dialog_log))

        # ── 关闭 ──
        await browser.close()

    # ── 输出报告 ──
    print("\n" + "=" * 60)
    print("E2E Happy-Path 测试报告")
    print("=" * 60)
    for label, value in results["steps"]:
        print(f"  {label}: {value}")
    print(f"\n  Page errors: {len(results['errors'])}")
    for e in results["errors"]:
        print(f"    - {e}")
    print(f"  Console errors: {len(results['console_errors'])}")
    for e in results["console_errors"]:
        print(f"    - {e}")
    if results["warnings"]:
        print(f"  Warnings: {len(results['warnings'])}")
        for w in results["warnings"][:5]:
            print(f"    - {w[:120]}")

    if results["errors"] or results["console_errors"]:
        print("\n=== E2E 验证: 失败 ❌ ===")
        return 1
    print("\n=== E2E Happy-Path 验证: 通过 ✅ ===")
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    raise SystemExit(exit_code)