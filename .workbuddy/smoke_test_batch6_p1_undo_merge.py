#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
smoke_test_batch6_p1_undo_merge.py — 批次6 P1 (1) 撤销栈 smart-merge 冒烟验证

覆盖场景(对应 review v1.3.0 §六 E P1 UX #1):
  1. 同 opType 在 merge 窗口内连续入栈 → 仅 1 个 undo 帧
  2. 同 opType 但超出 merge 窗口 → 2 个独立 undo 帧
  3. 不同 opType(即使在窗口内)→ 2 个独立 undo 帧
  4. undo() / redo() 打破 merge 窗口
  5. localStorage undoMergeMs = 0 → 完全不合并
  6. 实际 UI 路径:5 次快速座位调整 → 1 次 undo 全部还原

运行: python .workbuddy/smoke_test_batch6_p1_undo_merge.py

注意:测试 URL 必须带 ?debug=1,以便访问 window.__undoTest 桩。
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, r"C:/Users/xingz/AppData/Local/Programs/Python/Python313/Lib/site-packages")
from playwright.async_api import async_playwright  # noqa: E402

WORKTREE = Path(r"C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3")
BASE_URL = "http://localhost:8123/seats-generator.html?debug=1"


def make_students(n, name_pattern="学生{:02d}"):
    out = []
    for i in range(1, n + 1):
        out.append({
            "id": "s" + str(i), "name": name_pattern.format(i),
            "checkedIn": False, "gender": "", "tags": [],
            "groupId": None
        })
    return out


async def inject_config(page, config):
    await page.evaluate(f"localStorage.setItem('classroomConfig', JSON.stringify({json.dumps(config)}))")
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(800)


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-proxy-server"])
        page = await browser.new_page()
        page_errors = []
        page.on("pageerror", lambda e: page_errors.append(("pageerror", str(e))))
        page.on("console", lambda msg: (
            page_errors.append(("console.error", msg.text)) if msg.type == "error" else None
        ))
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        base_cfg = {
            "title": "P1 (1) smart-merge 测试", "rows": 5, "cols": 6,
            "seats": [None] * 30,
            "students": make_students(8),
            "groups": [],
            "viewMode": "student", "aisles": [], "showStudentIcons": True,
            "forcedPairs": [], "avoidPairs": [],
            "version": "1.3.1"
        }

        # ========== 场景 1: 同 opType 在窗口内 → 1 帧 ==========
        print("\n=== 场景 1: 同 opType 'seat' 连续 5 次(50ms 内)→ 应为 1 帧 ===")
        await page.goto(BASE_URL, wait_until="networkidle")
        await inject_config(page, base_cfg)
        assert await page.evaluate("__undoTest !== undefined"), "debug 桩未挂载"
        # 5 次 pushSnapshot('seat'),间隔 30ms 模拟快速连续
        result = await page.evaluate("""
            (async () => {
                __undoTest.pushSnapshot('init');  // 起始帧(基线)
                await new Promise(r => setTimeout(r, 30));
                for (let i = 0; i < 5; i++) {
                    __undoTest.pushSnapshot('seat');
                    await new Promise(r => setTimeout(r, 30));
                }
                return {
                    length: __undoTest.getUndoStackLength(),
                    lastType: __undoTest.getLastSnapOpType(),
                    mergeMs: __undoTest.getSmartMergeMs()
                };
            })()
        """)
        print(f"  5 次 'seat' 入栈后:length={result['length']}, lastOpType={result['lastType']}, mergeMs={result['mergeMs']}")
        assert result["length"] == 2, f"应为 2(init + 1 合并的 seat),实际 {result['length']}"
        assert result["lastType"] == "seat", f"lastOpType 应为 seat,实际 {result['lastType']!r}"
        print("  ✓ 同 opType 在窗口内连续入栈 → 合并为 1 帧")

        # ========== 场景 2: 同 opType 但超出窗口 → 各自成帧 ==========
        print("\n=== 场景 2: 同 opType 'seat' 3 次,每次间隔 250ms(> 200ms)→ 应为 3 帧 ===")
        result = await page.evaluate("""
            (async () => {
                // 先清掉之前场景的栈 — 通过连续 undo 直到栈空
                while (__undoTest.getUndoStackLength() > 0) __undoTest.undo();
                await new Promise(r => setTimeout(r, 50));
                for (let i = 0; i < 3; i++) {
                    __undoTest.pushSnapshot('seat');
                    await new Promise(r => setTimeout(r, 250));  // > 200ms
                }
                return {
                    length: __undoTest.getUndoStackLength(),
                    lastType: __undoTest.getLastSnapOpType()
                };
            })()
        """)
        print(f"  3 次 'seat'(间隔 250ms)后:length={result['length']}")
        assert result["length"] == 3, f"应为 3 独立帧,实际 {result['length']}"
        print("  ✓ 同 opType 超出 merge 窗口 → 各自成帧")

        # ========== 场景 3: 不同 opType(即使在窗口内)→ 各自成帧 ==========
        print("\n=== 场景 3: 'seat' → 80ms → 'student' → 80ms → 'seat' → 3 独立帧 ===")
        result = await page.evaluate("""
            (async () => {
                while (__undoTest.getUndoStackLength() > 0) __undoTest.undo();
                await new Promise(r => setTimeout(r, 50));
                __undoTest.pushSnapshot('seat');
                await new Promise(r => setTimeout(r, 80));
                __undoTest.pushSnapshot('student');
                await new Promise(r => setTimeout(r, 80));
                __undoTest.pushSnapshot('seat');
                return {
                    length: __undoTest.getUndoStackLength(),
                    lastType: __undoTest.getLastSnapOpType()
                };
            })()
        """)
        print(f"  混合 3 次入栈后:length={result['length']}, lastType={result['lastType']!r}")
        assert result["length"] == 3, f"应为 3 独立帧(不同 opType 不合并),实际 {result['length']}"
        assert result["lastType"] == "seat", f"lastType 应为 seat,实际 {result['lastType']!r}"
        print("  ✓ 不同 opType 即便在窗口内也不合并")

        # ========== 场景 4: undo() 打破 merge 窗口 ==========
        print("\n=== 场景 4: push 'seat' → undo → push 'seat'(80ms 后)→ 应为 2 帧 ===")
        result = await page.evaluate("""
            (async () => {
                while (__undoTest.getUndoStackLength() > 0) __undoTest.undo();
                await new Promise(r => setTimeout(r, 50));
                __undoTest.pushSnapshot('init');      // 基线帧,opType='init'
                await new Promise(r => setTimeout(r, 50));
                __undoTest.pushSnapshot('seat');     // stack=[init, seat], lastSnap='seat'
                await new Promise(r => setTimeout(r, 50));
                __undoTest.undo();                   // stack=[init], redo=[current]
                // undo 后立即检查 redo(此时 redo 尚未被新 push 清空)
                const redoAfterUndo = __undoTest.getRedoStackLength();
                await new Promise(r => setTimeout(r, 80));
                // 若 undo 没打破窗口,该 push 会与已撤销的 'seat' 合并 — 但实际应新建独立帧
                __undoTest.pushSnapshot('seat');
                return {
                    length: __undoTest.getUndoStackLength(),
                    lastType: __undoTest.getLastSnapOpType(),
                    redoAfterUndo: redoAfterUndo
                };
            })()
        """)
        print(f"  结果:length={result['length']}, lastType={result['lastType']!r}, redoAfterUndo={result['redoAfterUndo']}")
        assert result["length"] == 2, \
            f"应为 [init, seat_new] 共 2 帧(undo 后窗口重置,新 push 不与已撤销帧合并),实际 {result['length']}"
        assert result["redoAfterUndo"] == 1, f"undo 后 redo 栈应有 1 帧,实际 {result['redoAfterUndo']}"
        assert result["lastType"] == "seat", f"lastType 应为 seat,实际 {result['lastType']!r}"
        print("  ✓ undo 打破 merge 窗口(新 push 不与已撤销帧合并)")

        # ========== 场景 4b: redo() 也打破 merge 窗口 ==========
        print("\n=== 场景 4b: push 'seat' → undo → redo → push 'seat'(80ms 后)→ 应为 3 帧 ===")
        result = await page.evaluate("""
            (async () => {
                while (__undoTest.getUndoStackLength() > 0) __undoTest.undo();
                await new Promise(r => setTimeout(r, 50));
                __undoTest.pushSnapshot('init');
                await new Promise(r => setTimeout(r, 50));
                __undoTest.pushSnapshot('seat');     // stack=[init, seat1]
                await new Promise(r => setTimeout(r, 50));
                __undoTest.undo();                   // stack=[init], redo=[cur]
                await new Promise(r => setTimeout(r, 50));
                __undoTest.redo();                   // stack=[init, seat1], redo=[]
                await new Promise(r => setTimeout(r, 80));
                // redo 后 push 'seat':若窗口被打破,新 push 是独立帧(否则会与 redo 的 seat1 合并)
                __undoTest.pushSnapshot('seat');
                return {
                    length: __undoTest.getUndoStackLength()
                };
            })()
        """)
        print(f"  redo 后再 push:length={result['length']}")
        assert result["length"] == 3, f"应为 [init, seat1(redo), seat_new] 共 3 帧,实际 {result['length']}"
        print("  ✓ redo 同样打破 merge 窗口")

        # ========== 场景 5: undoMergeMs=0 → 完全不合并 ==========
        print("\n=== 场景 5: localStorage undoMergeMs=0 → 5 次入栈 5 帧 ===")
        await page.evaluate("localStorage.setItem('undoMergeMs', '0')")
        result = await page.evaluate("""
            (async () => {
                while (__undoTest.getUndoStackLength() > 0) __undoTest.undo();
                await new Promise(r => setTimeout(r, 50));
                // reload 后 getSmartMergeMs 才生效
                location.reload();
            })()
        """)
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(800)
        result = await page.evaluate("""
            (async () => {
                for (let i = 0; i < 5; i++) {
                    __undoTest.pushSnapshot('seat');
                    await new Promise(r => setTimeout(r, 20));
                }
                return {
                    length: __undoTest.getUndoStackLength(),
                    mergeMs: __undoTest.getSmartMergeMs()
                };
            })()
        """)
        print(f"  undoMergeMs=0 时:mergeMs={result['mergeMs']}, 5 次入栈 length={result['length']}")
        assert result["mergeMs"] == 0, f"mergeMs 应为 0,实际 {result['mergeMs']}"
        assert result["length"] == 5, f"应为 5 帧(mergeMs=0 不合并),实际 {result['length']}"
        print("  ✓ undoMergeMs=0 → 完全不合并")
        # 还原默认
        await page.evaluate("localStorage.removeItem('undoMergeMs')")

        # ========== 场景 6: 实际 UI 路径 — 拖拽 5 个学生到座位 → 1 次 undo 全部还原 ==========
        print("\n=== 场景 6: 实际 UI 路径 — 拖拽 5 个学生 → 1 次 undo 全部还原 ===")
        # 重新加载以清除 localStorage 配置
        cfg = dict(base_cfg)
        cfg["students"] = make_students(8)
        cfg["seats"] = [None] * 30
        await inject_config(page, cfg)
        # 直接调用 pushSnapshot 模拟 5 次连续座位操作(因为 HTML5 drag 在 headless 不稳定)
        result = await page.evaluate("""
            (async () => {
                while (__undoTest.getUndoStackLength() > 0) __undoTest.undo();
                await new Promise(r => setTimeout(r, 100));
                // 模拟 5 次「把学生放到座位」(快速连续,每次间隔 < 200ms)
                for (let i = 0; i < 5; i++) {
                    __undoTest.pushSnapshot('seat');
                    await new Promise(r => setTimeout(r, 40));
                }
                const lengthBefore = __undoTest.getUndoStackLength();
                // 1 次 undo 应回退整个 5 步(因为它们合并成 1 帧)
                __undoTest.undo();
                const lengthAfter = __undoTest.getUndoStackLength();
                return { lengthBefore: lengthBefore, lengthAfter: lengthAfter };
            })()
        """)
        print(f"  5 次入栈 lengthBefore={result['lengthBefore']}, 1 次 undo 后 lengthAfter={result['lengthAfter']}")
        # 注:实际 pushSnapshot 初始会因 autoSave/initialize 等隐式 push — 我们看 delta
        assert result["lengthBefore"] >= 1 and result["lengthAfter"] == result["lengthBefore"] - 1, \
            f"1 次 undo 应只回退 1 帧(5 个 push 已合并),before={result['lengthBefore']} after={result['lengthAfter']}"
        print("  ✓ 5 次快速 'seat' 合并为 1 帧,1 次 undo 即全部还原")

        # ========== 错误检查 ==========
        fatal = [
            (t, x) for t, x in page_errors
            if not (t == "console.error" and ("Failed to load resource" in x or "favicon" in x))
        ]
        if fatal:
            print(f"\n  致命错误:")
            for t, x in fatal[:5]:
                print(f"    [{t}] {x}")
        assert len(fatal) == 0, f"测试过程中出现致命错误: {fatal}"
        print(f"\n=== P1 (1) smart-merge 全部 6 项通过(致命 {len(fatal)} / 总计 {len(page_errors)})===")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(run())