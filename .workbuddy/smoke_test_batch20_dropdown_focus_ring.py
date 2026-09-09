# -*- coding: utf-8 -*-
"""
批次20 — 下拉菜单键盘焦点环与顶/底圆角项的协调性

问题:菜单容器 .print-dropdown 有圆角 + overflow:hidden,而菜单项的焦点环是
      矩形内描边 ⇒ 最顶/最底项聚焦时,描边在圆角处被裁掉一块,与菜单外形不搭。

修复:
  1. 菜单首/末子元素继承容器圆角(calc(var(--radius-md) - 1px)),
     inset 描边随之贴合圆角;
  2. 焦点环改为「1px 底色 + 2px 主色」双层 inset,与容器 1px 边框之间留 1px 呼吸;
  3. 轮换步长 ± 小按钮补内描边焦点样式(自身小圆角),不再出现 UA 默认矩形蓝框。

断言(共 12 项):
  1-4. 首项上圆角 / 首项下圆角为 0 / 末项下圆角 / 末项上圆角为 0
  5-6. 首项、末项聚焦时 outline 为 none(不出现矩形 UA 框)
  7-8. 焦点环是双层 inset(含底色 1px + 主色 3px)
  9.   中间项保持矩形(不误加圆角)
  10.  首项聚焦时圆角值与容器 --radius-md - 1px 一致
  11.  步长 ± 按钮聚焦用 inset 内描边 + outline none
  12.  无 JS 报错
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


INJECT_JS = """() => {
    // 3 组 ⇒ 步长上限 2,offset=1 时 plus 非 disabled(可聚焦)
    const groups = [{ id: 'g1', name: '第一组', color: '#FF9F9F' },
                    { id: 'g2', name: '第二组', color: '#9FCFFF' },
                    { id: 'g3', name: '第三组', color: '#9FFFBE' }];
    const students = [];
    for (let i = 1; i <= 12; i++) {
        students.push({
            id: 's' + i, name: '学生' + i,
            groupId: i <= 4 ? 'g1' : (i <= 8 ? 'g2' : 'g3'),
            tags: [], checkedIn: false, gender: i % 2 ? 'male' : 'female'
        });
    }
    const seats = Array(12).fill(null);
    students.forEach((s, i) => { seats[i] = s.id; });
    localStorage.setItem('classroomConfig', JSON.stringify({
        title: '焦点环检查', rows: 3, cols: 6, seats, students, groups,
        viewMode: 'student', aisles: [], showStudentIcons: true,
        forcedPairs: [], avoidPairs: [], isCheckinMode: false,
        isGroupMode: false, groupRotateOffset: 1, version: '1.3.1'
    }));
}"""

STYLE_JS = """() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
        cls: el.className,
        text: (el.textContent || '').trim().slice(0, 12),
        tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius,
        br: cs.borderBottomRightRadius, bl: cs.borderBottomLeftRadius,
        boxShadow: cs.boxShadow,
        outline: cs.outlineStyle,
        isFirst: el.parentElement.firstElementChild === el,
        isLast: el.parentElement.lastElementChild === el
    };
}"""

RADIUS_JS = """() => {
    const menu = document.querySelector('#randomDropdown');
    const first = menu.firstElementChild;
    const last = menu.lastElementChild;
    const g = el => {
        const c = getComputedStyle(el);
        return [c.borderTopLeftRadius, c.borderTopRightRadius,
                c.borderBottomRightRadius, c.borderBottomLeftRadius];
    };
    return { menu: getComputedStyle(menu).borderTopLeftRadius,
             first: g(first), last: g(last),
             mid: g(menu.children[1]) };
}"""


async def main():
    global PASSED, FAILED
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(BASE)
        await page.wait_for_timeout(600)

        # 打开「智能排座」下拉(键盘:聚焦按钮 + Enter,确保 :focus-visible 生效)
        await page.focus("#randomDropdownBtn")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(300)

        print("\n── 场景 1:菜单首/末项圆角继承容器 ──")
        r = await page.evaluate(RADIUS_JS)
        # 容器 radius-md = 10px,减掉 1px 边框 ⇒ 9px
        check(r["first"][0] == "9px" and r["first"][1] == "9px",
              f"首项继承上圆角(实际 {r['first'][:2]})")
        check(r["first"][2] == "0px" and r["first"][3] == "0px",
              f"首项下缘保持直角(实际 {r['first'][2:]})")
        check(r["last"][2] == "9px" and r["last"][3] == "9px",
              f"末项继承下圆角(实际 {r['last'][2:]})")
        check(r["last"][0] == "0px" and r["last"][1] == "0px",
              f"末项上缘保持直角(实际 {r['last'][:2]})")
        check(r["mid"] == ["0px", "0px", "0px", "0px"],
              f"中间项保持矩形(实际 {r['mid']})")

        print("\n── 场景 2:键盘 Tab 焦点环 ──")
        seen = []
        # 菜单打开时第一项已 auto-focus ⇒ 先把它记进来,再 Tab 往后走
        s0 = await page.evaluate(STYLE_JS)
        if s0 and "dropdown" in (s0["cls"] or ""):
            seen.append(s0)
        for _ in range(10):
            await page.keyboard.press("Tab")
            await page.wait_for_timeout(120)
            s = await page.evaluate(STYLE_JS)
            if not s or "dropdown" not in (s["cls"] or ""):
                continue
            seen.append(s)
            if s["isLast"]:
                break

        first = next((s for s in seen if s["isFirst"]), None)
        last = next((s for s in seen if s["isLast"]), None)
        check(first is not None, "Tab 能聚焦到菜单首项")
        check(last is not None, "Tab 能聚焦到菜单末项")

        if first:
            check(first["outline"] == "none",
                  f"首项无矩形 UA outline(实际 {first['outline']})")
            check("1px inset" in first["boxShadow"] and "3px inset" in first["boxShadow"],
                  f"首项焦点为双层 inset 描边(实际 {first['boxShadow']})")
            check(first["tl"] == "9px",
                  f"首项焦点时圆角仍在 ⇒ 描边顺圆角(实际 {first['tl']})")
        if last:
            check(last["outline"] == "none",
                  f"末项无矩形 UA outline(实际 {last['outline']})")
            check(last["bl"] == "9px",
                  f"末项焦点时圆角仍在(实际 {last['bl']})")

        print("\n── 场景 3:轮换步长 ± 按钮焦点 ──")
        # 注入 2 组 12 人 ⇒ 「小组轮换」开启后才能显示步长行、plus 按钮非 disabled
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)
        await page.evaluate(INJECT_JS)
        await page.reload()
        await page.wait_for_timeout(700)
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(200)
        await page.click('#randomDropdown [data-toggle="rotate"]')
        await page.wait_for_timeout(250)
        # 注意:步长默认 +1 为最小值 ⇒ minus 是 disabled(不可聚焦),取 plus 验证
        await page.evaluate("document.querySelector('#rotateStepPlus').focus()")
        # 该按钮有 transition: all .15s ⇒ 等过渡走完再读终态
        await page.wait_for_timeout(300)
        btn = await page.evaluate("""() => {
            const b = document.activeElement;
            const cs = getComputedStyle(b);
            return { outline: cs.outlineStyle, shadow: cs.boxShadow,
                     radius: cs.borderTopLeftRadius, focused: b.id === 'rotateStepPlus' };
        }""")
        check(btn["focused"], "步长按钮可聚焦(未 disabled)")
        check(btn["outline"] == "none",
              f"步长按钮无 UA 矩形框(实际 {btn['outline']})")
        check("inset" in btn["shadow"] and "1px" in btn["shadow"]
              and "59, 130, 246" in btn["shadow"],
              f"步长按钮用 1px 主色内描边(跟随自身圆角)(实际 {btn['shadow']})")
        check(btn["radius"] == "6px",
              f"步长按钮保留自身小圆角(实际 {btn['radius']})")

        print("\n── 场景 4:控制台 ──")
        check(len(errors) == 0, f"无 pageerror {errors[:3]}")

        await page.screenshot(path="smoke_test_batch20.png")
        await browser.close()

    print("\n" + "=" * 56)
    print(f"总计: {PASSED + FAILED} 项,{PASSED} 通过,{FAILED} 失败")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
