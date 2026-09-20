# -*- coding: utf-8 -*-
"""批次17 — 教师视角拖拽不再「翻回学生视角」

BUG 背景:
  seat-grid.js 的 fullRebuildSeats 按「DOM 追加顺序」push 进 seatNodes,
  而教师视角下 DOM 追加顺序是镜像的(视觉从右往左、从后往前);
  diffUpdateSeats 却把数组下标当成 state.seats 的真实索引,
  于是任何一次 diff 更新(拖拽落座/交换、签到、分组着色…)都会把学生
  按学生视角的顺序重填,视觉上「整表翻回学生视角」,讲台与按钮却仍是教师视角。

核心断言:
  DOM 上 data-index=i 的座位所显示的学生,必须等于 state.seats[i]。
  (与 DOM 追加顺序无关 —— 追加顺序应只影响视觉排布)
"""
import asyncio
import json
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

passed = 0
failed = 0


def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✓ {msg}")
    else:
        failed += 1
        print(f"  ✗ {msg}")


def base_cfg(**over):
    cfg = {
        "title": "批次17",
        "rows": 4,
        "cols": 4,
        "groups": [],
        "viewMode": "teacher",
        "aisles": [],
        "showStudentIcons": False,
        "forcedPairs": [],
        "avoidPairs": [],
        "isCheckinMode": False,
        "isGroupMode": False,
        "groupRotateOffset": 1,
        "version": "1.3.1",
    }
    cfg.update(over)
    return json.dumps(cfg, ensure_ascii=False)


def mk_students(n):
    return [
        {
            "id": f"s{i}",
            "name": f"学生{i}",
            "groupId": None,
            "tags": [],
            "checkedIn": False,
            "gender": "male" if i % 2 else "female",
        }
        for i in range(1, n + 1)
    ]


def cfg_teacher(occupy=8, total=16):
    """4×4=16 座,s1..s8 依次占 seats[0..7],其余空"""
    students = mk_students(occupy)
    seats = [None] * total
    for i in range(1, occupy + 1):
        seats[i - 1] = f"s{i}"
    return base_cfg(students=students, seats=seats)


async def load(page, cfg_json):
    await page.goto(BASE)
    await page.wait_for_timeout(500)
    await page.evaluate(
        """(cfg) => {
            localStorage.setItem('classroomConfig', cfg);
        }""",
        cfg_json,
    )
    await page.reload()
    await page.wait_for_timeout(900)


# DOM 映射:data-index -> data-student(页面上「真实看到的」排布)
DOM_MAP_JS = """() => {
    const out = {};
    document.querySelectorAll('#classroom .seat').forEach(s => {
        out[s.getAttribute('data-index')] = s.getAttribute('data-student') || '';
    });
    return out;
}"""

# DOM 追加顺序上第 k 个座位的 data-index(用于验证教师视角确实镜像)
DOM_ORDER_JS = """() => Array.from(
    document.querySelectorAll('#classroom .seat')
).slice(0, 4).map(s => parseInt(s.getAttribute('data-index'), 10))"""

STATE_SEATS_JS = """() => {
    const cfg = JSON.parse(localStorage.getItem('classroomConfig') || '{}');
    return cfg.seats || [];
}"""


def mismatch(dom_map, state_seats):
    """返回 (data-index, DOM显示, 应为) 的不一致列表"""
    bad = []
    for i, sid in enumerate(state_seats):
        shown = dom_map.get(str(i), "<缺失>")
        if shown != (sid or ""):
            bad.append((i, shown or "空", sid or "空"))
    return bad


async def main():
    global passed, failed

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        # ── 场景 1:教师视角初始渲染 ──
        print("\n── 场景 1:教师视角初始渲染(镜像 DOM 顺序) ──")
        await load(page, cfg_teacher())
        dom_order = await page.evaluate(DOM_ORDER_JS)
        check(
            dom_order == [15, 14, 13, 12],
            f"教师视角 DOM 前 4 个座位 data-index 应为镜像 [15,14,13,12](实际 {dom_order})",
        )
        dom_map = await page.evaluate(DOM_MAP_JS)
        state_seats = await page.evaluate(STATE_SEATS_JS)
        check(
            not mismatch(dom_map, state_seats),
            f"初始渲染 data-index 与 seats 一致(不一致 {mismatch(dom_map, state_seats)[:3]})",
        )

        # ── 场景 2:拖到空座(触发 diff 更新) ──
        print("\n── 场景 2:教师视角拖 s1(index 0)→ 空座 index 15 ──")
        await page.drag_and_drop(
            "#classroom .seat[data-index='0']",
            "#classroom .seat[data-index='15']",
        )
        await page.wait_for_timeout(900)   # 等 autoSave 防抖(500ms)落盘
        dom_map = await page.evaluate(DOM_MAP_JS)
        state_seats = await page.evaluate(STATE_SEATS_JS)
        check(
            state_seats[15] == "s1" and state_seats[0] is None,
            f"state 层:s1 落到 index 15、index 0 空(实际 seats[15]={state_seats[15]}, seats[0]={state_seats[0]})",
        )
        bad = mismatch(dom_map, state_seats)
        check(
            not bad,
            f"DOM 显示与 state 一致(不一致 {bad[:4]})" if bad else "DOM 显示与 state 一致(16 座全对)",
        )

        # ── 场景 3:座位间交换(再触发一次 diff) ──
        print("\n── 场景 3:教师视角交换 index 1(s2) ↔ index 2(s3) ──")
        await page.drag_and_drop(
            "#classroom .seat[data-index='1']",
            "#classroom .seat[data-index='2']",
        )
        await page.wait_for_timeout(900)
        dom_map = await page.evaluate(DOM_MAP_JS)
        state_seats = await page.evaluate(STATE_SEATS_JS)
        check(
            state_seats[1] == "s3" and state_seats[2] == "s2",
            f"state 层:s2/s3 已交换(实际 seats[1]={state_seats[1]}, seats[2]={state_seats[2]})",
        )
        bad = mismatch(dom_map, state_seats)
        check(
            not bad,
            f"交换后 DOM 显示与 state 一致(不一致 {bad[:4]})" if bad else "交换后 DOM 显示与 state 一致",
        )

        # ── 场景 4:视角未被意外切换 ──
        print("\n── 场景 4:讲台与按钮仍是教师视角 ──")
        view = await page.evaluate(
            """() => {
                const kids = Array.from(document.querySelectorAll('#classroom > *'));
                const deskIdx = kids.findIndex(k => k.classList.contains('teacher-desk'));
                const seatIdx = kids.findIndex(k => k.classList.contains('seat'));
                return {
                    deskAtEnd: deskIdx >= 0 && deskIdx > seatIdx,
                    btn: (document.getElementById('toggleViewBtn') || {}).textContent || ''
                };
            }"""
        )
        check(view["deskAtEnd"], f"讲台仍在座位之后(教师视角)(实际 deskAtEnd={view['deskAtEnd']})")
        check(
            "学生视角" in view["btn"],
            f"切换按钮仍显示「学生视角」(即当前教师视角)(实际 {view['btn']!r})",
        )

        # ── 场景 5:学生视角对照组(本就正确,防止修复引入回归) ──
        print("\n── 场景 5:学生视角对照 ──")
        cfg = json.loads(cfg_teacher())
        cfg["viewMode"] = "student"
        await load(page, json.dumps(cfg, ensure_ascii=False))
        dom_order = await page.evaluate(DOM_ORDER_JS)
        check(
            dom_order == [0, 1, 2, 3],
            f"学生视角 DOM 前 4 个座位 data-index 应为 [0,1,2,3](实际 {dom_order})",
        )
        await page.drag_and_drop(
            "#classroom .seat[data-index='0']",
            "#classroom .seat[data-index='10']",
        )
        await page.wait_for_timeout(900)
        dom_map = await page.evaluate(DOM_MAP_JS)
        state_seats = await page.evaluate(STATE_SEATS_JS)
        bad = mismatch(dom_map, state_seats)
        check(not bad, f"学生视角拖拽后一致(不一致 {bad[:4]})" if bad else "学生视角拖拽后一致")

        # ── 场景 6:连续多次拖拽(累积不漂移) ──
        print("\n── 场景 6:教师视角连续 5 次拖拽 ──")
        await load(page, cfg_teacher())
        for src, dst in ((0, 12), (1, 13), (2, 14), (3, 15), (12, 0)):
            await page.drag_and_drop(
                f"#classroom .seat[data-index='{src}']",
                f"#classroom .seat[data-index='{dst}']",
            )
            await page.wait_for_timeout(350)
        await page.wait_for_timeout(900)
        dom_map = await page.evaluate(DOM_MAP_JS)
        state_seats = await page.evaluate(STATE_SEATS_JS)
        bad = mismatch(dom_map, state_seats)
        check(
            not bad,
            f"连续拖拽后 DOM 与 state 仍一致(不一致 {bad[:4]})" if bad else "连续拖拽后 DOM 与 state 仍一致",
        )
        filled = sum(1 for s in state_seats if s)
        check(filled == 8, f"占座总数守恒(8 人,实际 {filled})")

        # ── 场景 7:无 JS 报错 ──
        print("\n── 场景 7:无 JS 报错 ──")
        check(not errors, f"无 pageerror(实际 {errors[:2]})" if errors else "无 pageerror")

        await browser.close()

    print("\n" + "=" * 56)
    print(f"批次17 结果: {passed} 通过 / {failed} 失败")
    print("=" * 56)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
