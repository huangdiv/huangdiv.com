# -*- coding: utf-8 -*-
"""
批次29 — 「模式切换」「打印/PDF」改成与「智能排座」同款的两段式按钮

需求:
  1. 两个按钮都变成「上方按钮 + 下方下拉」:
       · 模式切换:上段仍按 普通 → 签到 → 分组 → 普通 轮换;下拉可直接选定某个模式
       · 打印/PDF:上段直接执行「打印 / 另存为 PDF」;下拉里是其他功能(图片 / CSV)
  2. 三段式外观与「智能排座」保持一致(等高、上下两段无缝)。

断言(共 14 项):
  1. 三个按钮都是两段式结构(上段 + 下段箭头)
  2. 三个按钮整组等高、顶底对齐
  3. 三处「上段 + 下段」均无缝拼接,且下段窄于上段
  4. 打印上段:点一下 → 直接调用 window.print(),且不展开下拉
  5. 打印下段:点一下 → 展开 printDropdown(一次点击即开)
  6. 打印下拉里已无「打印」项,只剩「导出为图片 / 导出为 CSV 座位表」
  7. 模式上段:连点三次 普通 → 签到 → 分组 → 普通
  8. 模式下段:展开 modeDropdown,当前模式项 aria-checked=true 且对勾可见
  9. 下拉直接选「分组模式」⇒ 进入分组模式,上段标题与勾选同步
 10. 下拉直接选「签到模式」⇒ 进入签到模式(内部先退出分组模式)
 11. 下拉直接选「普通模式」⇒ 回到普通模式
 12. 三个下拉互斥(开一个必关其余),aria-expanded 同步
 13. 点页面空白处 ⇒ 全部收起
 14. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
然后:
  python .workbuddy/smoke_test_batch29_split_buttons.py
"""
import asyncio
import json

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

PASSED = 0
FAILED = 0
ERRORS = []

FAKE_XLSX = """
window.XLSX = {
    read: function () { return { SheetNames: [], Sheets: {} }; },
    utils: { sheet_to_json: function () { return []; } }
};
"""

FAKE_H2C = """
window.html2canvas = function () {
    return Promise.reject(new Error('html2canvas stub in smoke test'));
};
"""

NAMES = ["张伟", "李娜", "王强", "赵敏", "孙悦", "陈晨"]


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


async def dd_state(page):
    return await page.evaluate(
        """() => ({
            mode: document.getElementById('modeDropdown').style.display,
            rand: document.getElementById('randomDropdown').style.display,
            print: document.getElementById('printDropdown').style.display,
            modeAria: document.getElementById('modeDropdownBtn').getAttribute('aria-expanded'),
            randAria: document.getElementById('randomDropdownBtn').getAttribute('aria-expanded'),
            printAria: document.getElementById('printDropdownBtn').getAttribute('aria-expanded')
        })"""
    )


async def mode_state(page):
    return await page.evaluate(
        """() => ({
            label: (document.getElementById('modeSwitchLabel') || {}).textContent || '',
            checkin: document.getElementById('classroom').classList.contains('checkin-mode'),
            group: document.getElementById('classroom').classList.contains('group-mode'),
            checked: Array.from(document.querySelectorAll('#modeDropdown [data-action="mode"]'))
                .filter(el => el.getAttribute('aria-checked') === 'true')
                .map(el => el.getAttribute('data-mode'))
        })"""
    )


async def click_mode(page, mode):
    """展开模式下拉并点某一项"""
    await page.click("#modeDropdownBtn")
    await page.wait_for_timeout(250)
    await page.click(f'#modeDropdown [data-mode="{mode}"]')
    await page.wait_for_timeout(500)


async def main():
    global PASSED, FAILED

    students = [
        {"id": f"s{i+1}", "name": n, "groupId": None, "checkedIn": False,
         "gender": "male" if i % 2 == 0 else "female", "tags": [], "rank": i + 1,
         "zonePref": "", "zoneAvoid": ""}
        for i, n in enumerate(NAMES)
    ]
    cfg = {
        "title": "批次29测试",
        "rows": 2, "cols": 3,
        "seats": [f"s{i+1}" for i in range(len(NAMES))],
        "students": students,
        "groups": [{"id": "g1", "name": "1组", "color": "#4ECDC4"}],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "forcedPairs": [], "avoidPairs": [],
        "version": "1.4.1",
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        await page.route("**/xlsx.full.min.js",
                         lambda r: r.fulfill(status=200,
                                             content_type="application/javascript; charset=utf-8",
                                             body=FAKE_XLSX))
        await page.route("**/html2canvas*.js",
                         lambda r: r.fulfill(status=200,
                                             content_type="application/javascript; charset=utf-8",
                                             body=FAKE_H2C))
        await page.add_init_script(
            "localStorage.setItem('classroomConfig', %s);"
            % json.dumps(json.dumps(cfg, ensure_ascii=False))
        )
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_timeout(1200)
        # stub 掉打印,避免 headless 下阻塞
        await page.evaluate(
            "() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; }")

        # ═══ 1. 结构 ═══
        print("=== 1. 三个按钮都是两段式结构 ===")
        struct = await page.evaluate(
            """() => {
                const ws = Array.from(document.querySelectorAll('.quick-actions .action-btn-split'));
                return ws.map(w => ({
                    main: (w.querySelector('.action-btn-split-main') || {}).id || '',
                    caret: (w.querySelector('.action-btn-split-caret') || {}).id || ''
                }));
            }"""
        )
        expect = [
            {"main": "modeSwitchBtn", "caret": "modeDropdownBtn"},
            {"main": "smartArrangeBtn", "caret": "randomDropdownBtn"},
            {"main": "printBtn", "caret": "printDropdownBtn"},
        ]
        if struct == expect:
            ok("三个 wrapper 均为 主按钮 + 箭头 两段式：" +
               " / ".join(s["main"] for s in struct))
        else:
            bad(f"结构不符，实际 {struct}")

        # ═══ 2. 等高 + 3. 无缝 ═══
        print("=== 2~3. 三段等高、上下两段无缝 ===")
        geo = await page.evaluate(
            """() => {
                const box = el => { const r = el.getBoundingClientRect();
                    return { h: Math.round(r.height * 10) / 10,
                             top: Math.round(r.top * 10) / 10,
                             bottom: Math.round(r.bottom * 10) / 10 }; };
                const ids = [['modeSwitchBtn','modeDropdownBtn'],
                             ['smartArrangeBtn','randomDropdownBtn'],
                             ['printBtn','printDropdownBtn']];
                const pairs = ids.map(([m, c]) => ({ main: box(document.getElementById(m)),
                                                     caret: box(document.getElementById(c)) }));
                const splits = Array.from(document.querySelectorAll('.action-btn-split')).map(box);
                return { pairs: pairs, splits: splits };
            }"""
        )
        hs = [s["h"] for s in geo["splits"]]
        tops = [s["top"] for s in geo["splits"]]
        if max(hs) - min(hs) <= 1 and max(tops) - min(tops) <= 1:
            ok(f"三组总高一致 {hs}，顶边对齐")
        else:
            bad(f"高度/对齐不一致：heights={hs} tops={tops}")

        seams = [round(p["caret"]["top"] - p["main"]["bottom"], 1) for p in geo["pairs"]]
        narrower = all(p["caret"]["h"] < p["main"]["h"] for p in geo["pairs"])
        if all(abs(s) <= 1 for s in seams) and narrower:
            ok(f"三处拼接无缝（缝 {seams}），下段均窄于上段")
        else:
            bad(f"拼接异常：seams={seams} narrower={narrower}")

        # ═══ 4. 打印上段直接打印 ═══
        print("=== 4. 打印上段点一下 = 直接打印 ===")
        await page.click("#printBtn")
        await page.wait_for_timeout(500)
        st = await dd_state(page)
        calls = await page.evaluate("() => window.__printCalls")
        if calls == 1 and st["print"] == "none":
            ok(f"window.print 被调用 {calls} 次，且未展开下拉")
        else:
            bad(f"打印没直接执行：print 调用 {calls} 次，下拉 {st['print']}")

        # ═══ 5. 打印下段展开 ═══
        print("=== 5. 打印下段一次点击即展开 ===")
        await page.click("#printDropdownBtn")
        await page.wait_for_timeout(250)
        st = await dd_state(page)
        if st["print"] == "block" and st["printAria"] == "true":
            ok("printDropdown 打开，aria-expanded=true")
        else:
            bad(f"下段未展开：display={st['print']} aria={st['printAria']}")

        # ═══ 6. 下拉里只剩其他功能 ═══
        print("=== 6. 打印下拉只保留「其他功能」 ===")
        acts = await page.evaluate(
            """() => Array.from(document.querySelectorAll('#printDropdown [data-action]'))
                .map(el => el.getAttribute('data-action'))"""
        )
        has_print = await page.locator('#printDropdown [data-action="print"]').count()
        if acts == ["exportImage", "exportSeatCsv"] and has_print == 0:
            ok(f"菜单项 = {acts}（已无 print 项）")
        else:
            bad(f"菜单项不对：{acts}，print 项 {has_print} 个")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        # ═══ 7. 模式上段轮换 ═══
        print("=== 7. 模式上段连点三次 ≈ 普通→签到→分组→普通 ===")
        seq = []
        for _ in range(3):
            await page.click("#modeSwitchBtn")
            await page.wait_for_timeout(450)
            s = await mode_state(page)
            seq.append("签到" if s["checkin"] else ("分组" if s["group"] else "普通"))
        if seq == ["签到", "分组", "普通"]:
            ok("轮换顺序 = " + " → ".join(seq))
        else:
            bad(f"轮换顺序不对：{seq}")

        # ═══ 8. 模式下拉打开 + 当前项打勾 ═══
        print("=== 8. 模式下拉：当前项 aria-checked + 对勾可见 ===")
        await page.click("#modeDropdownBtn")
        await page.wait_for_timeout(250)
        st = await dd_state(page)
        s = await mode_state(page)
        check_opacity = await page.evaluate(
            """() => {
                const on = document.querySelector('#modeDropdown [data-mode="normal"] .mode-menu-check');
                const off = document.querySelector('#modeDropdown [data-mode="group"] .mode-menu-check');
                return { on: getComputedStyle(on).opacity, off: getComputedStyle(off).opacity };
            }"""
        )
        if (st["mode"] == "block" and s["checked"] == ["normal"]
                and float(check_opacity["on"]) > 0.9 and float(check_opacity["off"]) < 0.1):
            ok(f"当前勾选 {s['checked']}，对勾 opacity {check_opacity}")
        else:
            bad(f"勾选状态不对：display={st['mode']} checked={s['checked']} opacity={check_opacity}")

        # ═══ 9. 选「分组模式」 ═══
        print("=== 9. 下拉直接选「分组模式」 ===")
        await page.click('#modeDropdown [data-mode="group"]')
        await page.wait_for_timeout(600)
        s = await mode_state(page)
        st = await dd_state(page)
        if s["group"] and not s["checkin"] and s["label"] == "分组模式" and \
                s["checked"] == ["group"] and st["mode"] == "none":
            ok("进入分组模式，上段标题「分组模式」，勾选同步，下拉已收起")
        else:
            bad(f"选分组模式失败：{s} display={st['mode']}")

        # ═══ 10. 选「签到模式」（应自动退出分组模式） ═══
        print("=== 10. 下拉直接选「签到模式」 ===")
        await click_mode(page, "checkin")
        s = await mode_state(page)
        if s["checkin"] and not s["group"] and s["label"] == "签到模式":
            ok("进入签到模式，已自动退出分组模式")
        else:
            bad(f"选签到模式失败：{s}")

        # ═══ 11. 选「普通模式」 ═══
        print("=== 11. 下拉直接选「普通模式」 ===")
        await click_mode(page, "normal")
        s = await mode_state(page)
        if not s["checkin"] and not s["group"] and s["label"] == "普通模式":
            ok("回到普通模式")
        else:
            bad(f"回普通模式失败：{s}")

        # ═══ 12. 三个下拉互斥 ═══
        print("=== 12. 三个下拉互斥 ===")
        await page.click("#modeDropdownBtn")
        await page.wait_for_timeout(200)
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(200)
        st1 = await dd_state(page)
        await page.click("#printDropdownBtn")
        await page.wait_for_timeout(200)
        st2 = await dd_state(page)
        if (st1["rand"] == "block" and st1["mode"] == "none" and st1["modeAria"] == "false"
                and st2["print"] == "block" and st2["rand"] == "none" and st2["randAria"] == "false"):
            ok("mode↔random↔print 两两互斥，aria-expanded 同步")
        else:
            bad(f"互斥失效：{st1} / {st2}")

        # ═══ 13. 点空白处收起 ═══
        print("=== 13. 点空白处收起全部下拉 ===")
        await page.mouse.click(700, 700)
        await page.wait_for_timeout(300)
        st = await dd_state(page)
        if st["mode"] == "none" and st["rand"] == "none" and st["print"] == "none":
            ok("三个下拉全部收起")
        else:
            bad(f"仍有展开：{st}")

        # ═══ 14. 控制台 ═══
        print("=== 14. 控制台 ===")
        real = [e for e in ERRORS if "html2canvas" not in e and "Failed to load resource" not in e]
        if not real:
            ok("全程无 JS 报错")
        else:
            bad("控制台报错：" + " | ".join(real[:3]))

        await page.screenshot(path="C:/Users/xingz/AppData/Local/Temp/batch29_header.png",
                              clip={"x": 0, "y": 0, "width": 1440, "height": 260})
        await browser.close()

    print(f"\n通过 {PASSED} / 失败 {FAILED}")
    if FAILED:
        raise SystemExit(1)


asyncio.run(main())
