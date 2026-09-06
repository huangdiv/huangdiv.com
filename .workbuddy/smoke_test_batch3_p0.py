#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
smoke_test_batch3_p0.py — P0 批次3 冒烟验证
  P0-A: GitHub 下载 URL 编码(自动转 encodeGitHubPath,无法直接 E2E 验证,代码 review 通过)
  P0-B: migrateConfig 补全字段默认(可通过页面加载测试)
  P0-C: PAT UX 加固(清除按钮 + 状态指示)

覆盖场景:
  1. 页面加载零控制台错误
  2. PAT 状态指示初始为「未保存」
  3. 输入 token 后状态变「已保存」
  4. 点击「清除」按钮 → 状态回到「未保存」,input 清空
  5. 保存设置后 sessionStorage 中存在 token
  6. migrateConfig 旧格式自动迁移(注入老数据 → 验证字段补全)

运行: python .workbuddy/smoke_test_batch3_p0.py
"""

import asyncio
import json
import sys
from pathlib import Path

# 系统 Python 路径
sys.path.insert(0, r"C:/Users/xingz/AppData/Local/Programs/Python/Python313/Lib/site-packages")

from playwright.async_api import async_playwright  # noqa: E402

WORKTREE = Path(r"C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3")
BASE_URL = "http://localhost:8123/seats-generator.html"


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-proxy-server"])
        context = await browser.new_context()
        page = await context.new_page()

        # 收集错误
        page_errors = []
        all_console = []
        page.on("pageerror", lambda e: page_errors.append(("pageerror", str(e))))
        page.on("console", lambda msg: (
            page_errors.append(("console.error", msg.text)) if msg.type == "error" else None,
            all_console.append(f"[{msg.type}] {msg.text}")
        ))

        # ========== 场景 1: 页面加载零错误 ==========
        print("\n=== 场景 1: 页面加载 ===")
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.wait_for_timeout(1000)  # 给模块初始化时间
        try:
            await page.wait_for_selector("#classroom .seat", timeout=15000)
            seat_count = await page.evaluate("document.querySelectorAll('#classroom .seat').length")
            print(f"  ✓ {seat_count} 个座位已渲染")
        except Exception as e:
            print(f"  ✗ 座位未渲染,错误: {e}")
            print("  页面错误:", page_errors[:5])
            print("  最后 10 条 console:")
            for c in all_console[-10:]:
                print(f"    {c}")
            raise
        assert len(page_errors) == 0, f"页面加载错误: {page_errors[:5]}"
        print(f"  ✓ 零控制台错误({len(page_errors)} 错误)")

        # 展开「导入导出」折叠面板(GitHub 设置在其中,默认折叠)
        print("\n=== 展开「导入导出」面板 ===")
        await page.evaluate("""
            const headers = document.querySelectorAll('.collapse-header[data-target=\"ioPanel\"]');
            const panel = document.getElementById('ioPanel')?.parentElement;
            if (panel && panel.classList.contains('collapsed')) {
                headers[0]?.click();
            }
        """)
        await page.wait_for_timeout(300)
        print("  ✓ 面板已展开")

        # ========== 场景 2: PAT 状态初始未保存 ==========
        print("\n=== 场景 2: PAT 状态初始 ===")
        # 滚动到 GitHub 设置区
        await page.evaluate("document.querySelector('.github-token-status').scrollIntoView()")
        await page.wait_for_timeout(200)
        status_text = await page.locator(".github-token-status").text_content()
        clear_btn_disabled = await page.locator("#githubTokenClearBtn").is_disabled()
        assert "未设置" in status_text, f"初始状态文案: {status_text!r}"
        assert clear_btn_disabled, "初始清除按钮应禁用"
        print(f"  ✓ 初始状态: {status_text!r},清除按钮已禁用")

        # ========== 场景 3: 输入 token 后状态变化 ==========
        print("\n=== 场景 3: 输入 token ===")
        test_token = "ghp_test1234567890abcdefghij"
        await page.locator("#githubToken").fill(test_token)
        await page.wait_for_timeout(100)
        status_text = await page.locator(".github-token-status").text_content()
        clear_btn_disabled = await page.locator("#githubTokenClearBtn").is_disabled()
        # 输入但未点保存 → 应显示「已输入但尚未保存」
        assert "已输入" in status_text, f"输入后状态: {status_text!r}"
        assert "未保存" in status_text or "尚未保存" in status_text, f"输入后状态: {status_text!r}"
        assert clear_btn_disabled, "输入但未保存时清除按钮应禁用"
        print(f"  ✓ 输入后状态: {status_text!r}")

        # ========== 场景 4: 保存设置后点击清除 ==========
        print("\n=== 场景 4: 保存设置后清除 token ===")
        # 先填 owner/repo,再点保存
        await page.locator("#githubOwner").fill("testuser")
        await page.locator("#githubRepo").fill("testrepo")
        await page.locator("#githubSaveSettingsBtn").click()
        await page.wait_for_timeout(500)
        # 保存后状态:已保存 + 清除按钮启用
        status_text = await page.locator(".github-token-status").text_content()
        clear_btn_disabled = await page.locator("#githubTokenClearBtn").is_disabled()
        assert "已保存" in status_text, f"保存后状态: {status_text!r}"
        assert not clear_btn_disabled, "保存后清除按钮应启用"
        print(f"  ✓ 保存后状态: {status_text!r},清除按钮已启用")

        # ========== 场景 5: 验证 sessionStorage 中有 token,localStorage 中没有 ==========
        print("\n=== 场景 5: 验证存储隔离 ===")
        saved_token = await page.evaluate("sessionStorage.getItem('githubToken')")
        saved_settings = await page.evaluate("localStorage.getItem('githubSettings')")
        assert saved_token == test_token, f"sessionStorage token 应等于 {test_token!r},实际: {saved_token!r}"
        assert saved_settings is not None and "testuser" in saved_settings, f"localStorage 应存非敏感字段,实际: {saved_settings!r}"
        assert "ghp_" not in saved_settings, f"localStorage 不应包含 token,实际: {saved_settings!r}"
        print(f"  ✓ sessionStorage token 已存,localStorage 不含 token")

        # 现在点清除按钮
        print("\n=== 场景 6: 清除 token ===")
        await page.locator("#githubTokenClearBtn").click()
        await page.wait_for_timeout(200)
        status_text = await page.locator(".github-token-status").text_content()
        token_value = await page.locator("#githubToken").input_value()
        clear_btn_disabled = await page.locator("#githubTokenClearBtn").is_disabled()
        assert "未设置" in status_text, f"清除后状态: {status_text!r}"
        assert token_value == "", f"清除后 input 应为空,实际: {token_value!r}"
        assert clear_btn_disabled, "清除后按钮应禁用"
        # 同时 sessionStorage 应当无 token
        cleared_token = await page.evaluate("sessionStorage.getItem('githubToken')")
        assert cleared_token is None, f"清除后 sessionStorage 应无 token,实际: {cleared_token!r}"
        print(f"  ✓ 清除后状态: {status_text!r},input/sessionStorage 已清空")

        # ========== 场景 7: migrateConfig 老数据迁移 ==========
        # 注意:initialize() 把 migration 应用到内存 state 但不主动重写 localStorage,
        # 所以「原始 localStorage 仍然是老格式」是预期行为。验证迁移生效需检查:
        #   (a) DOM 渲染:25 座位 + 学生名出现在 #studentList
        #   (b) 内存 state:rows/cols/students 全部正确(动态 import 验证)
        print("\n=== 场景 7: migrateConfig 老数据迁移 ===")
        old_data = {
            "students": ["张三", "李四", "王五"],   # 极旧格式:string[]
            "rows": 5,
            "cols": 5,
            # 故意缺失:seats / groups / aisles / forcedPairs / avoidPairs / version / title / id
        }
        await page.evaluate(f"localStorage.setItem('classroomConfig', JSON.stringify({json.dumps(old_data)}))")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(1000)
        await page.wait_for_function("document.querySelectorAll('#classroom .seat').length >= 25", timeout=10000)

        # (a) DOM 渲染验证
        seat_count = await page.evaluate("document.querySelectorAll('#classroom .seat').length")
        assert seat_count == 25, f"应渲染 25 座位(5x5),实际 {seat_count}"
        student_names_in_dom = await page.evaluate("""
            () => Array.from(document.querySelectorAll('#studentList .student-item'))
                .map(el => el.textContent.trim())
        """)
        for expected_name in ["张三", "李四", "王五"]:
            assert any(expected_name in t for t in student_names_in_dom), \
                f"学生 {expected_name} 应出现在 #studentList,实际: {student_names_in_dom}"
        print(f"  ✓ DOM 渲染:25 座位 + 学生姓名 {student_names_in_dom}")

        # (b) 内存 state 验证 — 动态 import 拿 state 单例(ES module import 缓存,获取同一份)
        migrated_state = await page.evaluate("""
            async () => {
                const m = await import('/modules/state.js');
                return {
                    rows: m.state.rows,
                    cols: m.state.cols,
                    studentCount: m.state.students.length,
                    firstId: m.state.students[0]?.id,
                    firstName: m.state.students[0]?.name,
                    firstGender: m.state.students[0]?.gender,
                    firstTags: m.state.students[0]?.tags,
                    firstCheckedIn: m.state.students[0]?.checkedIn,
                    aisles: m.state.aisles,
                    forcedPairs: m.state.forcedPairs,
                    avoidPairs: m.state.avoidPairs,
                    showStudentIcons: m.state.showStudentIcons,
                    seatsLen: Array.isArray(m.state.seats) ? m.state.seats.length : -1
                };
            }
        """)
        print(f"  调试:migrated_state = {migrated_state}")
        assert migrated_state["rows"] == 5, f"rows 应迁移为 5,实际 {migrated_state['rows']}"
        assert migrated_state["cols"] == 5, f"cols 应迁移为 5,实际 {migrated_state['cols']}"
        assert migrated_state["studentCount"] == 3, \
            f"应有 3 个学生,实际 {migrated_state['studentCount']}"
        assert migrated_state["firstId"].startswith("s"), \
            f"每个学生应有 s 前缀 id,实际 {migrated_state['firstId']!r}"
        assert migrated_state["firstName"] == "张三", \
            f"学生名应为「张三」,实际 {migrated_state['firstName']!r}"
        assert migrated_state["firstGender"] == "", \
            f"gender 应补默认空串,实际 {migrated_state['firstGender']!r}"
        assert migrated_state["firstTags"] == [], \
            f"tags 应补默认空数组,实际 {migrated_state['firstTags']!r}"
        assert migrated_state["firstCheckedIn"] is False, \
            f"checkedIn 应补默认 false,实际 {migrated_state['firstCheckedIn']!r}"
        assert migrated_state["aisles"] == [], f"aisles 应补默认"
        assert migrated_state["forcedPairs"] == [], f"forcedPairs 应补默认"
        assert migrated_state["avoidPairs"] == [], f"avoidPairs 应补默认"
        assert migrated_state["showStudentIcons"] is True, f"showStudentIcons 应为 True"
        assert migrated_state["seatsLen"] == 25, \
            f"seats 数组长度应为 25,实际 {migrated_state['seatsLen']}"
        print(f"  ✓ 内存迁移:rows/cols/students 全对,id/gender/tags/checkedIn/aisles/pairs/seats 全部补默认")

        # (c) 确认 localStorage 仍为原始老数据 — 这是设计行为,不是 bug
        raw_localstorage = await page.evaluate("JSON.parse(localStorage.getItem('classroomConfig'))")
        assert isinstance(raw_localstorage.get('students'), list) and \
            raw_localstorage['students'][0] == '张三', \
            f"localStorage 应保留老格式(string[0]='张三'),实际 {raw_localstorage}"
        print(f"  ✓ localStorage 仍为老格式(string[] / 无 version) — 设计上由下次 autoSave 触发持久化")

        # ========== 错误检查 ==========
        # 过滤掉已知非致命错误:无效 PAT 触发 GitHub API 401(场景 4 设计行为)
        fatal_errors = [
            (etype, etext) for etype, etext in page_errors
            if not (etype == 'console.error' and 'Failed to load resource' in etext
                    and ('401' in etext or '403' in etext or '404' in etext))
        ]
        ignored_errors = [(t, x) for t, x in page_errors if (t, x) not in fatal_errors]
        if ignored_errors:
            print(f"\n  (忽略非致命 console.error:")
            for t, x in ignored_errors:
                print(f"     [{t}] {x}")
            print(f"   )")
        assert len(fatal_errors) == 0, f"测试过程中出现致命错误: {fatal_errors}"
        print(f"\n=== 全部通过(致命 {len(fatal_errors)} / 总计 {len(page_errors)})===")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(run())
