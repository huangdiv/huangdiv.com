# -*- coding: utf-8 -*-
"""
批次 9:随机排座后自动保存(+ 撤销后保存)回归烟测

核心断言:随机排座后 localStorage 中的 seats 必须**等于渲染真源 state.seats**。
修复前:random-arrange.js 里 `state.seats = Array(...)` 重新赋值打断了主 IIFE
       顶层 `currentSeats` 别名,渲染读 state.seats(新)、getCurrentConfig()
       读 currentSeats(旧)→ 界面显示新座位、localStorage 却写入排座前旧数据,
       刷新后回到旧座位(用户感知="随机排座后自动保存失效")。
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"
results = []


def ok(msg):
    results.append(True)
    print(f"  ✅ {msg}")


def fail(msg):
    results.append(False)
    print(f"  ❌ {msg}")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        dialogs = []

        async def on_dialog(d):
            dialogs.append({"type": d.type, "msg": d.message[:60]})
            await d.accept()

        page.on("dialog", on_dialog)

        await page.goto(BASE)
        await page.wait_for_timeout(1200)

        # ─── 场景 1:注入 24 个学生 ───
        print("=== 场景 1: 注入 24 个学生 ===")
        await page.evaluate("""() => {
            const students = [];
            for (let i = 1; i <= 24; i++) {
                students.push({
                    id: 's' + i, name: '学生' + i, groupId: null,
                    tags: [], checkedIn: false, gender: i % 2 ? 'male' : 'female'
                });
            }
            localStorage.setItem('classroomConfig', JSON.stringify({
                title: '批次9测试', rows: 8, cols: 8,
                seats: Array(64).fill(null),
                students: students, groups: [], viewMode: 'student',
                aisles: [{afterCol:2,width:30},{afterCol:4,width:30},{afterCol:6,width:30}],
                showStudentIcons: true, forcedPairs: [], avoidPairs: [], version: '1.3.0'
            }));
        }""")
        await page.reload()
        await page.wait_for_timeout(1200)

        cnt = await page.evaluate("document.querySelectorAll('.seat').length")
        if cnt == 64:
            ok(f"8×8 = 64 个座位渲染正确")
        else:
            fail(f"座位数应为 64,实际 {cnt}")

        # ─── 场景 2:第一次随机排座 → 建立基线 ───
        print("=== 场景 2: 第一次随机排座(建立基线) ===")
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(400)
        await page.wait_for_timeout(1200)

        base_ls = await page.evaluate("localStorage.getItem('classroomConfig')")
        if not base_ls:
            fail("第一次排座后 localStorage 为空")
            await browser.close()
            return
        base_cfg = json.loads(base_ls)
        base_seats = base_cfg["seats"]
        filled = sum(1 for s in base_seats if s)
        if filled == 24:
            ok(f"第一次排座:24 名学生全部入座,localStorage 已写入")
        else:
            fail(f"第一次排座后入座数应为 24,实际 {filled}")

        # ─── 场景 3:核心断言 —— 第二次随机排座后 localStorage 与 state.seats 一致 ───
        print("=== 场景 3: 第二次随机排座 → localStorage 必须等于 state.seats ===")
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(400)
        await page.wait_for_timeout(1200)  # 等过 500ms 防抖

        # 渲染真源(seat-grid 读的就是它)
        render_seats = await page.evaluate("""async () => {
            const { state } = await import('./modules/state.js');
            return state.seats.slice();
        }""")

        after_ls = await page.evaluate("localStorage.getItem('classroomConfig')")
        if not after_ls:
            fail("第二次排座后 localStorage 为空")
            await browser.close()
            return
        after_cfg = json.loads(after_ls)
        saved_seats = after_cfg["seats"]

        # 断言 A:排座结果确实变了(否则测试无意义)
        if saved_seats == base_seats:
            fail("两次排座结果完全相同(概率极低),测试无效")
        else:
            ok("两次排座结果不同(排座引擎工作正常)")

        # 断言 B(核心):localStorage 保存的 seats == 渲染真源 state.seats
        if saved_seats == render_seats:
            ok("✅ 核心断言通过:localStorage.seats === state.seats(保存的是最新排座)")
        else:
            n_saved = sum(1 for s in saved_seats if s)
            n_render = sum(1 for s in render_seats if s)
            fail(f"localStorage 与 state.seats 不一致!保存 {n_saved} 人 / 渲染 {n_render} 人 "
                 f"—— 别名断链,保存的是旧座位")

        # 断言 C:保存的仍是 24 人(没丢数据)
        if sum(1 for s in saved_seats if s) == 24:
            ok("保存的数据完整性:24 人全部在座")
        else:
            fail(f"保存的数据不完整,仅 {sum(1 for s in saved_seats if s)} 人")

        # ─── 场景 4:刷新后座位保持不变(持久化真正生效) ───
        # 注意:刷新会清空撤销历史栈,故撤销场景(场景 5)须在刷新之后重新排座再做。
        print("=== 场景 4: 刷新页面 → 座位应与保存的一致 ===")
        await page.reload()
        await page.wait_for_timeout(1200)
        reload_seats = await page.evaluate("""async () => {
            const { state } = await import('./modules/state.js');
            return state.seats.slice();
        }""")
        if reload_seats == saved_seats:
            ok("刷新后座位与保存的完全一致(持久化生效)")
        else:
            fail("刷新后座位与保存的不一致 —— 自动保存仍未修复")

        # ─── 场景 5:撤销后也要自动保存(刷新后重排一次以重建历史栈) ───
        print("=== 场景 5: 撤销一次随机排座 → 自动保存 ===")
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(400)
        await page.wait_for_timeout(1200)
        undo_ls_before = await page.evaluate("localStorage.getItem('classroomConfig')")
        undo_disabled = await page.evaluate("document.getElementById('undoBtn').disabled")
        if undo_disabled:
            fail("排座后撤销按钮仍为 disabled(历史栈未记录)")
        else:
            await page.click("#undoBtn")
            await page.wait_for_timeout(1200)
            undo_ls_after = await page.evaluate("localStorage.getItem('classroomConfig')")
            if undo_ls_after and undo_ls_after != undo_ls_before:
                ok("撤销后 localStorage 已更新(撤销也可持久化)")
            else:
                fail("撤销后 localStorage 未更新")

        # ─── 场景 6:三种模式都触发自动保存 ───
        print("=== 场景 6: mixed / samegender 模式同样自动保存 ===")
        for mode in ["mixed", "samegender"]:
            b = await page.evaluate("localStorage.getItem('classroomConfig')")
            await page.click("#randomDropdownBtn")
            await page.wait_for_timeout(300)
            await page.click(f"#randomDropdown [data-toggle='{mode}']")
            await page.click("#smartArrangeBtn")
            await page.wait_for_timeout(1200)
            a = await page.evaluate("localStorage.getItem('classroomConfig')")
            rs = await page.evaluate("""async () => {
                const { state } = await import('./modules/state.js');
                return state.seats.slice();
            }""")
            if not a:
                fail(f"{mode} 模式排座后 localStorage 为空")
                continue
            if json.loads(a)["seats"] == rs:
                ok(f"{mode} 模式:localStorage 与 state.seats 一致 ✅")
            else:
                fail(f"{mode} 模式:localStorage 与 state.seats 不一致")

        await browser.close()

    print()
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"=== 批次 9 随机排座自动保存: {passed}/{total} 通过 ===")
    print(f"=== dialog 处理: {len(dialogs)} 条(全部 accept) ===")
    sys.exit(0 if passed == total else 1)


asyncio.run(main())
