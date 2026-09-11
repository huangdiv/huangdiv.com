# -*- coding: utf-8 -*-
"""
批次22 — 开启「隐藏图标」时同步隐藏「某行某列」坐标标签

背景:座位上的「X排Y列」坐标标签(seat-number)原本与图标(性别/标签)独立显示。
      用户要求:开启「隐藏图标」(showStudentIcons=false)时,连同坐标标签一起隐藏。

修复要点(modules/seat-grid.js renderSeatInner):
  numberHtml 仅当 showIcons 为真时才生成,否则为空串 ⇒ 图标与坐标标签随同一开关共存亡。

断言(共 7 项):
  1.   默认(显示图标)时,座位上存在 .seat-number 坐标标签
  2.   默认时 .seat-number 文本内容形如「N排M列」
  3.   点击「隐藏图标」后,所有 .seat-number 消失(坐标标签隐藏)
  4.   点击「隐藏图标」后,图标(.seat-icons)也消失(既有行为不被破坏)
  5.   再次点击「显示图标」后,.seat-number 重新出现
  6.   空座位(无学生)的「X排Y列」在隐藏图标时同样消失
  7.   全程无 JS 报错
"""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

PASSED = 0
FAILED = 0


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


def check(cond, msg):
    ok(msg) if cond else bad(msg)


INJECT_JS = """({rows, cols}) => {
    const students = [];
    for (let i = 0; i < 24; i++) {
        students.push({
            id: 's' + (i + 1), name: '学生' + (i + 1), groupId: '',
            tags: [{emoji: '🏷', label: '标签' + i}], checkedIn: false,
            gender: i % 2 === 0 ? 'male' : 'female'
        });
    }
    const seats = Array(rows * cols).fill(null);
    students.forEach((s, i) => { seats[i] = s.id; });
    localStorage.setItem('classroomConfig', JSON.stringify({
        title: '隐藏图标同步隐藏坐标', rows, cols, seats, students, groups: [],
        viewMode: 'student', aisles: [], showStudentIcons: true,
        forcedPairs: [], avoidPairs: [], isCheckinMode: false,
        isGroupMode: false, groupRotateOffset: 1, version: '1.3.1'
    }));
}"""


async def inject(page, rows=4, cols=6):
    await page.evaluate(INJECT_JS, {"rows": rows, "cols": cols})
    await page.reload()
    await page.wait_for_timeout(500)


async def main():
    global PASSED, FAILED
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(BASE)
        await page.wait_for_timeout(500)

        # ── 场景 1:默认显示图标时坐标标签存在 ──
        print("\n── 场景 1:默认(显示图标)坐标标签可见 ──")
        await inject(page)
        count_default = await page.evaluate("document.querySelectorAll('.seat .seat-number').length")
        check(count_default > 0, f"显示图标时存在 .seat-number(数量 {count_default})")

        # ── 场景 2:文本形如「N排M列」 ──
        sample = await page.evaluate(
            "(() => { const e = document.querySelector('.seat .seat-number'); return e ? e.textContent : ''; })()"
        )
        check("排" in sample and "列" in sample, f"坐标文本形如『N排M列』(样本:『{sample}』)")

        # ── 场景 3:点击「隐藏图标」后坐标标签消失 ──
        print("\n── 场景 3:开启隐藏图标 ⇒ 坐标标签消失 ──")
        await page.click("#toggleIconsBtn")
        await page.wait_for_timeout(400)
        btn_text = await page.evaluate("document.getElementById('toggleIconsBtn').textContent")
        check(btn_text == "显示图标", f"按钮文案切换为『{btn_text}』")
        count_hidden = await page.evaluate("document.querySelectorAll('.seat .seat-number').length")
        check(count_hidden == 0, f"隐藏图标后无 .seat-number(数量 {count_hidden},应为 0)")

        # ── 场景 4:图标本身也消失(既有行为) ──
        count_icons = await page.evaluate("document.querySelectorAll('.seat .seat-icons').length")
        check(count_icons == 0, f"隐藏图标后无 .seat-icons(数量 {count_icons},应为 0)")

        # ── 场景 5:再次点击显示图标 ⇒ 坐标标签回归 ──
        print("\n── 场景 5:再次显示图标 ⇒ 坐标标签回归 ──")
        await page.click("#toggleIconsBtn")
        await page.wait_for_timeout(400)
        count_shown = await page.evaluate("document.querySelectorAll('.seat .seat-number').length")
        check(count_shown > 0, f"重新显示后 .seat-number 回归(数量 {count_shown})")

        # ── 场景 6:空座位坐标标签在隐藏图标时同样消失 ──
        print("\n── 场景 6:空座位坐标标签随隐藏图标消失 ──")
        await page.evaluate("""() => {
            const cfg = JSON.parse(localStorage.getItem('classroomConfig'));
            cfg.seats = cfg.seats.map((_, i) => (i % 7 === 0 ? null : cfg.seats[i]));
            localStorage.setItem('classroomConfig', JSON.stringify(cfg));
        }""")
        await page.reload()
        await page.wait_for_timeout(400)
        await page.click("#toggleIconsBtn")
        await page.wait_for_timeout(400)
        empty_has_number = await page.evaluate(
            "(() => { const e = document.querySelector('.seat.empty .seat-number'); return !!e; })()"
        )
        check(not empty_has_number, "隐藏图标时空座位也无 .seat-number")

        # ── 场景 7:控制台 ──
        print("\n── 场景 7:控制台 ──")
        check(len(errors) == 0, f"无 pageerror {errors[:3]}")

        await page.screenshot(path="smoke_test_batch22.png")
        await browser.close()

    print("\n" + "=" * 56)
    print(f"总计: {PASSED + FAILED} 项,{PASSED} 通过,{FAILED} 失败")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
