# -*- coding: utf-8 -*-
"""
批次16 — 打印/导出图片:日期接在标题后同一行

场景:
 1. 标题行结构:.page-title-row 内 h1#pageTitle 与 span#titleDate 相邻
 2. 屏幕上日期不显示(display:none)
 3. 打印前准备:点「打印」⇒ #titleDate 写入今天的 yyyy-mm-dd
 4. 打印态:日期可见、与标题同一行(h1 inline-block、不再 translateX 自居中)
 5. 导出图片:克隆的标题行里含日期(与标题在同一容器同一行)
 6. 无 JS 报错
"""
import asyncio
import datetime

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

PASSED = 0
FAILED = 0


def check(cond, msg):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  [OK] {msg}")
    else:
        FAILED += 1
        print(f"  [FAIL] {msg}")


async def main():
    global PASSED, FAILED
    today = datetime.date.today().strftime("%Y-%m-%d")

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        await page.goto(BASE)
        await page.wait_for_timeout(900)

        # ── 场景 1:标题行结构 ──
        print("\n── 场景 1:标题行结构 ──")
        struct = await page.evaluate(
            """() => {
                const row = document.querySelector('.page-title-row');
                const h1 = document.getElementById('pageTitle');
                const dt = document.getElementById('titleDate');
                return {
                    hasRow: !!row,
                    inRow: !!row && row.contains(h1) && row.contains(dt),
                    adjacent: h1 && dt ? h1.nextElementSibling === dt : false,
                    title: h1 ? h1.textContent.trim() : null
                };
            }"""
        )
        check(struct["hasRow"] and struct["inRow"], f"标题与日期同在 .page-title-row(实际 {struct})")
        check(struct["adjacent"], f"日期紧跟在标题之后(实际 {struct['adjacent']})")

        # ── 场景 2:屏幕上不显示 ──
        print("\n── 场景 2:屏幕上日期隐藏 ──")
        screen_disp = await page.evaluate(
            "getComputedStyle(document.getElementById('titleDate')).display"
        )
        check(screen_disp == "none", f"屏幕态 .title-date display:none(实际 {screen_disp!r})")

        # ── 场景 3:打印前写入日期 ──
        print("\n── 场景 3:点打印 ⇒ 写入今天日期 ──")
        # headless 下 window.print() 无实际效果,stub 掉以免阻塞
        await page.evaluate("() => { window.print = () => {}; }")
        await page.click("#printBtn")
        await page.wait_for_timeout(300)
        await page.click("#printDropdown [data-action='print']")
        await page.wait_for_timeout(700)
        date_text = await page.evaluate(
            "(document.getElementById('titleDate') || {}).textContent"
        )
        check(date_text == today, f"#titleDate 写入今天日期 {today}(实际 {date_text!r})")

        # ── 场景 4:打印态同排显示 ──
        print("\n── 场景 4:打印态日期与标题同行 ──")
        await page.emulate_media(media="print")
        await page.wait_for_timeout(200)
        geo = await page.evaluate(
            """() => {
                const h1 = document.getElementById('pageTitle');
                const dt = document.getElementById('titleDate');
                const a = h1.getBoundingClientRect(), b = dt.getBoundingClientRect();
                const cs = getComputedStyle(h1);
                return {
                    disp: getComputedStyle(dt).display,
                    title: a.width > 0, dateW: Math.round(b.width),
                    sameRow: b.left >= a.right - 1 && b.top < a.bottom && a.top < b.bottom,
                    pos: cs.position, left: cs.left, transform: cs.transform,
                    display: cs.display
                };
            }"""
        )
        check(geo["disp"] != "none" and geo["dateW"] > 0,
              f"打印态日期可见(实际 display={geo['disp']!r} 宽={geo['dateW']}px)")
        check(geo["sameRow"], f"日期在标题右侧、垂直重叠(同一行)(实际 {geo})")
        check(geo["display"] == "inline-block", f"打印态 h1 为 inline-block(实际 {geo['display']!r})")
        check(geo["pos"] == "static" and geo["left"] == "auto",
              f"h1 不再绝对偏移自居中(实际 position={geo['pos']} left={geo['left']})")
        await page.emulate_media(media="screen")
        await page.wait_for_timeout(200)

        # ── 场景 5:导出图片的标题行含日期 ──
        print("\n── 场景 5:导出图片克隆标题行含日期 ──")
        # stub html2canvas(离线环境也能跑),捕获传入的 wrapper 结构
        await page.evaluate(
            """() => {
                window.__captured = null;
                window.html2canvas = (el) => {
                    window.__captured = el.outerHTML;
                    return Promise.resolve({ toDataURL: () => 'data:image/png;base64,AA==',
                                             width: 10, height: 10 });
                };
            }"""
        )
        await page.click("#printBtn")
        await page.wait_for_timeout(300)
        await page.click("#printDropdown [data-action='exportImage']")
        await page.wait_for_timeout(900)
        cap = await page.evaluate("window.__captured || ''")
        check(bool(cap), "导出流程已调用 html2canvas")
        check("title-date" in cap or "titleDate" in cap,
              f"克隆的标题行包含日期节点(实际片段 {cap[:120]!r})")
        check(today in cap, f"克隆标题行含今天日期 {today}(实际含日期 {today in cap})")
        same_line_clone = await page.evaluate(
            """() => {
                const html = window.__captured || '';
                const i = html.indexOf('title-date');
                const j = html.indexOf('</h1>');
                return { hasBoth: i > 0 && j > 0, dtAfterTitle: i > j };
            }"""
        )
        check(same_line_clone["hasBoth"] and same_line_clone["dtAfterTitle"],
              f"日期节点紧随 h1 之后(同一行容器)(实际 {same_line_clone})")

        # ── 场景 6:无 JS 报错 ──
        print("\n── 场景 6:控制台无报错 ──")
        check(not errors, f"无 pageerror(实际 {errors[:3]})")

        await browser.close()

    print("\n" + "=" * 46)
    print(f"通过 {PASSED} / 失败 {FAILED}")
    print("=" * 46)
    return 1 if FAILED else 0


raise SystemExit(asyncio.run(main()))
