# -*- coding: utf-8 -*-
"""
批次13 — 智能排座分段按钮 + 小组轮换开关/步长 + 分组轮换规则

场景:
 1. 下拉含三个开关(男女同桌/男女不同桌/小组轮换)与配对设置,徽标默认 +1,
    步长行初始隐藏,两个性别开关默认全关
 2. 性别开关互斥:开 mixed ⇒ samegender 关;开 samegender ⇒ mixed 关;再点全关
 3. 分组不足 2 个 → 模块 rotateGroupSeats 提示且座位不变
 4. 3 组等人数 +1 轮换 → 每组学生落到下一组座位区,占座总数不变
 5. 步长 UI:开「小组轮换」⇒ 步长行出现;+ ⇒ 徽标 +2 且持久化;−/+ 边界禁用;
    关开关 ⇒ 步长行隐藏
 6. 步长 +2 轮换结果正确(跨一组)
 7. 人数不等 → 按 min 轮换,溢出学生改归上游组,总数仍不变
 8. 分组名/配色轮换前后不变
 9. 撤销可恢复轮换前布局
10. 步长持久化(刷新后仍为 +2)
11. UI 端到端:开「小组轮换」+ 点上段「智能排座」⇒ 先排座再轮换,溢出改归上游组
12. 无 JS 报错
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


CONFIG_JS = """(cfg) => {
    localStorage.setItem('classroomConfig', JSON.stringify(cfg));
}"""


async def inject(page, sizes, offset=1, rows=5, cols=6):
    """按每组人数构造分组 + 学生,并按组连续入座"""
    await page.evaluate(
        """({sizes, offset, rows, cols}) => {
            const groups = sizes.map((n, i) => ({
                id: 'g' + (i + 1),
                name: '第' + (i + 1) + '组',
                color: ['#FF9F9F', '#9FCFFF', '#9FFFBE', '#FFE08A', '#DDA0DD'][i]
            }));
            const students = [];
            let k = 0;
            sizes.forEach((n, i) => {
                for (let j = 0; j < n; j++) {
                    k++;
                    students.push({
                        id: 's' + k, name: '学生' + k,
                        groupId: groups[i].id, tags: [],
                        checkedIn: false, gender: k % 2 ? 'male' : 'female'
                    });
                }
            });
            const seats = Array(rows * cols).fill(null);
            for (let i = 0; i < students.length; i++) seats[i] = students[i].id;
            localStorage.setItem('classroomConfig', JSON.stringify({
                title: '轮换测试', rows, cols, seats, students, groups,
                viewMode: 'student', aisles: [], showStudentIcons: true,
                forcedPairs: [], avoidPairs: [], isCheckinMode: false,
                isGroupMode: false, groupRotateOffset: offset, version: '1.3.1'
            }));
        }""",
        {"sizes": sizes, "offset": offset, "rows": rows, "cols": cols},
    )
    await page.reload()
    await page.wait_for_timeout(700)


async def snapshot(page):
    """读取 {座位、学生分组、分组元信息}"""
    return await page.evaluate(
        """async () => {
            const { state } = await import('./modules/state.js');
            return {
                seats: state.seats.slice(),
                groups: JSON.parse(JSON.stringify(state.groups)),
                groupOf: Object.fromEntries(state.students.map(s => [s.id, s.groupId]))
            };
        }"""
    )


async def rotate(page, offset):
    """通过本地测试钩子驱动应用内真实实例(带撤销/UI 回调)"""
    return await page.evaluate(
        """async (offset) => {
            if (!window.__seatsTest) throw new Error('测试钩子 __seatsTest 未暴露');
            return window.__seatsTest.rotateGroupSeats(offset) || {};
        }""",
        offset,
    )


async def switch_state(page):
    return await page.evaluate(
        """() => ({
            mixed: document.querySelector('#randomDropdown [data-toggle="mixed"]')?.getAttribute('aria-checked'),
            samegender: document.querySelector('#randomDropdown [data-toggle="samegender"]')?.getAttribute('aria-checked'),
            rotate: document.querySelector('#randomDropdown [data-toggle="rotate"]')?.getAttribute('aria-checked'),
            stepRow: document.getElementById('rotateStepRow')?.style.display || '',
            badge: document.getElementById('rotateOffsetBadge')?.textContent
        })"""
    )


async def main():
    global PASSED, FAILED
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        dialogs = []

        async def on_dialog(d):
            dialogs.append({"type": d.type, "message": d.message})
            await d.accept()

        page.on("dialog", on_dialog)

        await page.goto(BASE)
        await page.wait_for_timeout(800)

        # ── 场景 1:下拉结构 ──
        print("\n── 场景 1:下拉含三开关 + 配对设置,默认状态 ──")
        await inject(page, [3, 3, 3])
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(300)
        st = await switch_state(page)
        check(st["mixed"] == "false" and st["samegender"] == "false",
              f"两个性别开关默认全关(实际 {st['mixed']}/{st['samegender']})")
        check(st["rotate"] == "false", f"小组轮换默认关(实际 {st['rotate']})")
        check(st["badge"] == "+1", f"默认徽标 +1(实际 {st['badge']!r})")
        check(st["stepRow"] == "none", f"步长行初始隐藏(实际 {st['stepRow']!r})")
        has_pair = await page.evaluate(
            "!!document.querySelector('#randomDropdown [data-action=\\'pairSettings\\']')"
        )
        check(has_pair, "下拉含「配对设置」入口")
        # 下拉在开关点击后应保持打开
        await page.click("#randomDropdown [data-toggle='mixed']")
        await page.wait_for_timeout(200)
        dd_open = await page.evaluate(
            "document.getElementById('randomDropdown').style.display"
        )
        check(dd_open == "block", f"点开关不关闭下拉(实际 {dd_open!r})")

        # ── 场景 2:性别开关互斥 ──
        print("\n── 场景 2:性别开关互斥 ──")
        st = await switch_state(page)
        check(st["mixed"] == "true" and st["samegender"] == "false",
              f"开 mixed ⇒ samegender 保持关(实际 {st['mixed']}/{st['samegender']})")
        await page.click("#randomDropdown [data-toggle='samegender']")
        await page.wait_for_timeout(200)
        st = await switch_state(page)
        check(st["samegender"] == "true" and st["mixed"] == "false",
              f"开 samegender ⇒ mixed 自动关(实际 {st['samegender']}/{st['mixed']})")
        await page.click("#randomDropdown [data-toggle='samegender']")
        await page.wait_for_timeout(200)
        st = await switch_state(page)
        check(st["mixed"] == "false" and st["samegender"] == "false",
              f"再点 samegender ⇒ 两个全关(实际 {st['mixed']}/{st['samegender']})")
        await page.keyboard.press("Escape")
        await page.click("body")
        await page.wait_for_timeout(200)

        # ── 场景 3:分组不足 2 个 ──
        print("\n── 场景 3:分组不足 2 个时提示 ──")
        await inject(page, [4])
        dialogs.clear()
        before = await snapshot(page)
        await rotate(page, 1)
        await page.wait_for_timeout(400)
        after = await snapshot(page)
        check(
            any("至少 2 个分组" in d["message"] for d in dialogs),
            f"应弹出「至少 2 个分组」提示(实际 {[d['message'] for d in dialogs]})",
        )
        check(before["seats"] == after["seats"], "座位未被改动")

        # ── 场景 4:3 组等人数 +1 轮换 ──
        print("\n── 场景 4:3 组各 3 人 +1 轮换 ──")
        await inject(page, [3, 3, 3])
        before = await snapshot(page)
        dialogs.clear()
        await rotate(page, 1)
        await page.wait_for_timeout(600)
        after = await snapshot(page)
        check(
            any("轮换到往下第 1 组" in d["message"] for d in dialogs),
            f"确认框显示步长 +1(实际 {[d['message'] for d in dialogs]})",
        )
        b_placed = len([s for s in before["seats"] if s])
        a_placed = len([s for s in after["seats"] if s])
        check(b_placed == a_placed == 9, f"占座总数不变({b_placed} → {a_placed})")

        # 座位区 → 组内成员:第 i 组学生应落在原本第 (i+1)%3 组的座位区
        def region(idx):
            return idx // 3  # 0..2 分别为 g1/g2/g3 区(9 人连续入座)

        expect = {"g1": 1, "g2": 2, "g3": 0}  # gid → 应落入的区号
        misplaced = []
        for idx, sid in enumerate(after["seats"]):
            if not sid:
                continue
            gid = after["groupOf"][sid]
            if region(idx) != expect[gid]:
                misplaced.append((sid, gid, idx))
        check(not misplaced, f"每组学生落到下一组座位区(错位 {misplaced})")

        # ── 场景 5:步长 UI ──
        print("\n── 场景 5:开关控制步长行 + 步长边界 ──")
        await inject(page, [3, 3, 3])
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(300)
        await page.click("#randomDropdown [data-toggle='rotate']")
        await page.wait_for_timeout(250)
        st = await switch_state(page)
        check(st["rotate"] == "true" and st["stepRow"] != "none",
              f"开小组轮换 ⇒ 步长行出现(实际 {st['rotate']}/{st['stepRow']!r})")
        # 边界:offset=1 时 − 禁用、+ 可用
        btns = await page.evaluate(
            """() => ({
                minus: document.getElementById('rotateStepMinus').disabled,
                plus: document.getElementById('rotateStepPlus').disabled
            })"""
        )
        check(btns["minus"] is True and btns["plus"] is False,
              f"offset=1 ⇒ − 禁用 + 可用(实际 {btns})")
        await page.click("#rotateStepPlus")
        await page.wait_for_timeout(800)  # autoSave 防抖 500ms
        st = await switch_state(page)
        check(st["badge"] == "+2", f"+ ⇒ 徽标 +2(实际 {st['badge']!r})")
        btns = await page.evaluate(
            """() => ({
                minus: document.getElementById('rotateStepMinus').disabled,
                plus: document.getElementById('rotateStepPlus').disabled
            })"""
        )
        # 3 组时最大步长 2 ⇒ + 禁用
        check(btns["plus"] is True and btns["minus"] is False,
              f"offset=2(3 组上限)⇒ + 禁用 − 可用(实际 {btns})")
        saved = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('classroomConfig')).groupRotateOffset"
        )
        check(saved == 2, f"步长即时持久化 groupRotateOffset=2(实际 {saved!r})")
        rot_saved = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('classroomConfig')).smartArrangeRotate"
        )
        check(rot_saved is True, f"开关状态持久化 smartArrangeRotate=true(实际 {rot_saved!r})")
        await page.click("#rotateStepMinus")
        await page.wait_for_timeout(250)
        st = await switch_state(page)
        check(st["badge"] == "+1", f"− ⇒ 徽标回到 +1(实际 {st['badge']!r})")
        await page.click("#randomDropdown [data-toggle='rotate']")
        await page.wait_for_timeout(250)
        st = await switch_state(page)
        check(st["rotate"] == "false" and st["stepRow"] == "none",
              f"关小组轮换 ⇒ 步长行隐藏(实际 {st['rotate']}/{st['stepRow']!r})")
        await page.keyboard.press("Escape")
        await page.click("body")
        await page.wait_for_timeout(200)

        # ── 场景 6:步长 +2 实际轮换 ──
        print("\n── 场景 6:步长 +2 执行轮换 ──")
        await inject(page, [3, 3, 3])
        before = await snapshot(page)
        dialogs.clear()
        await rotate(page, 2)
        await page.wait_for_timeout(600)
        after = await snapshot(page)
        check(
            any("轮换到往下第 2 组" in d["message"] for d in dialogs),
            f"确认框显示步长 +2(实际 {[d['message'] for d in dialogs]})",
        )
        expect2 = {"g1": 2, "g2": 0, "g3": 1}
        misplaced2 = []
        for idx, sid in enumerate(after["seats"]):
            if not sid:
                continue
            gid = after["groupOf"][sid]
            if region(idx) != expect2[gid]:
                misplaced2.append((sid, gid, idx))
        check(not misplaced2, f"+2 轮换落区正确(错位 {misplaced2})")

        # ── 场景 7:人数不等 ──
        print("\n── 场景 7:人数不等按 min 轮换,溢出改归上游组 ──")
        await inject(page, [5, 3, 3], offset=1)
        before = await snapshot(page)
        await rotate(page, 1)
        await page.wait_for_timeout(600)
        after = await snapshot(page)
        b_placed = len([s for s in before["seats"] if s])
        a_placed = len([s for s in after["seats"] if s])
        check(a_placed == b_placed == 11, f"占座总数不变({b_placed} → {a_placed})")

        def region7(idx):
            if idx < 5:
                return "g1"
            if idx < 8:
                return "g2"
            if idx < 11:
                return "g3"
            return None

        counts = {"g1": {}, "g2": {}, "g3": {}}
        for idx, sid in enumerate(after["seats"]):
            r = region7(idx)
            if not sid or not r:
                continue
            gid = after["groupOf"][sid]
            counts[r][gid] = counts[r].get(gid, 0) + 1
        check(counts["g2"] == {"g1": 3}, f"B 区(3 座)坐 3 名 A 组(实际 {counts['g2']})")
        check(counts["g3"] == {"g2": 3}, f"C 区(3 座)坐 3 名 B 组(实际 {counts['g3']})")
        # 溢出规则:A 组挤不进 B 区的 2 人改归上游组(占了 A 座位的 C 组)
        check(
            counts["g1"].get("g3") == 5,
            f"A 区(5 座)= 5 名 C 组(3 名轮换 + 2 名溢出改归)(实际 {counts['g1']})",
        )

        # ── 场景 8:分组名/配色不变 ──
        print("\n── 场景 8:分组元信息不变 ──")
        check(
            before["groups"] == after["groups"],
            "分组 id/name/color 轮换前后完全一致",
        )

        # ── 场景 9:撤销恢复 ──
        print("\n── 场景 9:撤销恢复轮换前布局 ──")
        await page.click("#undoBtn")
        await page.wait_for_timeout(600)
        undone = await snapshot(page)
        check(undone["seats"] == before["seats"], "撤销后座位回到轮换前")

        # ── 场景 10:步长持久化 ──
        print("\n── 场景 10:步长持久化(刷新) ──")
        await inject(page, [3, 3, 3], offset=2)
        await page.reload()
        await page.wait_for_timeout(700)
        persisted = await page.evaluate(
            "() => document.getElementById('rotateOffsetBadge').textContent"
        )
        check(persisted == "+2", f"刷新后徽标仍为 +2(实际 {persisted!r})")
        saved = await page.evaluate(
            """() => JSON.parse(localStorage.getItem('classroomConfig')).groupRotateOffset"""
        )
        check(saved == 2, f"localStorage 保存 groupRotateOffset=2(实际 {saved!r})")

        # ── 场景 11:UI 端到端:智能排座 + 小组轮换 ──
        print("\n── 场景 11:上段按钮 = 随机排座 + 轮换(溢出改归) ──")
        await inject(page, [6, 3, 3])
        dialogs.clear()
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(300)
        await page.click("#randomDropdown [data-toggle='rotate']")
        await page.wait_for_timeout(200)
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(1500)
        res = await page.evaluate(
            """async () => {
                const { state } = await import('./modules/state.js');
                const c = {};
                state.students.forEach(s => { c[s.groupId] = (c[s.groupId] || 0) + 1; });
                return { counts: c, seated: state.seats.filter(Boolean).length };
            }"""
        )
        # 开启小组轮换后,打底排座不再弹「完全随机」确认(只留轮换确认)
        check(
            not any("随机" in d["message"] for d in dialogs)
            and any("轮换" in d["message"] for d in dialogs),
            f"只弹轮换确认、不再弹「完全随机」确认(实际 {[d['message'] for d in dialogs]})",
        )
        check(res["seated"] == 12, f"排座+轮换后占座总数 12(实际 {res['seated']})")
        check(res["counts"] == {"g1": 3, "g2": 3, "g3": 6},
              f"第一组 6 人 → 第二组 3 座,3 人溢出改归上游组第三组 ⇒ 3/3/6"
              f"(实际 {res['counts']})")
        await page.keyboard.press("Escape")
        await page.click("body")
        await page.wait_for_timeout(200)

        # ── 场景 12:无 JS 报错 ──
        print("\n── 场景 12:控制台无报错 ──")
        check(not errors, f"无 pageerror(实际 {errors[:3]})")

        await browser.close()

    print("\n" + "=" * 46)
    print(f"通过 {PASSED} / 失败 {FAILED}")
    print("=" * 46)
    return 1 if FAILED else 0


raise SystemExit(asyncio.run(main()))
