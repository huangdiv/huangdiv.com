# -*- coding: utf-8 -*-
"""批次15:配对设置满足 + 多选能力迁移 + 轮换溢出改归

覆盖:
  1. 分组模式多选时 banner 出现「取消选择」,点击一键清空
  2. 普通模式可多选学生(座位点击),统计栏切三槽「当前学生/所属分组/已选人数」
  3. 普通模式点空白区域(空白座位 / 讲台)自动取消选择
  4. 配对设置弹窗按满足情况着色:ok 绿 / bad 橙红 / na 灰
  5. 座位变化后弹窗内配对状态实时刷新
  6. 随机排座后强制配对必定同桌、回避配对必定分开
  7. 分组轮换:源组人数 > 目标组座位时,溢出学生改归上游组并提示
  8. 无 JS 报错
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


def base_cfg(**over):
    cfg = {
        "title": "批次15",
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
    cfg.update(over)
    return json.dumps(cfg, ensure_ascii=False)


def mk_students(n, group_of=None):
    """生成 s1..sn;group_of(i) 返回该学生的 groupId(1-based 序号)"""
    out = []
    for i in range(1, n + 1):
        gid = group_of(i) if group_of else None
        out.append({
            "id": f"s{i}", "name": f"学生{i}", "groupId": gid,
            "tags": [], "checkedIn": False,
            "gender": "male" if i % 2 else "female",
        })
    return out


# ── 场景 A/B/C 的配置:5×6=30 座,16 名学生占 0..15(恰好 8 张同桌) ──
#   s15 / s16 不入座(用于 na 状态)
def cfg_multiselect():
    students = mk_students(16)
    for i in range(1, 15):
        students[i - 1]["groupId"] = "g1" if i <= 5 else ("g2" if i <= 10 else "g3")
    seats = [None] * 30
    for i in range(1, 15):
        seats[i - 1] = f"s{i}"
    return base_cfg(students=students, seats=seats)


# ── 场景 D 的配置:带强制/回避配对 ──
def cfg_pairs():
    students = mk_students(16)
    seats = [None] * 30
    for i in range(1, 17):
        seats[i - 1] = f"s{i}"
    return base_cfg(
        students=students, seats=seats,
        forcedPairs=[["s1", "s2"], ["s3", "s4"]],
        avoidPairs=[["s5", "s6"]],
    )


# ── 场景 E 的配置:第一组 6 人 / 第二组 3 人 / 第三组 3 人(溢出 3 人)──
def cfg_rotate():
    def g(i):
        if i <= 6:
            return "g1"
        if i <= 9:
            return "g2"
        return "g3"
    students = mk_students(12, g)
    seats = [None] * 30
    for i in range(1, 13):
        seats[i - 1] = f"s{i}"
    return base_cfg(students=students, seats=seats)


STATS_JS = """() => ({
    normal: getComputedStyle(document.getElementById('normalStatsRow')).display,
    group: getComputedStyle(document.getElementById('groupStatsRow')).display,
    l1: document.getElementById('groupStatLabel1').textContent,
    v1: document.getElementById('groupStatVal1').textContent,
    l2: document.getElementById('groupStatLabel2').textContent,
    v2: document.getElementById('groupStatVal2').textContent,
    l3: document.getElementById('groupStatLabel3').textContent,
    v3: document.getElementById('groupStatVal3').textContent
})"""

PAIR_CLASSES_JS = """() => ({
    forced: Array.from(document.querySelectorAll('.pair-forced-list .pair-item'))
        .map(e => (e.className.match(/pair-status-\\w+/) || [''])[0]),
    avoid: Array.from(document.querySelectorAll('.pair-avoid-list .pair-item'))
        .map(e => (e.className.match(/pair-status-\\w+/) || [''])[0])
})"""

# 依据当前 state.seats 计算每条配对的期望状态(与前端 getPairStatus 同逻辑)
EXPECT_PAIRS_JS = """async () => {
    const m = await import('./modules/state.js');
    const st = m.state;
    const cols = st.cols;
    const seatOf = {};
    st.seats.forEach((sid, idx) => { if (sid) seatOf[sid] = idx; });
    const mate = (idx) => {
        const r = Math.floor(idx / cols), c = idx % cols;
        if (c + 1 < cols) {
            const aisle = (st.aisles || []).find(a => a.afterCol === c + 1);
            if (!aisle) return idx + 1;
        }
        if (c - 1 >= 0) {
            const aisle = (st.aisles || []).find(a => a.afterCol === c);
            if (!aisle) return idx - 1;
        }
        return null;
    };
    const status = (p, kind) => {
        const a = seatOf[p[0]], b = seatOf[p[1]];
        if (a === undefined || b === undefined) return 'na';
        const together = mate(a) === b;
        return kind === 'forced' ? (together ? 'ok' : 'bad') : (together ? 'bad' : 'ok');
    };
    return {
        forced: st.forcedPairs.map(p => status(p, 'forced')),
        avoid: st.avoidPairs.map(p => status(p, 'avoid'))
    };
}"""


async def load(page, cfg):
    await page.evaluate("(c)=>localStorage.setItem('classroomConfig',c)", cfg)
    await page.reload()
    await page.wait_for_timeout(900)


async def main():
    global passed, failed
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1440, "height": 1000})
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        async def on_dialog(d):
            await d.accept()

        page.on("dialog", on_dialog)

        await page.goto(BASE)
        await page.wait_for_timeout(800)

        # ══════════ 场景 A:普通模式多选 + 统计栏 + 点空白取消 ══════════
        print("\n── 场景 A:普通模式多选学生 ──")
        await load(page, cfg_multiselect())

        sel = await page.evaluate("() => document.querySelectorAll('.seat.group-selected').length")
        check(sel == 0, f"初始无多选高亮(实际 {sel})")

        await page.evaluate("""() => document.querySelector('.seat[data-student="s1"]').click()""")
        await page.wait_for_timeout(300)
        st = await page.evaluate(STATS_JS)
        check(st["group"] == "flex" and st["normal"] == "none",
              f"普通模式选中学生 ⇒ 统计栏切到三槽行(实际 {st['group']}/{st['normal']})")
        check(st["l1"] == "当前学生" and st["v1"] == "学生1", f"第 1 项 = 当前学生 学生1(实际 {st['l1']}/{st['v1']})")
        check(st["l2"] == "所属分组" and st["v2"] == "第一组", f"第 2 项 = 所属分组 第一组(实际 {st['l2']}/{st['v2']})")
        check(st["l3"] == "已选人数" and st["v3"] == "1", f"第 3 项 = 已选人数 1(实际 {st['l3']}/{st['v3']})")

        await page.evaluate("""() => document.querySelector('.seat[data-student="s7"]').click()""")
        await page.wait_for_timeout(300)
        st = await page.evaluate(STATS_JS)
        sel = await page.evaluate("() => document.querySelectorAll('.seat.group-selected').length")
        check(st["v1"] == "学生7" and st["v3"] == "2", f"再选一人 ⇒ 当前学生/2(实际 {st['v1']}/{st['v3']})")
        check(sel == 2, f"两个座位带多选高亮(实际 {sel})")

        # 点空白座位 ⇒ 取消
        await page.evaluate("""() => document.querySelector('.seat[data-index="25"]').click()""")
        await page.wait_for_timeout(300)
        st = await page.evaluate(STATS_JS)
        sel = await page.evaluate("() => document.querySelectorAll('.seat.group-selected').length")
        check(sel == 0 and st["normal"] == "flex" and st["group"] == "none",
              f"点空白座位 ⇒ 取消选择并恢复普通统计栏(实际 sel={sel}, {st['normal']}/{st['group']})")

        # 点讲台(非座位空白区)⇒ 取消
        await page.evaluate("""() => document.querySelector('.seat[data-student="s2"]').click()""")
        await page.wait_for_timeout(250)
        sel = await page.evaluate("() => document.querySelectorAll('.seat.group-selected').length")
        check(sel == 1, f"重新选中 1 人(实际 {sel})")
        await page.evaluate("() => document.getElementById('classroom').click()")
        await page.wait_for_timeout(300)
        sel = await page.evaluate("() => document.querySelectorAll('.seat.group-selected').length")
        st = await page.evaluate(STATS_JS)
        check(sel == 0 and st["normal"] == "flex",
              f"点空白区域(讲台)⇒ 自动取消选择(实际 sel={sel}, {st['normal']})")

        # ══════════ 场景 B:分组模式「取消选择」按钮 ══════════
        print("\n── 场景 B:分组 banner 取消选择 ──")
        await page.click("#modeSwitchBtn")     # 普通 → 签到
        await page.wait_for_timeout(300)
        await page.click("#modeSwitchBtn")     # 签到 → 分组
        await page.wait_for_timeout(600)

        vis = await page.evaluate("""() => {
            const b = document.getElementById('groupModeClearBtn');
            return b ? getComputedStyle(b).display : 'missing';
        }""")
        check(vis == "none", f"未选学生时「取消选择」隐藏(实际 {vis})")

        await page.evaluate("""() => document.querySelector('.seat[data-student="s1"]').click()""")
        await page.wait_for_timeout(250)
        await page.evaluate("""() => document.querySelector('.seat[data-student="s2"]').click()""")
        await page.wait_for_timeout(300)
        vis = await page.evaluate("""() => {
            const b = document.getElementById('groupModeClearBtn');
            return b ? getComputedStyle(b).display : 'missing';
        }""")
        check(vis != "none", f"多选后「取消选择」显示(实际 {vis})")

        await page.click("#groupModeClearBtn")
        await page.wait_for_timeout(400)
        after = await page.evaluate("""() => ({
            sel: document.querySelectorAll('.seat.group-selected').length,
            btn: (() => { const b = document.getElementById('groupModeClearBtn');
                          return b ? getComputedStyle(b).display : 'missing'; })(),
            count: (document.getElementById('groupModeCount') || {}).textContent
        })""")
        st = await page.evaluate(STATS_JS)
        check(after["sel"] == 0, f"点「取消选择」⇒ 多选清空(实际 {after['sel']})")
        check(after["btn"] == "none", f"清空后按钮隐藏(实际 {after['btn']})")
        check("已选 0" in (after["count"] or ""), f"banner 计数归零(实际 {after['count']!r})")
        check(st["v1"] == "未选择" and st["l1"] == "当前分组", f"统计栏回到分组视图(实际 {st['l1']}/{st['v1']})")

        # 退出分组模式
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(600)

        # ══════════ 场景 C:配对设置弹窗着色 ══════════
        print("\n── 场景 C:配对状态着色 ──")
        # s1,s2 同桌(0,1)→ ok;s3,s4 分别在 2、5 → bad;s5 入座、s15 未入座 → na
        # s1..s14 依次落座 0..13;s15/s16 不入座。
        # 同桌关系(cols=6,无走道):(0,1)(2,3)(4,5)…
        #   强制 s1+s2 同桌(0,1)⇒ ok
        #   强制 s3(2)+s5(4)不同桌 ⇒ bad
        #   强制 s5(已入座)+ s15(未入座)⇒ na
        #   回避 s1+s2 同桌 ⇒ bad;回避 s7(6)+s9(8)不同桌 ⇒ ok
        seats_c = [None] * 30
        for i in range(1, 15):
            seats_c[i - 1] = f"s{i}"
        await load(page, base_cfg(
            students=mk_students(16),
            seats=seats_c,
            forcedPairs=[["s1", "s2"], ["s3", "s5"], ["s5", "s15"]],
            avoidPairs=[["s1", "s2"], ["s7", "s9"]],
        ))
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        await page.click("#randomDropdown [data-action='pairSettings']")
        await page.wait_for_timeout(400)

        pc = await page.evaluate(PAIR_CLASSES_JS)
        check(pc["forced"] == ["pair-status-ok", "pair-status-bad", "pair-status-na"],
              f"强制配对 ok/bad/na 三态着色(实际 {pc['forced']})")
        # 回避:s1,s2 同桌 ⇒ bad;s7(6),s9(8) 不同桌 ⇒ ok
        check(pc["avoid"] == ["pair-status-bad", "pair-status-ok"],
              f"回避配对 bad/ok 着色(实际 {pc['avoid']})")

        # ══════════ 场景 D:座位变化后刷新 ══════════
        print("\n── 场景 D:随机排座后配对状态刷新 ──")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(250)
        await page.click("#smartArrangeBtn")   # 开关全关 = 完全随机
        await page.wait_for_timeout(1200)
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        await page.click("#randomDropdown [data-action='pairSettings']")
        await page.wait_for_timeout(400)

        pc2 = await page.evaluate(PAIR_CLASSES_JS)
        exp = await page.evaluate(EXPECT_PAIRS_JS)
        got_f = [c.replace("pair-status-", "") for c in pc2["forced"]]
        got_a = [c.replace("pair-status-", "") for c in pc2["avoid"]]
        check(got_f == exp["forced"], f"重排后强制配对状态与座位一致(实际 {got_f} / 期望 {exp['forced']})")
        check(got_a == exp["avoid"], f"重排后回避配对状态与座位一致(实际 {got_a} / 期望 {exp['avoid']})")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(250)

        # ══════════ 场景 E:随机排座满足配对设置 ══════════
        print("\n── 场景 E:随机排座保证配对设置 ──")
        await load(page, cfg_pairs())
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(1500)

        res = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            const st = m.state;
            const cols = st.cols;
            const seatOf = {};
            st.seats.forEach((sid, idx) => { if (sid) seatOf[sid] = idx; });
            const mate = (idx) => {
                const c = idx % cols;
                if (c + 1 < cols) {
                    const a = (st.aisles || []).find(x => x.afterCol === c + 1);
                    if (!a) return idx + 1;
                }
                if (c - 1 >= 0) {
                    const a = (st.aisles || []).find(x => x.afterCol === c);
                    if (!a) return idx - 1;
                }
                return null;
            };
            const together = (p) => {
                const a = seatOf[p[0]], b = seatOf[p[1]];
                if (a === undefined || b === undefined) return null;
                return mate(a) === b;
            };
            return {
                forced: st.forcedPairs.map(together),
                avoid: st.avoidPairs.map(together),
                toast: (document.querySelector('.stat-toast') || {}).textContent || ''
            };
        }""")
        check(res["forced"] == [True, True], f"2 对强制配对随机排座后都同桌(实际 {res['forced']})")
        check(res["avoid"] == [False], f"回避配对随机排座后被分开(实际 {res['avoid']})")
        check("配对设置未能完全满足" not in res["toast"],
              f"未出现配对未满足提示(实际 toast={res['toast']!r})")

        # ══════════ 场景 F:分组轮换溢出改归上游组 ══════════
        print("\n── 场景 F:轮换溢出学生改归上游组 ──")
        await load(page, cfg_rotate())
        before = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            const c = {};
            m.state.students.forEach(s => { c[s.groupId] = (c[s.groupId] || 0) + 1; });
            return c;
        }""")
        check(before == {"g1": 6, "g2": 3, "g3": 3}, f"轮换前 6/3/3(实际 {before})")

        # 开启「小组轮换」开关后点上段按钮:先随机排座再按步长轮换
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        await page.click("#randomDropdown [data-toggle='rotate']")
        await page.wait_for_timeout(200)
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(1500)

        after = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            const c = {};
            m.state.students.forEach(s => { c[s.groupId] = (c[s.groupId] || 0) + 1; });
            return {
                counts: c,
                seated: m.state.seats.filter(Boolean).length,
                toast: (document.querySelector('.stat-toast') || {}).textContent || ''
            };
        }""")
        # 第一组 6 人挤不进第二组的 3 个座位 ⇒ 3 人溢出,改归上游组第三组
        check(after["counts"] == {"g1": 3, "g2": 3, "g3": 6},
              f"溢出 3 人改归上游组 ⇒ 3/3/6(实际 {after['counts']})")
        check(after["seated"] == 12, f"占座总数不变 12(实际 {after['seated']})")
        check("未能轮换" in after["toast"] and "第三组" in after["toast"],
              f"给出溢出改归提示(实际 toast={after['toast']!r})")

        print("\n── 场景 G:控制台 ──")
        check(len(errors) == 0, f"无 JS 报错(实际 {errors[:3]})")

        await browser.close()

    print(f"\n{'=' * 46}\n通过 {passed} 项,失败 {failed} 项\n{'=' * 46}")
    return 1 if failed else 0


raise SystemExit(asyncio.run(main()))
