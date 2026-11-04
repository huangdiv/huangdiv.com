# -*- coding: utf-8 -*-
"""
批次30 — 「配对设置」菜单项计数徽标必须在首屏就正确

缺陷(修复前):
  「智能排座」下拉里的「配对设置」后面会带计数,如「配对设置 [2强/1避]」。
  但这段文案只在 openPairPopup() 内部的 renderAll() 里刷新 ⇒ 刷新页面后
  徽标一直是空的,必须点开一次「配对设置」弹窗之后才出现。

修复:
  抽出幂等函数 updatePairSettingsLabel(),挂到
    · afterSeatsRender()(座位每次重绘都会走到,覆盖初始化 / 应用配置 / 导入配置)
    · openPairPopup() 的 renderAll()(弹窗内增删配对)
    · initialize() 末尾(首屏兜底)

断言(共 12 项):
  1. 刷新后(未打开任何弹窗)徽标 = 「配对设置 [2强/1避]」
  2. 此时页面上没有任何 .pair-popup(证明不是靠"打开过一次"才变对的)
  3. 展开「智能排座」下拉后徽标文字不变,且可见(非 0 尺寸)
  4. 点开「配对设置」弹窗后徽标仍为「配对设置 [2强/1避]」(不重复累加 / 不加空格)
  5. 弹窗内新增 1 组强制同桌 ⇒ 徽标即时变「[3强/1避]」
  6. 弹窗内删除唯一的回避配对 ⇒ 徽标即时变「[3强]」(无斜杠、无空括号)
  7. 关闭弹窗、等待自动保存后刷新页面 ⇒ 徽标「[3强]」(刷新即正确,核心回归点)
  8. 只有回避配对(2 组)的配置 ⇒ 刷新后「配对设置 [2避]」(不带前导斜杠)
  9. 完全无配对的配置 ⇒ 刷新后正好是「配对设置」(不出现 "[]")
 10. 徽标只在标签内改文字,不破坏 💞 图标结构(图标仍存在且非空)
 11. 三种配置下徽标宽度都能被菜单项容纳(不换行 / 不溢出菜单项)
 12. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
然后:
  python .workbuddy/smoke_test_batch30_pair_badge.py
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

LABEL_SEL = '[data-action="pairSettings"] .pair-settings-label'


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


def make_config(title, forced, avoid):
    students = [
        {"id": f"s{i+1}", "name": n, "groupId": None, "checkedIn": False,
         "gender": "male" if i % 2 == 0 else "female", "tags": [], "rank": i + 1,
         "zonePref": "", "zoneAvoid": ""}
        for i, n in enumerate(NAMES)
    ]
    return {
        "title": title,
        "rows": 2, "cols": 3,
        "seats": [f"s{i+1}" for i in range(len(NAMES))],
        "students": students,
        "groups": [],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "forcedPairs": forced,
        "avoidPairs": avoid,
        "version": "1.4.2",
    }


async def label_info(page):
    return await page.evaluate(
        """(sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const item = el.closest('.print-dropdown-item');
            const ir = item ? item.getBoundingClientRect() : null;
            const r = el.getBoundingClientRect();
            const icon = item ? item.querySelector('.print-dropdown-icon') : null;
            return {
                text: el.textContent,
                w: Math.round(r.width),
                h: Math.round(r.height),
                itemW: ir ? Math.round(ir.width) : 0,
                itemH: ir ? Math.round(ir.height) : 0,
                // 溢出判定:标签右边缘不得越过菜单项右边缘(留 2px 容差)
                overflow: ir ? Math.round((r.right - ir.right) * 10) / 10 : 0,
                icon: icon ? icon.textContent.trim() : '',
                popups: document.querySelectorAll('.pair-popup').length
            };
        }""",
        LABEL_SEL,
    )


async def mount(page, cfg):
    """写入 localStorage 后重载页面(模拟用户刷新)"""
    await page.evaluate(
        "cfg => localStorage.setItem('classroomConfig', JSON.stringify(cfg))", cfg)
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(1200)


async def main():
    global PASSED, FAILED

    cfg_a = make_config("批次30-两组强制一组回避",
                        [["s1", "s2"], ["s3", "s4"]], [["s5", "s6"]])
    cfg_b = make_config("批次30-只有回避", [], [["s1", "s2"], ["s3", "s4"]])
    cfg_c = make_config("批次30-无配对", [], [])

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
            # 只在首次访问时写入,否则每次 reload 都会把 localStorage 覆盖回初始配置,
            #「改动 → 自动保存 → 刷新」这条链路就永远测不到(Playwright 的
            # add_init_script 每次导航都会重跑)。sessionStorage 在同一标签页的
            # reload 之间保留,正好当"已播种"标记。
            "if (!sessionStorage.getItem('__seeded')) {"
            "  localStorage.setItem('classroomConfig', %s);"
            "  sessionStorage.setItem('__seeded', '1');"
            "}" % json.dumps(json.dumps(cfg_a, ensure_ascii=False))
        )
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_timeout(1400)

        # ═══ 1. 刷新后徽标(核心) ═══
        print("=== 1. 刷新后,未打开任何弹窗 ===")
        info = await label_info(page)
        if info and info["text"] == "配对设置 [2强/1避]":
            ok(f"徽标首屏即为「{info['text']}」")
        else:
            bad(f"徽标不对：{info and info['text']!r}（期望 '配对设置 [2强/1避]'）")

        # ═══ 2. 没有弹窗 ═══
        print("=== 2. 此时页面无 .pair-popup ===")
        if info and info["popups"] == 0:
            ok("无弹窗存活 => 徽标不是靠打开对话框才变对的")
        else:
            bad(f"弹窗数量异常：{info and info['popups']}")

        # ═══ 3. 展开下拉后仍可见 ═══
        print("=== 3. 展开「智能排座」下拉 ===")
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(300)
        info2 = await label_info(page)
        if info2 and info2["text"] == "配对设置 [2强/1避]" and info2["w"] > 40 and info2["h"] > 8:
            ok(f"菜单展开后徽标不变且可见（{info2['w']}×{info2['h']}px）")
        else:
            bad(f"展开后异常：{info2}")

        # ═══ 4. 打开弹窗后不重复累加 ═══
        print("=== 4. 点开「配对设置」弹窗 ===")
        await page.click('[data-action="pairSettings"]')
        await page.wait_for_timeout(600)
        info3 = await label_info(page)
        if info3 and info3["text"] == "配对设置 [2强/1避]" and info3["popups"] == 1:
            ok(f"弹窗打开后徽标仍为「{info3['text']}」，弹窗 1 个")
        else:
            bad(f"弹窗打开后异常：{info3}")

        # ═══ 5. 新增一对强制 ⇒ 即时 +1 ═══
        print("=== 5. 弹窗内新增 1 组强制同桌 ===")
        await page.fill(".pair-forced-a", "王强")
        await page.fill(".pair-forced-b", "孙悦")
        await page.click(".pair-forced-add")
        await page.wait_for_timeout(500)
        info4 = await label_info(page)
        if info4 and info4["text"] == "配对设置 [3强/1避]":
            ok(f"新增后徽标 = 「{info4['text']}」")
        else:
            bad(f"新增后徽标不对：{info4 and info4['text']!r}")

        # ═══ 6. 删掉唯一回避 ⇒ 即时去掉 '/N避' ═══
        print("=== 6. 弹窗内删除唯一的回避配对 ===")
        cnt = await page.locator(".pair-avoid-list .pair-item-remove").count()
        if cnt == 1:
            await page.click(".pair-avoid-list .pair-item-remove")
            await page.wait_for_timeout(500)
            info5 = await label_info(page)
            if info5 and info5["text"] == "配对设置 [3强]":
                ok(f"删除后徽标 = 「{info5['text']}」（无斜杠、无空括号）")
            else:
                bad(f"删除后徽标不对：{info5 and info5['text']!r}")
        else:
            bad(f"回避配对删除按钮数量异常：{cnt}")

        # ═══ 7. 关弹窗 → 自动保存 → 刷新 ⇒ 仍正确 ═══
        print("=== 7. 关闭弹窗,等待自动保存后刷新 ===")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(900)
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(1300)
        info6 = await label_info(page)
        if info6 and info6["text"] == "配对设置 [3强]" and info6["popups"] == 0:
            ok(f"刷新后徽标 = 「{info6['text']}」，无弹窗")
        else:
            bad(f"刷新后徽标不对：{info6}")

        # ═══ 8. 只有回避 ═══
        print("=== 8. 只有回避配对(2 组)的配置 ===")
        await mount(page, cfg_b)
        info7 = await label_info(page)
        if info7 and info7["text"] == "配对设置 [2避]":
            ok(f"徽标 = 「{info7['text']}」（无前导斜杠）")
        else:
            bad(f"只有回避时徽标不对：{info7 and info7['text']!r}")

        # ═══ 9. 无配对 ═══
        print("=== 9. 完全无配对的配置 ===")
        await mount(page, cfg_c)
        info8 = await label_info(page)
        if info8 and info8["text"] == "配对设置":
            ok("徽标正好是「配对设置」，不出现 「[]」")
        else:
            bad(f"无配对时徽标不对：{info8 and info8['text']!r}")

        # ═══ 10. 图标结构完好 ═══
        print("=== 10. 菜单项结构(💞 图标) ===")
        await mount(page, cfg_a)
        info9 = await label_info(page)
        if info9 and info9["icon"] == "💞":
            ok("图标仍为 💞，标签文字就近更新未破坏结构")
        else:
            bad(f"图标异常：{info9 and info9['icon']!r}")

        # ═══ 11. 宽度容纳(三种配置) ═══
        print("=== 11. 三种文案都不溢出菜单项 ===")
        widths = []
        overflows = []
        for cfg in (cfg_a, cfg_b, cfg_c):
            await mount(page, cfg)
            # 隐藏时宽度为 0,必须先展开下拉再量
            await page.click("#randomDropdownBtn")
            await page.wait_for_timeout(250)
            inf = await label_info(page)
            widths.append(inf["text"] + f"({inf['w']}px/{inf['itemW']}px)")
            overflows.append(inf["overflow"])
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(150)
        if all(o <= 2 for o in overflows):
            ok("无溢出：" + " · ".join(widths))
        else:
            bad(f"有溢出：{overflows} · " + " · ".join(widths))

        # ═══ 12. 控制台 ═══
        print("=== 12. 控制台 ===")
        real = [e for e in ERRORS if "html2canvas" not in e and "Failed to load resource" not in e]
        if not real:
            ok("全程无 JS 报错")
        else:
            bad("控制台报错：" + " | ".join(real[:3]))

        await page.screenshot(path="C:/Users/xingz/AppData/Local/Temp/batch30_pair_badge.png",
                              clip={"x": 0, "y": 0, "width": 1440, "height": 260})
        await browser.close()

    print(f"\n通过 {PASSED} / 失败 {FAILED}")
    if FAILED:
        raise SystemExit(1)


asyncio.run(main())
