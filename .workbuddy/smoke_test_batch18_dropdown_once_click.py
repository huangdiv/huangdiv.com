# -*- coding: utf-8 -*-
"""批次18 — 下拉按钮「一次点击即弹出」+ 三个快捷按钮等高

BUG 1:打印/PDF、智能排座的下拉按钮有时要点两下才弹出
  根因:setupActionDropdown 的 isOpen 是闭包变量,而两个下拉互斥关闭时
        只改了对方的 style.display,没同步对方的 isOpen。
        于是「A 开 → 点 B」后 A 的 isOpen 仍为 true,
        下次点 A 执行的是 setOpen(!true)=关闭 ⇒ 必须再点一次。
  修复:用 WeakMap 注册 controller,互斥关闭走对方 close();
        翻转状态改为以 DOM 实际 display 为准(双保险)。

BUG 2:智能排座分段按钮总高 81px,与切换模式/打印的 78px 不一致
  修复:下段 padding 收紧(57+22-1=78);同时让三者参与 flex 拉伸自动等高。
"""
import asyncio
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


DD_STATE_JS = """() => ({
    rand: document.getElementById('randomDropdown').style.display,
    print: document.getElementById('printDropdown').style.display,
    randAria: document.getElementById('randomDropdownBtn').getAttribute('aria-expanded'),
    printAria: document.getElementById('printBtn').getAttribute('aria-expanded')
})"""

HEIGHTS_JS = """() => {
    const box = el => { const r = el.getBoundingClientRect();
        return { h: Math.round(r.height * 10) / 10,
                 top: Math.round(r.top * 10) / 10,
                 bottom: Math.round(r.bottom * 10) / 10 }; };
    return {
        mode: box(document.getElementById('modeSwitchBtn')),
        print: box(document.getElementById('printBtn')),
        split: box(document.querySelector('.action-btn-split')),
        main: box(document.getElementById('smartArrangeBtn')),
        caret: box(document.getElementById('randomDropdownBtn'))
    };
}"""


async def main():
    global passed, failed

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        await page.goto(BASE)
        await page.wait_for_timeout(900)

        # ── 场景 1:三个快捷按钮等高 ──
        print("\n── 场景 1:切换模式 / 智能排座 / 打印 三按钮等高 ──")
        h = await page.evaluate(HEIGHTS_JS)
        heights = [h["mode"]["h"], h["split"]["h"], h["print"]["h"]]
        check(
            max(heights) - min(heights) <= 1,
            f"三者总高一致 {heights}(差 {max(heights)-min(heights)}px)",
        )
        tops = [h["mode"]["top"], h["split"]["top"], h["print"]["top"]]
        check(max(tops) - min(tops) <= 1, f"顶边对齐 {tops}")
        bots = [h["mode"]["bottom"], h["split"]["bottom"], h["print"]["bottom"]]
        check(max(bots) - min(bots) <= 1, f"底边对齐 {bots}")

        # ── 场景 2:分段两段无缝拼接 ──
        print("\n── 场景 2:智能排座上下两段无缝 ──")
        seam = round(h["caret"]["top"] - h["main"]["bottom"], 1)
        check(abs(seam) <= 1, f"上下两段无空隙/重叠(缝 {seam}px)")
        check(
            h["caret"]["h"] < h["main"]["h"],
            f"下段(caret {h['caret']['h']}px)窄于上段(main {h['main']['h']}px)",
        )

        # ── 场景 3:首次点击即弹出 ──
        print("\n── 场景 3:首次点击即弹出 ──")
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(200)
        st = await page.evaluate(DD_STATE_JS)
        check(st["rand"] == "block", f"点一次 random 下拉即打开(实际 {st['rand']})")
        check(st["randAria"] == "true", f"aria-expanded 同步为 true(实际 {st['randAria']})")

        # ── 场景 4:互斥切换后仍一次点击即开(原 bug 高发点) ──
        print("\n── 场景 4:互斥切换后仍一次点击即开 ──")
        await page.click("#printBtn")
        await page.wait_for_timeout(200)
        st = await page.evaluate(DD_STATE_JS)
        check(
            st["print"] == "block" and st["rand"] == "none",
            f"点 print ⇒ print 开、random 关(实际 print={st['print']}, rand={st['rand']})",
        )
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(200)
        st = await page.evaluate(DD_STATE_JS)
        check(
            st["rand"] == "block",
            f"【关键】切回 random 时一次点击即打开(实际 {st['rand']})",
        )
        check(st["print"] == "none", f"random 打开时 print 已关闭(实际 {st['print']})")
        check(
            st["printAria"] == "false",
            f"被关闭方的 aria-expanded 同步为 false(实际 {st['printAria']})",
        )

        # ── 场景 5:连续交替 8 次,每次都必须是打开态 ──
        print("\n── 场景 5:连续交替 8 次 ──")
        # 归零:确保从「两者都关闭」开始(场景 4 结束时 random 是打开的,
        # 此时再点它属于正常的 toggle 关闭,不该计入失败)
        st = await page.evaluate(DD_STATE_JS)
        if st["rand"] == "block":
            await page.click("#randomDropdownBtn")
            await page.wait_for_timeout(200)
        seq_ok, detail = True, []
        for i in range(8):
            btn, dd = ("#printBtn", "print") if i % 2 else ("#randomDropdownBtn", "rand")
            await page.click(btn)
            await page.wait_for_timeout(150)
            st = await page.evaluate(DD_STATE_JS)
            if st[dd] != "block":
                seq_ok = False
                detail.append(f"第{i+1}次点 {btn} 未打开({st[dd]})")
        check(seq_ok, "连续交替 8 次每次都一次打开" if seq_ok else f"存在失效:{detail[:3]}")

        # ── 场景 6:菜单项点击后再点仍一次打开 ──
        print("\n── 场景 6:点过菜单项后再点仍一次打开 ──")
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(200)
        await page.click("#randomDropdown [data-action='pairSettings']")
        await page.wait_for_timeout(400)
        await page.keyboard.press("Escape")     # 关掉配对弹窗
        await page.wait_for_timeout(300)
        st = await page.evaluate(DD_STATE_JS)
        check(st["rand"] == "none", f"点菜单项后下拉关闭(实际 {st['rand']})")
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        st = await page.evaluate(DD_STATE_JS)
        check(
            st["rand"] == "block",
            f"点过菜单项后再点仍一次打开(实际 {st['rand']})",
        )

        # ── 场景 7:无 JS 报错 ──
        print("\n── 场景 7:无 JS 报错 ──")
        check(not errors, f"无 pageerror(实际 {errors[:2]})" if errors else "无 pageerror")

        await browser.close()

    print("\n" + "=" * 56)
    print(f"批次18 结果: {passed} 通过 / {failed} 失败")
    print("=" * 56)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
