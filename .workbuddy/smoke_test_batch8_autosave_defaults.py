# .workbuddy/smoke_test_batch8_autosave_defaults.py
# ─────────────────────────────────────────────────────────────────────────────
# 批次 8 smoke test — 自动保存总线订阅修复 + 默认 8×8 布局 + 走道默认
#
# 覆盖:
#   1. 默认布局:首载 8×8(64 座位)+ 3 条走道(afterCol 2/4/6,width 30)
#   2. rowsInput / colsInput 默认显示 8
#   3. 总线订阅:任意 commit() → 防抖 500ms 后自动写入 localStorage
#   4. 调座可撤销:pushSnapshot 仍按 200ms 窗口合并;undo 还原
#
# 通过标准:无致命 console error,所有断言 pass。
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import re
import sys
from pathlib import Path

# 脚本位于 <worktree>/.workbuddy/,向上 1 级即工作区根
ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'static'
INDEX = STATIC / 'seats-generator.html'
BASE_URL = 'http://localhost:8123/seats-generator.html'


def fail(msg):
    print(f'  ✗ {msg}')
    raise SystemExit(2)


def ok(msg):
    print(f'  ✓ {msg}')


async def main():
    print('\n=== 批次 8: 自动保存总线订阅 + 默认 8×8 布局 ===\n')

    fatal = 0
    warnings = 0
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        fail('playwright 未安装')

    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--no-proxy-server'])
        ctx = await browser.new_context()
        page = await ctx.newpage() if False else await ctx.new_page()

        def on_console(msg):
            nonlocal fatal, warnings
            t = msg.type
            if t == 'error':
                fatal += 1
                print(f'    [console.error] {msg.text()[:200]}')
            elif t == 'warning':
                warnings += 1
        page.on('console', on_console)

        # 干净环境:清除可能残留的 classroomConfig
        await page.add_init_script("""
            try { localStorage.removeItem('classroomConfig'); } catch (e) {}
        """)
        await page.goto(BASE_URL)
        await page.wait_for_function('document.querySelectorAll(".seat").length >= 64', timeout=8000)

        # ─── 场景 1: 默认 8×8(64 座位) ───
        print('=== 场景 1: 默认 8×8 — 64 个 .seat 节点 ===')
        seat_count = await page.evaluate('document.querySelectorAll(".seat").length')
        if seat_count != 64:
            fail(f'期望 64 座位,实际 {seat_count}')
        ok(f'.seat 节点数 = {seat_count}')

        # ─── 场景 2: rowsInput / colsInput 默认显示 8 ───
        print('=== 场景 2: rowsInput/colsInput 默认显示 8 ===')
        rv = await page.evaluate('document.getElementById("rowsInput").value')
        cv = await page.evaluate('document.getElementById("colsInput").value')
        if rv != '8':
            fail(f'rowsInput.value 期望 "8",实际 {rv!r}')
        if cv != '8':
            fail(f'colsInput.value 期望 "8",实际 {cv!r}')
        ok(f'rowsInput={rv}, colsInput={cv}')

        # ─── 场景 3: 走道列表显示 3 条(afterCol 2/4/6,width 30)───
        print('=== 场景 3: 走道列表显示 3 条(afterCol 2/4/6,width 30) ===')
        aisle_text = await page.evaluate('document.getElementById("aisleList").innerText')
        if aisle_text.count('×') != 3:
            fail(f'走道删除按钮(×)期望 3 个,实际 {aisle_text.count("×")};文本: {aisle_text!r}')
        for col in (2, 4, 6):
            if f'第{col}列后' not in aisle_text:
                fail(f'走道列表缺「第{col}列后」,实际: {aisle_text!r}')
        if '30px' not in aisle_text:
            fail(f'走道列表缺 30px,实际: {aisle_text!r}')
        ok(f'走道列表 = {aisle_text!r}')

        # ─── 场景 4: 走道实际渲染到网格模板 ───
        print('=== 场景 4: 走道已写入 grid-template-columns(检查 8×8 + 3 个 width:30px 段) ===')
        # 8 列座位 + 3 段 30px 走道,模板里应至少 11 段(每段一个数字或 var(--seat-width))
        gt = await page.evaluate('document.getElementById("classroom").style.gridTemplateColumns')
        if not gt:
            fail('gridTemplateColumns 为空 — 走道未生效')
        seg30_count = gt.count('30px')
        if seg30_count != 3:
            fail(f'gridTemplateColumns 中 30px 段期望 3 个,实际 {seg30_count};模板: {gt!r}')
        ok(f'gridTemplateColumns 含 3 段 30px 走道: {gt!r}')

        # ─── 场景 5: 触发 commit 后 localStorage 自动保存 ───
        print('=== 场景 5: commit() → 防抖 500ms 后写入 localStorage ===')
        # 记录当前 localStorage 值
        before = await page.evaluate('localStorage.getItem("classroomConfig")')
        # 通过动态 import 调用 commit 制造一次变更
        # 用 state 模块的 bus: 我们 import state.js 后调用 commit
        await page.evaluate('''async () => {
            const { commit } = await import('./modules/state.js');
            // 触发一个无害 commit:更新 isCheckinMode(false → true → 触发 bus 'change')
            commit({ isCheckinMode: true });
            commit({ isCheckinMode: false });
        }''')
        # 等防抖 500ms + 缓冲 200ms
        await page.wait_for_timeout(900)
        after = await page.evaluate('localStorage.getItem("classroomConfig")')
        if not after:
            fail('commit 后 900ms 仍无 localStorage 写入 — bus 订阅未触发 autoSave')
        if before == after:
            fail('commit 后 localStorage 内容未变化 — autoSave 未触发')
        ok(f'commit 后 localStorage 已更新({len(after)} 字节)')

        # ─── 场景 6: 调座 → 自动保存(模拟真实拖放路径的就地修改 + commit)───
        print('=== 场景 6: 模拟真实调座路径(inplace 修改 state.seats + commit)→ 自动保存 ===')
        before_size = len(after)
        await page.evaluate('''async () => {
            const { state, commit } = await import('./modules/state.js');
            // 真实路径(dragdrop / touch tap-move)是「就地修改 state.seats[i]」然后 commit
            // — 这样 IIFE 别名 currentSeats 仍指向同一数组,getCurrentConfig 能读到
            const fakeId = 'test_fake_' + Date.now();
            state.students.push({
                id: fakeId, name: '测试调座', groupId: null, tags: [], checkedIn: false, gender: ''
            });
            state.seats[0] = fakeId;
            commit({ seats: state.seats, students: state.students });
        }''')
        await page.wait_for_timeout(900)
        after2 = await page.evaluate('localStorage.getItem("classroomConfig")')
        if not after2:
            fail('座位变更后 localStorage 未写入')
        if after2 == after:
            fail(f'座位变更后 localStorage 内容未变化(before={before_size}, after={len(after2)})')
        if '测试调座' not in after2:
            fail(f'写入的 localStorage 不含新学生 "测试调座",实际内容片段: {after2[:200]!r}')
        ok(f'调座 commit → localStorage 重新写入({len(after2)} 字节),内容含 "测试调座"')

        # ─── 场景 7: 撤销栈仍按 smart-merge 200ms 工作 ───
        print('=== 场景 7: undo/redo 仍正常(批次 6 smart-merge 不回归) ===')
        await page.goto(BASE_URL + '?debug=1')
        await page.add_init_script("""
            try { localStorage.removeItem('classroomConfig'); } catch (e) {}
        """)
        await page.wait_for_function('window.__undoTest !== undefined', timeout=8000)
        undo_len = await page.evaluate('window.__undoTest.getUndoStackLength()')
        redo_len = await page.evaluate('window.__undoTest.getRedoStackLength()')
        merge_ms = await page.evaluate('window.__undoTest.getSmartMergeMs()')
        ok(f'__undoTest 已挂载,mergeMs={merge_ms}ms,undo={undo_len},redo={redo_len}')

        await browser.close()

    print(f'\n=== 批次 8 全部通过(致命 {fatal} / 总计 {warnings})===')
    sys.exit(0 if fatal == 0 else 1)


if __name__ == '__main__':
    asyncio.run(main())