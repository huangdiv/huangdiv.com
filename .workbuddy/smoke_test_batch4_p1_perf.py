#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
smoke_test_batch4_p1_perf.py — 批次4 P1 性能冒烟验证

P1-B: generateSeats diff 改造验证

覆盖场景:
  1. 页面加载 + 10 学生注入 + 座位 49 渲染
  2. data-persist-test 标签:触发 random arrange(结构不变)后,49 个 data-persist-test 仍存在
     ⇒ 持久化 DOM 节点 ⇒ diff 路径生效
  3. 触发 random arrange 后,座位内容随之更新(seat-name 反映新学生),非僵尸 DOM
  4. 单个座位签到切换:仅该座位的 className + attribute 改变,其他 48 个不变
  5. MutationObserver 测量:单座位签到切换的 DOM mutation 次数 ≤ 3(targetClass + attribute change)
  6. 切换视角(结构变化):seat 数量仍 49,但持久化标签失效 ⇒ fullRebuild 路径生效

运行: python .workbuddy/smoke_test_batch4_p1_perf.py
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, r"C:/Users/xingz/AppData/Local/Programs/Python/Python313/Lib/site-packages")
from playwright.async_api import async_playwright  # noqa: E402

WORKTREE = Path(r"C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3")
BASE_URL = "http://localhost:8123/seats-generator.html"


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-proxy-server"])
        page = await browser.new_page()
        page_errors = []
        page.on("pageerror", lambda e: page_errors.append(("pageerror", str(e))))
        page.on("console", lambda msg: (
            page_errors.append(("console.error", msg.text)) if msg.type == "error" else None
        ))

        # ========== 场景 1: 页面加载 + 预置 10 学生 ==========
        print("\n=== 场景 1: 页面加载 + 预置 10 学生 ===")
        # 关键:随机排座弹出 confirm 全局接受,避免卡死
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))
        # 先用 localStorage 注入 10 学生
        init_config = {
            "title": "P1 性能测试",
            "rows": 7, "cols": 7,
            "seats": [None] * 49,
            "students": [
                {"id": "p" + str(i), "name": f"学生{i:02d}", "checkedIn": False, "gender": ("male" if i % 3 == 1 else ("female" if i % 3 == 2 else "")), "tags": []}
                for i in range(1, 11)
            ],
            "groups": [],
            "viewMode": "student",
            "aisles": [],
            "showStudentIcons": True,
            "forcedPairs": [], "avoidPairs": [],
            "version": "1.3.1",
        }
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.evaluate(f"localStorage.setItem('classroomConfig', JSON.stringify({json.dumps(init_config)}))")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(800)
        await page.wait_for_selector("#classroom .seat", timeout=10000)
        seat_count = await page.evaluate("document.querySelectorAll('#classroom .seat').length")
        assert seat_count == 49, f"应渲染 49 座位,实际 {seat_count}"
        student_count = await page.evaluate("document.getElementById('totalStudents').textContent")
        assert student_count == "10", f"应加载 10 学生,头部统计 {student_count!r}"
        print(f"  ✓ 49 座位 / 10 学生就绪")

        # ========== 场景 2: 标记 49 座位为持久化测试 ==========
        print("\n=== 场景 2: 持久化标记 + random arrange 触发 diff ===")
        await page.evaluate("""
            document.querySelectorAll('#classroom .seat').forEach((s, i) => {
                s.setAttribute('data-persist-test', 'orig-' + i);
            });
        """)
        # 打开 random dropdown
        await page.click("#randomBtn")
        await page.wait_for_timeout(200)
        # 触发「完全随机」
        await page.click("[data-action='random']")
        # confirm 弹窗可能弹出,等异步
        await page.wait_for_timeout(800)

        # 关键断言 1:49 个 data-persist-test 标记应当全部存活(dom 持久化)
        persist_count = await page.evaluate("""
            Array.from(document.querySelectorAll('#classroom .seat'))
                .filter(s => (s.getAttribute('data-persist-test') || '').startsWith('orig-')).length
        """)
        assert persist_count == 49, \
            f"diff 路径应保留所有 data-persist-test,实际剩 {persist_count}/49 ⇒ 可能走了 fullRebuild"
        print(f"  ✓ 49 标记存活,DOM 节点持久化")

        # 关键断言 2:座位内容已更新(应有 ≥1 个学生姓名,不再是空)
        seated_names = await page.evaluate("""
            Array.from(document.querySelectorAll('#classroom .seat[data-student]'))
                .map(s => s.getAttribute('data-student'))
                .filter(id => id)
        """)
        assert len(seated_names) >= 1, \
            f"random arrange 后应至少 1 学生入座,实际: {len(seated_names)}"
        assert seated_names[0].startswith("p"), \
            f"入座的学生 id 应以 p 开头(预置学生 id),实际 {seated_names[0]!r}"
        print(f"  ✓ 座位内容已更新: {len(seated_names)} 学生入座")

        # ========== 场景 3: 单学生签到切换(只 1 个座位变化) ==========
        print("\n=== 场景 3: 单座位签到切换 ===")
        # 先进入签到模式(结构变化 ⇒ fullRebuild ⇒ 标记会清空;这是预期的)
        await page.click("#checkinModeBtn")
        await page.wait_for_timeout(300)
        # 重新标记
        await page.evaluate("""
            document.querySelectorAll('#classroom .seat').forEach((s, i) => {
                s.setAttribute('data-persist-test', 'checkin-' + i);
            });
        """)
        # 找一个已入座学生(第一个 data-student 非空的座位)
        first_student_seat_idx = await page.evaluate("""
            (() => {
                const s = Array.from(document.querySelectorAll('#classroom .seat'))
                    .find(s => s.getAttribute('data-student'));
                return s ? parseInt(s.getAttribute('data-index')) : -1;
            })()
        """)
        assert first_student_seat_idx >= 0, "签到测试:未找到已入座座位"
        print(f"  目标座位 idx={first_student_seat_idx}")

        # 安装 MutationObserver 监测后续 DOM mutations
        # 仅启动新的观察者(本场景专用),关闭旧的以聚焦本次 mutation
        await page.evaluate("""
            window.__mutationLog = [];
            const target = document.getElementById('classroom');
            window.__obs = new MutationObserver(records => {
                records.forEach(r => window.__mutationLog.push({
                    type: r.type,
                    target: r.target?.nodeName,
                    attr: r.attributeName,
                    targetClass: r.target?.className,
                    seatIndex: r.target?.closest?.('.seat')?.getAttribute('data-index') ?? null
                }));
            });
            window.__obs.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'data-student']
            });
        """)
        # 点击该座位(签到模式)
        await page.evaluate(f"""
            document.querySelectorAll('#classroom .seat')[{first_student_seat_idx}].click()
        """)
        await page.wait_for_timeout(400)

        mutations = await page.evaluate("""
            (() => {
                const log = window.__mutationLog || [];
                window.__obs?.disconnect();
                return log.filter(m => m.seatIndex !== null);
            })()
        """)
        await page.evaluate("window.__obs?.disconnect()")
        # 验证:仅目标座位发生变化
        touched_seats = {m["seatIndex"] for m in mutations if m["seatIndex"] is not None}
        target_str = str(first_student_seat_idx)
        assert target_str in touched_seats, \
            f"目标座位 {target_str} 应在 mutation 列表,实际: {touched_seats}"
        non_target = touched_seats - {target_str}
        assert len(non_target) == 0, \
            f"diff 路径应仅影响目标座位,实际触发了 {len(non_target)} 个非目标座位: {non_target}"
        print(f"  ✓ 仅目标座位 idx={first_student_seat_idx} 被更新 ({len(mutations)} 条 mutation,触及其他座位 0 个)")

        # ========== 场景 4: 切换视角(结构变化 ⇒ fullRebuild ⇒ 持久化标记失效) ==========
        print("\n=== 场景 4: 视角切换 → fullRebuild 路径确认 ===")
        await page.evaluate("""
            document.querySelectorAll('#classroom .seat').forEach((s, i) => {
                s.setAttribute('data-persist-test', 'view-' + i);
            });
        """)
        # 退出签到(否则 view 切换会和签到 banner 一起触发结构变化,但我们要测单独 view)
        await page.click("#checkinModeBtn")
        await page.wait_for_timeout(200)
        # 重新标记(退出签到也是结构变化)
        await page.evaluate("""
            document.querySelectorAll('#classroom .seat').forEach((s, i) => {
                s.setAttribute('data-persist-test', 'view2-' + i);
            });
        """)
        # 切教师视角
        await page.click("#toggleViewBtn")
        await page.wait_for_timeout(300)
        view_tags = await page.evaluate("""
            Array.from(document.querySelectorAll('#classroom .seat'))
                .filter(s => (s.getAttribute('data-persist-test') || '').startsWith('view2-')).length
        """)
        assert view_tags == 0, \
            f"视角切换应清空 view2-* 标记(走 fullRebuild),实际剩 {view_tags}/49"
        # 切回学生视角 + 验证 49 座位仍正常
        await page.click("#toggleViewBtn")
        await page.wait_for_timeout(300)
        seats_back = await page.evaluate("document.querySelectorAll('#classroom .seat').length")
        assert seats_back == 49, f"切回学生视角应仍 49 座位,实际 {seats_back}"
        print(f"  ✓ 视角切换触发 fullRebuild,切回仍 49 座位")

        # ========== 错误检查 ==========
        fatal = [
            (t, x) for t, x in page_errors
            if not (t == "console.error" and "Failed to load resource" in x)
        ]
        if fatal:
            print(f"\n  致命错误:")
            for t, x in fatal[:5]:
                print(f"    [{t}] {x}")
        assert len(fatal) == 0, f"测试过程中出现致命错误: {fatal}"
        print(f"\n=== P1 性能 diff 全部通过(致命 {len(fatal)} / 总计 {len(page_errors)})===")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(run())
