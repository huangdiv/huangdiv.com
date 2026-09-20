# -*- coding: utf-8 -*-
"""批次14:分组模式 — 分组查看态 + 多选中统计栏 + 统计栏风格统一

覆盖:
  1. 进入分组模式 ⇒ 分组统计栏可见,初始「未选择 / 0 / —」
  2. 未选中学生时点击分组按钮 ⇒ 高亮该组全部成员(座位表 + 未入座名单),按钮 active
  3. 统计栏分组视图:当前分组 / 分组人数(可点菜单) / 即将轮换到
  4. 再点同一分组 ⇒ 取消查看
  5. 点击学生 ⇒ **不再**整组高亮;统计栏切到多选视图:当前学生/所属分组/已选人数
  6. 多选累计:连续点两名学生 ⇒ 已选人数累加,当前学生为最后点击的那位
  7. 点击「已选人数」⇒ 菜单(复制姓名/下载 Excel),标题「已选学生 · N 人」
  8. 有选中学生时点分组按钮 ⇒ 分配,并把查看态切到目标分组
  9. 轮换步长 +2 ⇒ 「即将轮换到」实时变成下下组
 10. 三项统计信息字号与其他模式一致
 11. 退出分组模式 ⇒ 恢复普通统计栏、高亮清空
 12. 触摸端同样可用
 13. 无 JS 报错
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


def build_config():
    cfg = {
        "title": "分组聚焦",
        "rows": 5,
        "cols": 6,
        "groups": [
            {"id": "g1", "name": "第一组", "color": "#FF9F9F"},
            {"id": "g2", "name": "第二组", "color": "#9FCFFF"},
            {"id": "g3", "name": "第三组", "color": "#9FFFBE"},
        ],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "isCheckinMode": False,
        "isGroupMode": False,
        "groupRotateOffset": 1,
        "version": "1.3.1",
    }
    students, seats = [], [None] * 30
    # 第1组 5 人: s1..s4 入座(0..3), s5 未入座
    for i in range(1, 6):
        students.append({"id": f"s{i}", "name": f"学生{i}", "groupId": "g1",
                         "tags": [], "checkedIn": False, "gender": "male" if i % 2 else "female"})
    for i in range(1, 5):
        seats[i - 1] = f"s{i}"
    # 第2组 3 人: s6..s8 入座(4..6)
    for i in range(6, 9):
        students.append({"id": f"s{i}", "name": f"学生{i}", "groupId": "g2",
                         "tags": [], "checkedIn": False, "gender": "male" if i % 2 else "female"})
    for i in range(6, 9):
        seats[i - 6 + 4] = f"s{i}"
    # 第3组 2 人: s9..s10 入座(7..8)
    for i in range(9, 11):
        students.append({"id": f"s{i}", "name": f"学生{i}", "groupId": "g3",
                         "tags": [], "checkedIn": False, "gender": "male" if i % 2 else "female"})
    for i in range(9, 11):
        seats[i - 9 + 7] = f"s{i}"
    cfg["students"] = students
    cfg["seats"] = seats
    return json.dumps(cfg, ensure_ascii=False)


STATS_JS = """() => ({
    v1: document.getElementById('groupStatVal1').textContent,
    l1: document.getElementById('groupStatLabel1').textContent,
    v2: document.getElementById('groupStatVal2').textContent,
    l2: document.getElementById('groupStatLabel2').textContent,
    v3: document.getElementById('groupStatVal3').textContent,
    l3: document.getElementById('groupStatLabel3').textContent,
    clickable: Array.from(document.querySelectorAll('#groupStatsRow .stat-block[data-stat]'))
        .map(b => b.getAttribute('data-stat'))
})"""


async def main():
    global passed, failed
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1440, "height": 1000})
        await ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        async def on_dialog(d):
            await d.accept()

        page.on("dialog", on_dialog)

        await page.goto(BASE)
        await page.wait_for_timeout(800)
        await page.evaluate("(cfg)=>localStorage.setItem('classroomConfig',cfg)", build_config())
        await page.reload()
        await page.wait_for_timeout(900)

        # ── 进入分组模式(普通 → 签到 → 分组) ──
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(300)
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(600)

        rows = await page.evaluate("""() => ({
            normal: getComputedStyle(document.getElementById('normalStatsRow')).display,
            group: getComputedStyle(document.getElementById('groupStatsRow')).display
        })""")
        check(rows["group"] == "flex" and rows["normal"] == "none",
              f"进入分组模式 ⇒ 分组统计栏可见、普通行隐藏(实际 {rows})")

        s0 = await page.evaluate(STATS_JS)
        check(s0["l1"] == "当前分组" and s0["v1"] == "未选择"
              and s0["l2"] == "分组人数" and s0["v2"] == "0"
              and s0["l3"] == "即将轮换到" and s0["v3"] == "—",
              f"初始统计栏「未选择 / 0 / —」(实际 {s0['v1']}/{s0['v2']}/{s0['v3']})")
        check(s0["clickable"] == [], f"未选择时无人数字段可点(实际 {s0['clickable']})")

        # ── 场景 1: 未选中学生时点击「第一组」按钮 ⇒ 查看该组 ──
        await page.click(".group-mode-group-btn[data-group-id='g1']")
        await page.wait_for_timeout(400)
        st = await page.evaluate(STATS_JS)
        check(st["v1"] == "第一组" and st["l1"] == "当前分组", f"统计栏显示组名(实际 {st['v1']})")
        check(st["v2"] == "5" and st["l2"] == "分组人数", f"统计栏显示分组人数 5(实际 {st['v2']})")
        check(st["v3"] == "第二组" and st["l3"] == "即将轮换到",
              f"统计栏显示即将轮换到「第二组」(实际 {st['v3']})")
        check(st["clickable"] == ["groupMembers"], f"仅「分组人数」可点(实际 {st['clickable']})")

        hi = await page.evaluate("""() => ({
            active: Array.from(document.querySelectorAll('.group-mode-group-btn.active')).map(b => b.getAttribute('data-group-id')),
            seatHi: document.querySelectorAll('#classroom .seat.group-highlight').length,
            listHi: Array.from(document.querySelectorAll('#studentList .student-item.group-highlight')).map(e => e.getAttribute('data-student'))
        })""")
        check(hi["active"] == ["g1"], f"第一组按钮 active(实际 {hi['active']})")
        check(hi["seatHi"] == 4, f"座位表中 4 名第一组成员高亮(实际 {hi['seatHi']})")
        check(hi["listHi"] == ["s5"], f"未入座名单中 s5 高亮(实际 {hi['listHi']})")

        # 点击「分组人数」⇒ 菜单
        await page.click("#groupStatsRow .stat-block[data-stat='groupMembers']")
        await page.wait_for_timeout(350)
        menu = await page.evaluate("""() => {
            const m = document.querySelector('.stat-action-menu');
            if (!m || !m.classList.contains('visible')) return null;
            return { header: document.getElementById('statActionHeader').textContent,
                     items: Array.from(m.querySelectorAll('.stat-action-menu-item')).map(b => b.textContent.trim()) };
        }""")
        check(menu is not None, "点击分组人数弹出下拉菜单")
        if menu:
            check("第一组" in menu["header"] and "5 人" in menu["header"],
                  f"菜单标题「第一组 · 5 人」(实际 {menu['header']!r})")
            check(any("复制姓名" in i for i in menu["items"]) and any("Excel" in i for i in menu["items"]),
                  f"菜单含复制姓名/下载 Excel(实际 {menu['items']})")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        # ── 场景 2: 再点同一分组 ⇒ 取消查看 ──
        await page.click(".group-mode-group-btn[data-group-id='g1']")
        await page.wait_for_timeout(400)
        st2 = await page.evaluate(STATS_JS)
        hi2 = await page.evaluate("""() => ({
            seatHi: document.querySelectorAll('#classroom .seat.group-highlight').length,
            listHi: document.querySelectorAll('#studentList .student-item.group-highlight').length,
            active: document.querySelectorAll('.group-mode-group-btn.active').length
        })""")
        check(st2["v1"] == "未选择" and hi2["seatHi"] == 0
              and hi2["listHi"] == 0 and hi2["active"] == 0,
              f"再点同一分组 ⇒ 取消查看(实际 {st2['v1']} / {hi2})")

        # ── 场景 3: 点击学生 ⇒ 不再整组高亮,统计栏切多选视图 ──
        await page.evaluate("""() => document.querySelector('.seat[data-student="s6"]').click()""")
        await page.wait_for_timeout(400)
        st3 = await page.evaluate(STATS_JS)
        hi3 = await page.evaluate("""() => ({
            groupHi: document.querySelectorAll('.group-highlight').length,
            active: document.querySelectorAll('.group-mode-group-btn.active').length,
            selected: document.querySelectorAll('#classroom .seat.group-selected').length
        })""")
        check(st3["l1"] == "当前学生" and st3["v1"] == "学生6",
              f"统计栏第 1 项为「当前学生 = 学生6」(实际 {st3['l1']}={st3['v1']})")
        check(st3["l2"] == "所属分组" and st3["v2"] == "第二组",
              f"统计栏第 2 项为「所属分组 = 第二组」(实际 {st3['l2']}={st3['v2']})")
        check(st3["l3"] == "已选人数" and st3["v3"] == "1",
              f"统计栏第 3 项为「已选人数 = 1」(实际 {st3['l3']}={st3['v3']})")
        check(st3["clickable"] == ["groupSelected"], f"仅「已选人数」可点(实际 {st3['clickable']})")
        check(hi3["groupHi"] == 0 and hi3["active"] == 0,
              f"点击学生不再整组高亮(实际 group-highlight={hi3['groupHi']}, active={hi3['active']})")
        check(hi3["selected"] == 1, f"该生保留多选高亮 group-selected(实际 {hi3['selected']})")

        # ── 场景 4: 再选一名学生 ⇒ 已选人数累加,当前学生更新 ──
        await page.evaluate("""() => document.querySelector('.seat[data-student="s1"]').click()""")
        await page.wait_for_timeout(400)
        st4 = await page.evaluate(STATS_JS)
        check(st4["v1"] == "学生1" and st4["v2"] == "第一组" and st4["v3"] == "2",
              f"多选两名 ⇒ 学生1 / 第一组 / 2(实际 {st4['v1']}/{st4['v2']}/{st4['v3']})")

        # ── 场景 5: 点击「已选人数」⇒ 菜单列出已选学生 ──
        await page.click("#groupStatsRow .stat-block[data-stat='groupSelected']")
        await page.wait_for_timeout(350)
        menu2 = await page.evaluate("""() => {
            const m = document.querySelector('.stat-action-menu');
            if (!m || !m.classList.contains('visible')) return null;
            return document.getElementById('statActionHeader').textContent;
        }""")
        check(menu2 is not None and "已选学生" in (menu2 or "") and "2 人" in (menu2 or ""),
              f"已选人数菜单标题「已选学生 · 2 人」(实际 {menu2!r})")
        if menu2:
            await page.click(".stat-action-menu-item[data-action='copy']")
            await page.wait_for_timeout(400)
            clip = await page.evaluate("() => navigator.clipboard.readText()")
            check("学生6" in clip and "学生1" in clip,
                  f"复制内容含两名已选学生(实际 {clip!r})")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        # ── 场景 6: 有选中学生时点分组按钮 ⇒ 分配,并切到目标分组查看 ──
        await page.click(".group-mode-group-btn[data-group-id='g3']")
        await page.wait_for_timeout(700)
        st5 = await page.evaluate(STATS_JS)
        moved = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            return {
                s1: m.state.students.find(s => s.id === 's1').groupId,
                s6: m.state.students.find(s => s.id === 's6').groupId,
                selected: document.querySelectorAll('#classroom .seat.group-selected').length
            };
        }""")
        check(moved["s1"] == "g3" and moved["s6"] == "g3",
              f"有选中学生时点分组按钮 ⇒ 分配到该组(实际 {moved})")
        check(moved["selected"] == 0, "分配后多选清空")
        check(st5["l1"] == "当前分组" and st5["v1"] == "第三组" and st5["v2"] == "4",
              f"分配后查看目标分组(实际 {st5['l1']}/{st5['v1']}/{st5['v2']})")

        # ── 场景 7: 步长 +2 ⇒ 「即将轮换到」实时联动 ──
        await page.click(".group-mode-group-btn[data-group-id='g1']")
        await page.wait_for_timeout(300)
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        await page.click("#randomDropdown [data-toggle='rotate']")
        await page.wait_for_timeout(250)
        await page.click("#rotateStepPlus")
        await page.wait_for_timeout(400)
        st6 = await page.evaluate(STATS_JS)
        # 场景 6 已把 s1 分配到第三组,故此处第一组剩 s2/s3/s4/s5 = 4 人
        check(st6["v1"] == "第一组" and st6["v2"] == "4" and st6["v3"] == "第三组",
              f"步长 +2 ⇒ 第一组(4 人)即将轮换到「第三组」(实际 {st6['v1']}/{st6['v2']}/{st6['v3']})")

        # ── 场景 8: 统计栏三项字号与其他模式一致 ──
        fonts = await page.evaluate("""() => {
            const g = Array.from(document.querySelectorAll('#groupStatsRow .stat-num'))
                .map(e => getComputedStyle(e).fontSize);
            const n = Array.from(document.querySelectorAll('#normalStatsRow .stat-num'))
                .map(e => getComputedStyle(e).fontSize);
            const widths = Array.from(document.querySelectorAll('#groupStatsRow .stat-block'))
                .map(e => Math.round(e.getBoundingClientRect().width));
            return { g: g, n: n, widths: widths };
        }""")
        check(len(set(fonts["g"])) == 1 and fonts["g"][0] == fonts["n"][0],
              f"三项字号一致且与普通模式相同(实际 分组{fonts['g']} / 普通{fonts['n']})")
        check(len(set(fonts["widths"])) == 1, f"三项等宽(实际 {fonts['widths']})")

        # ── 场景 9: 退出分组模式 ──
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(600)
        fin = await page.evaluate("""() => ({
            normal: getComputedStyle(document.getElementById('normalStatsRow')).display,
            group: getComputedStyle(document.getElementById('groupStatsRow')).display,
            groupHi: document.querySelectorAll('.group-highlight').length,
            selected: document.querySelectorAll('.seat.group-selected').length,
            banner: !!document.querySelector('#classroom .group-banner')
        })""")
        check(fin["normal"] == "flex" and fin["group"] == "none",
              f"退出后恢复普通统计栏(实际 {fin})")
        check(fin["groupHi"] == 0 and fin["selected"] == 0 and not fin["banner"],
              "退出后高亮/多选/banner 全部清除")

        check(len(errors) == 0, f"无 JS 报错(实际 {errors[:3]})")

        # ── 场景 10: 触摸端 ──
        tctx = await browser.new_context(viewport={"width": 900, "height": 1000}, has_touch=True)
        tpage = await tctx.new_page()
        terrors = []
        tpage.on("pageerror", lambda e: terrors.append(str(e)))
        tpage.on("dialog", on_dialog)
        await tpage.goto(BASE)
        await tpage.wait_for_timeout(700)
        await tpage.evaluate("(cfg)=>localStorage.setItem('classroomConfig',cfg)", build_config())
        await tpage.reload()
        await tpage.wait_for_timeout(800)
        await tpage.tap("#modeSwitchBtn")
        await tpage.wait_for_timeout(300)
        await tpage.tap("#modeSwitchBtn")
        await tpage.wait_for_timeout(600)
        await tpage.tap(".group-mode-group-btn[data-group-id='g2']")
        await tpage.wait_for_timeout(400)
        tst = await tpage.evaluate(STATS_JS)
        thi = await tpage.evaluate("""() => ({
            seatHi: document.querySelectorAll('#classroom .seat.group-highlight').length,
            active: document.querySelectorAll('.group-mode-group-btn.active').length
        })""")
        check(tst["v1"] == "第二组" and tst["v2"] == "3" and tst["v3"] == "第三组"
              and thi["seatHi"] == 3 and thi["active"] == 1,
              f"触摸点击分组按钮 ⇒ 查看该组(实际 {tst['v1']}/{tst['v2']}/{tst['v3']} / {thi})")
        check(len(terrors) == 0, f"触摸端无 JS 报错(实际 {terrors[:2]})")

        await browser.close()

    print(f"\n{'='*46}\n通过 {passed} 项,失败 {failed} 项\n{'='*46}")
    return 1 if failed else 0


raise SystemExit(asyncio.run(main()))
