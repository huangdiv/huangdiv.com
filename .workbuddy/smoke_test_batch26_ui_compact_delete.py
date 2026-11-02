# -*- coding: utf-8 -*-
"""
批次26 — UI 紧凑化：行内删除按钮瘦身 + 「座位设置」更名「布局设置」

需求:
  1. 「分组设置」与「详细设置」下的「删除」按钮，风格与「布局设置 → 走道列表」
     的移除叉号一致：透明底、圆形 hover、只占一个图标宽度（不再是一行 26×26 的实心红块），
     把省下的横向空间让给分组名 / 学生名输入框；
  2. 折叠面板标题「座位设置」改名为「布局设置」。

断言(共 9 项):
  1. 折叠面板标题是「布局设置」，全页不再出现「座位设置」
  2. 分组行删除按钮尺寸 = 18×18（--icon-remove-size），不再是 26
  3. 分组行删除按钮是「轻量」外观：透明底 + 圆形
  4. 分组行删除按钮沿用 danger 色（删除语义不丢）
  5. 详细设置学生行删除按钮尺寸同为 18×18
  6. 分组行「操作区」总宽 ≤ 80px（改造前是 90px），宽度确实让给了名称框
  7. 分组名输入框宽度 ≥ 40px（不被挤压）
  8. 分组行 / 学生行均无横向溢出（scrollWidth ≤ clientWidth + 1）
  9. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
然后:
  python .workbuddy/smoke_test_batch26_ui_compact_delete.py
"""
import asyncio
import json

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

PASSED = 0
FAILED = 0
ERRORS = []

FAKE_XLSX_LIB = """
window.XLSX = {
    read: function () { return { SheetNames: [], Sheets: {} }; },
    utils: { sheet_to_json: function () { return []; } }
};
"""

FAKE_HTML2CANVAS = """
window.html2canvas = function () {
    return Promise.reject(new Error('html2canvas stub in smoke test'));
};
"""

NAMES = ["张伟", "李娜", "王强", "赵敏", "孙悦", "陈晨", "周杰", "吴昊", "郑爽", "冯磊"]

MEASURE = """() => {
    const one = s => document.querySelector(s);
    const box = el => el ? el.getBoundingClientRect() : null;
    const cs = el => el ? getComputedStyle(el) : null;

    const gDel = one('.group-delete-btn');
    const sDel = one('.student-delete-btn');
    const gName = one('.group-item .group-name-input');
    const actions = one('.group-actions');

    const overflow = [];
    document.querySelectorAll('.group-item').forEach(function (el, i) {
        if (el.scrollWidth > el.clientWidth + 1) {
            overflow.push('group-item#' + i + ' ' + el.scrollWidth + '>' + el.clientWidth);
        }
    });
    document.querySelectorAll('.student-group-item').forEach(function (el, i) {
        if (el.scrollWidth > el.clientWidth + 1) {
            overflow.push('student-group-item#' + i + ' ' + el.scrollWidth + '>' + el.clientWidth);
        }
    });

    return {
        title: (one('[data-target="seatSettings"] .collapse-title') || {}).textContent || '',
        groupDel: gDel ? [box(gDel).width, box(gDel).height] : null,
        groupDelBg: cs(gDel) ? cs(gDel).backgroundColor : null,
        groupDelRadius: cs(gDel) ? cs(gDel).borderRadius : null,
        groupDelColor: cs(gDel) ? cs(gDel).color : null,
        studentDel: sDel ? [box(sDel).width, box(sDel).height] : null,
        groupNameW: gName ? box(gName).width : null,
        actionsW: actions ? box(actions).width : null,
        overflow: overflow,
    };
}"""


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


async def main():
    global PASSED, FAILED, ERRORS

    students = [
        {"id": f"s{i+1}", "name": n, "groupId": None, "checkedIn": False,
         "gender": "male" if i % 2 == 0 else "female", "tags": [], "rank": i + 1}
        for i, n in enumerate(NAMES)
    ]
    cfg = {
        "title": "批次26测试",
        "rows": 3,
        "cols": 5,
        "seats": [None] * 15,
        "students": students,
        "groups": [],
        "viewMode": "student",
        "aisles": [{"afterCol": 1, "width": 30}],
        "showStudentIcons": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "version": "1.3.5",
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page()
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)

        async def on_dialog(dialog):
            await dialog.accept("3")   # 「按排名均衡分组」问组数

        page.on("dialog", on_dialog)

        await page.route(
            "**/xlsx.full.min.js",
            lambda route: route.fulfill(
                status=200,
                content_type="application/javascript; charset=utf-8",
                body=FAKE_XLSX_LIB,
            ),
        )
        await page.route(
            "**/html2canvas*.js",
            lambda route: route.fulfill(
                status=200,
                content_type="application/javascript; charset=utf-8",
                body=FAKE_HTML2CANVAS,
            ),
        )
        await page.add_init_script(
            "localStorage.setItem('classroomConfig', %s);"
            % json.dumps(json.dumps(cfg, ensure_ascii=False))
        )
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_timeout(1200)

        # ═══ 1. 面板更名 ═══
        print("=== 1. 「布局设置」更名 ===")
        title = await page.inner_text('[data-target="seatSettings"] .collapse-title')
        title = title.strip()
        body_text = await page.inner_text("body")
        if "布局设置" in title and "座位设置" not in body_text:
            ok(f'折叠面板标题 = 「{title}」，全页已无「座位设置」')
        else:
            bad(f'标题仍是「{title}」，或页面还有「座位设置」字样')

        # 造 3 个分组 + 打开学生管理面板
        await page.evaluate("document.getElementById('balanceGroupBtn').click()")
        await page.wait_for_timeout(1200)
        if not await page.locator("#studentManagement").is_visible():
            await page.click('[data-target="studentManagement"]')
            await page.wait_for_timeout(400)

        m = await page.evaluate(MEASURE)

        # ═══ 2~4. 分组行删除按钮 ═══
        print("=== 2~4. 分组行删除按钮 ===")
        gw, gh = m["groupDel"] or (0, 0)
        if abs(gw - 18) < 0.6 and abs(gh - 18) < 0.6:
            ok(f"分组行删除按钮 {gw:.0f}×{gh:.0f}（原 26×26）")
        else:
            bad(f"分组行删除按钮仍是 {gw:.0f}×{gh:.0f}，期望 18×18")

        transparent = m["groupDelBg"] in ("rgba(0, 0, 0, 0)", "transparent")
        circle = m["groupDelRadius"] in ("50%", "9px", "18px")
        if transparent and circle:
            ok(f"轻量外观：背景 {m['groupDelBg']}、圆角 {m['groupDelRadius']}")
        else:
            bad(f"外观未瘦身：背景 {m['groupDelBg']}、圆角 {m['groupDelRadius']}")

        if m["groupDelColor"] == "rgb(239, 68, 68)":
            ok(f"保留 danger 语义色 {m['groupDelColor']}")
        else:
            bad(f"删除按钮颜色异常：{m['groupDelColor']}，期望 rgb(239, 68, 68)")

        # ═══ 5. 详细设置学生行删除按钮 ═══
        print("=== 5. 详细设置学生行删除按钮 ===")
        sw, sh = m["studentDel"] or (0, 0)
        if abs(sw - 18) < 0.6 and abs(sh - 18) < 0.6:
            ok(f"学生行删除按钮 {sw:.0f}×{sh:.0f}（原 26×26）")
        else:
            bad(f"学生行删除按钮仍是 {sw:.0f}×{sh:.0f}，期望 18×18")

        # ═══ 6~7. 宽度确实让给了名称框 ═══
        print("=== 6~7. 名称框获得更多宽度 ===")
        aw = m["actionsW"] or 0
        if aw <= 80:
            ok(f"分组行操作区总宽 {aw:.0f}px（改造前 90px）")
        else:
            bad(f"分组行操作区仍占 {aw:.0f}px，期望 ≤ 80px")

        nw = m["groupNameW"] or 0
        if nw >= 40:
            ok(f"分组名输入框宽 {nw:.0f}px（改造前 32px）")
        else:
            bad(f"分组名输入框仅 {nw:.0f}px，仍偏窄")

        # ═══ 8. 无横向溢出 ═══
        print("=== 8. 行内无横向溢出 ===")
        if not m["overflow"]:
            ok("分组行 / 学生行均未溢出（scrollWidth ≤ clientWidth）")
        else:
            bad("存在横向溢出：" + "; ".join(m["overflow"]))

        # ═══ 9. 控制台 ═══
        print("=== 9. 控制台 ===")
        if not ERRORS:
            ok("全程无 JS 报错")
        else:
            bad("控制台报错：" + " | ".join(ERRORS[:3]))

        await browser.close()

    print("\n" + "=" * 42)
    print(f"通过 {PASSED} / 失败 {FAILED}")
    return 0 if FAILED == 0 else 1


raise SystemExit(asyncio.run(main()))
