# -*- coding: utf-8 -*-
"""批次12:模式按钮等高 / 分组横幅两行布局 / 长按删除分组 / 视角切换保留分组按钮"""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

passed = 0
failed = 0


def ok(msg):
    global passed
    passed += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global failed
    failed += 1
    print(f"  [FAIL] {msg}")


async def main():
    global passed, failed
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        dialogs = []

        async def on_dialog(d):
            dialogs.append((d.type, d.message))
            if d.type == "prompt":
                await d.accept("测试组")
            else:
                await d.accept()

        page.on("dialog", on_dialog)

        await page.goto(BASE)
        await page.wait_for_timeout(800)
        await page.evaluate("""() => {
            const students = [];
            for (let i = 1; i <= 24; i++) students.push({id:'s'+i, name:'学生'+i, groupId:null, tags:[], checkedIn:false, gender: i%2?'male':'female'});
            localStorage.setItem('classroomConfig', JSON.stringify({
                title:'批次12', rows:5, cols:6, seats:Array(30).fill(null),
                students: students,
                groups:[
                    {id:'g1', name:'第一组', color:'#FF9F9F'},
                    {id:'g2', name:'第二组', color:'#9FCFFF'},
                    {id:'g3', name:'第三组', color:'#9FFFBE'}
                ],
                viewMode:'student', aisles:[], showStudentIcons:true,
                forcedPairs:[], avoidPairs:[], isCheckinMode:false, isGroupMode:false, version:'1.3.1'
            }));
        }""")
        await page.reload()
        await page.wait_for_timeout(900)

        # ══ 场景 1:三个快捷按钮等高 ══
        print("\n── 场景 1:模式切换/打印按钮等高 + 智能排座上下两段拼接 ──")
        heights = await page.evaluate("""() => {
            const get = id => {
                const el = document.getElementById(id);
                return el ? el.getBoundingClientRect() : null;
            };
            const mode = get('modeSwitchBtn'), print = get('printBtn');
            const main = get('smartArrangeBtn'), caret = get('randomDropdownBtn');
            const r = b => b ? Math.round(b.height) : null;
            return {
                mode: r(mode), print: r(print),
                main: r(main), caret: r(caret),
                seam: (main && caret) ? Math.round(caret.top - main.bottom) : null
            };
        }""")
        print("    按钮高度:", heights)
        if (heights["mode"] and heights["print"]
                and abs(heights["mode"] - heights["print"]) <= 1):
            ok("模式切换与打印按钮高度一致 (%dpx)" % heights["mode"])
        else:
            bad(f"模式切换/打印按钮高度不一致: {heights}")
        if (heights["main"] and heights["caret"] and heights["seam"] is not None
                and abs(heights["seam"]) <= 1):
            ok(f"智能排座上下两段无缝拼接 (缝 {heights["seam"]}px)")
        else:
            bad(f"智能排座分段异常: {heights}")

        # ══ 场景 2:进入分组模式,banner 两行布局 ══
        print("\n── 场景 2:分组 banner 两行布局 ──")
        await page.click("#modeSwitchBtn")   # 普通 → 签到
        await page.wait_for_timeout(300)
        await page.click("#modeSwitchBtn")   # 签到 → 分组
        await page.wait_for_timeout(500)

        layout = await page.evaluate("""() => {
            const banner = document.querySelector('#classroom .group-banner');
            if (!banner) return null;
            const main = banner.querySelector('.group-banner-main');
            const groups = banner.querySelector('.group-banner-groups');
            const tip = banner.querySelector('.group-banner-tip');
            const btn = banner.querySelector('.group-mode-group-btn');
            const r = el => { const b = el.getBoundingClientRect(); return {top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left)}; };
            return {
                rows: !!main && !!groups,
                main: main ? r(main) : null,
                groups: groups ? r(groups) : null,
                tip: tip ? r(tip) : null,
                btn: btn ? r(btn) : null,
                count: banner.querySelectorAll('.group-mode-group-btn').length
            };
        }""")
        if not layout:
            bad("分组 banner 未渲染")
        else:
            if layout["rows"]:
                ok("banner 拆分为 main / groups 两行容器")
            else:
                bad("banner 缺少两行容器")
            if layout["count"] == 3:
                ok("分组按钮渲染 3 个")
            else:
                bad(f"分组按钮数量异常: {layout['count']}")
            if layout["btn"] and layout["tip"]:
                if layout["btn"]["top"] >= layout["tip"]["bottom"] - 2:
                    ok("分组按钮已脱离说明文字所在行,另起一行(按钮顶 >= 说明行底)")
                else:
                    bad(f"分组按钮与说明文字同行: btn.top={layout['btn']['top']} tip.bottom={layout['tip']['bottom']}")
            if layout["groups"] and layout["main"]:
                if layout["groups"]["top"] >= layout["main"]["bottom"] - 2:
                    ok("分组行位于操作行下方(垂直堆叠)")
                else:
                    bad(f"分组行未换行: groups.top={layout['groups']['top']} main.bottom={layout['main']['bottom']}")

        # ══ 场景 3:视角切换后分组按钮仍在 ══
        print("\n── 场景 3:切换教师/学生视角后分组按钮保留 ──")
        await page.click("#toggleViewBtn")
        await page.wait_for_timeout(500)
        after_view = await page.evaluate(
            "document.querySelectorAll('#classroom .group-banner .group-mode-group-btn').length")
        if after_view == 3:
            ok("切换到教师视角后分组按钮仍为 3 个")
        else:
            bad(f"切换视角后分组按钮数量 = {after_view}(期望 3)")

        await page.click("#toggleViewBtn")
        await page.wait_for_timeout(500)
        after_view2 = await page.evaluate(
            "document.querySelectorAll('#classroom .group-banner .group-mode-group-btn').length")
        if after_view2 == 3:
            ok("切回学生视角后分组按钮仍为 3 个")
        else:
            bad(f"切回后分组按钮数量 = {after_view2}(期望 3)")

        # 改行列也应保留
        await page.evaluate("""() => {
            const el = document.getElementById('rowsInput');
            el.value = '6';
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
        }""")
        await page.wait_for_timeout(700)
        after_rows = await page.evaluate(
            "document.querySelectorAll('#classroom .group-banner .group-mode-group-btn').length")
        if after_rows == 3:
            ok("改变行数后分组按钮仍为 3 个")
        else:
            bad(f"改行数后分组按钮数量 = {after_rows}(期望 3)")

        # ══ 场景 4:短按 = 分配(不删除) ══
        print("\n── 场景 4:短按分组按钮 = 分配,不删除 ──")
        await page.evaluate("""() => {
            const seat = document.querySelector('#classroom .seat[data-student]:not(.empty)');
            if (seat) seat.click();
        }""")
        await page.wait_for_timeout(200)
        await page.click("#classroom .group-banner .group-mode-group-btn")
        await page.wait_for_timeout(400)
        state_after_click = await page.evaluate(
            "document.querySelectorAll('#classroom .group-banner .group-mode-group-btn').length")
        if state_after_click == 3:
            ok("短按后分组未被删除(仍 3 个)")
        else:
            bad(f"短按误删分组,剩余 {state_after_click}")

        # ══ 场景 5:鼠标长按 = 删除分组 ══
        print("\n── 场景 5:鼠标长按 600ms 删除分组 ──")
        first_name = await page.evaluate(
            "document.querySelector('#classroom .group-banner .group-mode-group-btn').textContent")
        box = await page.evaluate("""() => {
            const b = document.querySelector('#classroom .group-banner .group-mode-group-btn')
                .getBoundingClientRect();
            return {x: b.x + b.width/2, y: b.y + b.height/2};
        }""")
        await page.mouse.move(box["x"], box["y"])
        await page.mouse.down()
        await page.wait_for_timeout(280)
        pressing = await page.evaluate(
            "!!document.querySelector('.group-mode-group-btn.long-pressing')")
        if pressing:
            ok("长按开始后出现进度反馈 .long-pressing")
        else:
            bad("长按期间未出现 .long-pressing 反馈")
        await page.wait_for_timeout(500)
        await page.mouse.up()
        await page.wait_for_timeout(500)
        remaining = await page.evaluate(
            "document.querySelectorAll('#classroom .group-banner .group-mode-group-btn').length")
        names = await page.evaluate(
            "Array.from(document.querySelectorAll('#classroom .group-banner .group-mode-group-btn')).map(b=>b.textContent)")
        if remaining == 2 and first_name not in names:
            ok(f"鼠标长按删除成功:「{first_name}」已移除,剩余 {names}")
        else:
            bad(f"长按删除失败: 剩余 {remaining} / {names}")

        # ══ 场景 6:撤销恢复 ══
        print("\n── 场景 6:撤销恢复被删分组 ──")
        await page.click("#undoBtn")
        await page.wait_for_timeout(500)
        restored = await page.evaluate(
            "document.querySelectorAll('#classroom .group-banner .group-mode-group-btn').length")
        if restored == 3:
            ok("撤销后分组恢复为 3 个")
        else:
            bad(f"撤销后分组数 = {restored}(期望 3)")

        # ══ 场景 7:触摸(pointerType=touch)长按同样删除 ══
        print("\n── 场景 7:触摸长按删除 ──")
        tname = await page.evaluate(
            "document.querySelector('#classroom .group-banner .group-mode-group-btn').textContent")
        await page.evaluate("""() => {
            const btn = document.querySelector('#classroom .group-banner .group-mode-group-btn');
            const b = btn.getBoundingClientRect();
            const x = b.x + b.width/2, y = b.y + b.height/2;
            btn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, cancelable:true, pointerType:'touch', clientX:x, clientY:y}));
        }""")
        await page.wait_for_timeout(800)
        await page.evaluate("""() => {
            const btn = document.querySelector('#classroom .group-banner .group-mode-group-btn');
            if (btn) btn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, cancelable:true, pointerType:'touch'}));
        }""")
        await page.wait_for_timeout(500)
        tnames = await page.evaluate(
            "Array.from(document.querySelectorAll('#classroom .group-banner .group-mode-group-btn')).map(b=>b.textContent)")
        if len(tnames) == 2 and tname not in tnames:
            ok(f"触摸长按删除成功:「{tname}」已移除")
        else:
            bad(f"触摸长按删除失败: {tnames}")

        # ══ 场景 8:长按后滑动 = 取消,不删除 ══
        print("\n── 场景 8:长按中滑动取消 ──")
        before_move = await page.evaluate(
            "document.querySelectorAll('#classroom .group-banner .group-mode-group-btn').length")
        box2 = await page.evaluate("""() => {
            const b = document.querySelector('#classroom .group-banner .group-mode-group-btn')
                .getBoundingClientRect();
            return {x: b.x + b.width/2, y: b.y + b.height/2};
        }""")
        await page.mouse.move(box2["x"], box2["y"])
        await page.mouse.down()
        await page.wait_for_timeout(200)
        await page.mouse.move(box2["x"] + 60, box2["y"] + 60)   # 超出容差
        await page.wait_for_timeout(600)
        await page.mouse.up()
        await page.wait_for_timeout(300)
        after_move = await page.evaluate(
            "document.querySelectorAll('#classroom .group-banner .group-mode-group-btn').length")
        if after_move == before_move:
            ok("长按中滑动已取消删除")
        else:
            bad(f"滑动未取消: {before_move} → {after_move}")

        # ══ 场景 9:签到 banner 仍为单行样式且不报错 ══
        print("\n── 场景 9:签到 banner 未受影响 ──")
        await page.click("#modeSwitchBtn")   # 分组 → 普通
        await page.wait_for_timeout(300)
        await page.click("#modeSwitchBtn")   # 普通 → 签到
        await page.wait_for_timeout(500)
        cb = await page.evaluate("""() => {
            const b = document.querySelector('#classroom .checkin-banner');
            if (!b) return null;
            return {
                visible: b.classList.contains('visible'),
                btns: b.querySelectorAll('.mode-banner-btn').length,
                hasClose: !!b.querySelector('.mode-banner-close')
            };
        }""")
        if cb and cb["visible"] and cb["btns"] == 2 and cb["hasClose"]:
            ok("签到 banner 正常(2 操作按钮 + 关闭)")
        else:
            bad(f"签到 banner 异常: {cb}")

        # ══ 场景 10:无 JS 报错 ══
        print("\n── 场景 10:控制台无报错 ──")
        if not errors:
            ok("无 pageerror")
        else:
            bad(f"JS 报错: {errors[:3]}")

        await browser.close()

    print(f"\n{'='*46}\n通过 {passed} / 失败 {failed}\n{'='*46}")
    if failed:
        raise SystemExit(1)


asyncio.run(main())
