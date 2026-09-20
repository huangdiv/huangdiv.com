# -*- coding: utf-8 -*-
"""
批次19 — 性别规则(男女同桌 / 男女不同桌)闪烁提示 + 轮换后组内调整

需求 1:开启「男女同桌」或「男女不同桌」开关时,自动检测未达成该条件的同桌座位,
        缓慢闪烁提示;任意手动或自动调整座位后重新检测并提示。
需求 2:同时开启「男女不同桌」+「小组轮换」时点「智能排座」——
        先保证小组轮换,再做全班性别规则检测与调整;
        调整只能在该座位的同一小组内部进行,绝不把学生挪到别的小组座位区域;
        确实达不成的保留原样(只提示)。

场景:
 1. 开关默认关闭 ⇒ 无闪烁座位
 2. 开「男女不同桌」⇒ 未达成同桌双侧座位带 .gender-rule-hint,数量与检测结果一致
 3. 闪烁样式:animation-name = genderRuleBlink,缓慢(≥2s)+ 无限循环
 4. 互斥切换:开「男女同桌」⇒ 提示随之重算(本例全部达成 ⇒ 0 个)
 5. 手动拖座换位后 ⇒ 提示立即重算(出现 2 桌违规 = 4 个闪烁座位)
 6. 关闭开关 ⇒ 闪烁全部清除
 7. 轮换 + 男女不同桌(经 __seatsTest 直驱):
    轮换语义不变(每组学生仍整体落在目标组座位区)+ 组内调整不跨区
 8. UI 端到端:开「小组轮换」+「男女不同桌」点智能排座 ⇒ 无报错,提示与实际一致
 9. 无 JS 报错
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


INJECT_JS = """({sizes, genders, rows, cols, offset, ungrouped}) => {
    const groups = sizes.map((n, i) => ({
        id: 'g' + (i + 1),
        name: '第' + (i + 1) + '组',
        color: ['#FF9F9F', '#9FCFFF', '#9FFFBE', '#FFE08A', '#DDA0DD'][i]
    }));
    const students = [];
    let k = 0;
    sizes.forEach((n, i) => {
        for (let j = 0; j < n; j++) {
            const g = genders[k] || 'X';
            k++;
            students.push({
                id: 's' + k, name: '学生' + k,
                groupId: groups[i].id, tags: [], checkedIn: false,
                gender: g === 'M' ? 'male' : (g === 'F' ? 'female' : '')
            });
        }
    });
    // 无分组学生:轮换时原地不动,全班随机排座则会把他们打散 —— 用來区分两条路径
    for (let u = 0; u < (ungrouped || 0); u++) {
        k++;
        const g = genders[k] || 'X';
        students.push({
            id: 's' + k, name: '学生' + k,
            groupId: '', tags: [], checkedIn: false,
            gender: g === 'M' ? 'male' : (g === 'F' ? 'female' : '')
        });
    }
    const seats = Array(rows * cols).fill(null);
    for (let i = 0; i < students.length; i++) seats[i] = students[i].id;
    localStorage.setItem('classroomConfig', JSON.stringify({
        title: '性别规则测试', rows, cols, seats, students, groups,
        viewMode: 'student', aisles: [], showStudentIcons: true,
        forcedPairs: [], avoidPairs: [], isCheckinMode: false,
        isGroupMode: false, groupRotateOffset: offset, version: '1.3.1'
    }));
}"""

# 读:闪烁座位数 + 依据当前 state 独立算一遍违规桌数(两者必须一致)
HINT_JS = """async (mode) => {
    const { state } = await import('./modules/state.js');
    const gmap = {};
    state.students.forEach(s => {
        gmap[s.id] = s.gender === 'male' ? 'M' : (s.gender === 'female' ? 'F' : 'X');
    });
    const pairs = [];
    for (let r = 0; r < state.rows; r++) {
        let c = 0;
        while (c < state.cols) {
            if (c + 1 < state.cols && !state.aisles.find(a => a.afterCol === c + 1)) {
                pairs.push([r * state.cols + c, r * state.cols + c + 1]);
                c += 2;
            } else { c += 1; }
        }
    }
    let violations = 0;
    if (mode) {
        pairs.forEach(([a, b]) => {
            const x = state.seats[a], y = state.seats[b];
            if (!x || !y) return;
            const ga = gmap[x], gb = gmap[y];
            if (ga === 'X' || gb === 'X') return;
            const badDesk = mode === 'mixed' ? (ga === gb) : (ga !== gb);
            if (badDesk) violations++;
        });
    }
    const hinted = Array.from(document.querySelectorAll('.seat.gender-rule-hint'))
        .map(el => Number(el.getAttribute('data-index'))).sort((p, q) => p - q);
    return {
        violations,
        hintCount: hinted.length,
        hinted,
        seats: state.seats.slice(),
        groupOf: Object.fromEntries(state.students.map(s => [s.id, s.groupId]))
    };
}"""

ANIM_JS = """() => {
    const el = document.querySelector('.seat.gender-rule-hint');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
        name: cs.animationName,
        duration: cs.animationDuration,
        iteration: cs.animationIterationCount,
        timing: cs.animationTimingFunction
    };
}"""


STATE_JS = """async () => {
    const { state } = await import('./modules/state.js');
    const groupOf = {};
    state.students.forEach(s => { groupOf[s.id] = s.groupId || ''; });
    return { seats: state.seats.slice(), groupOf };
}"""


async def inject(page, sizes, genders, rows=2, cols=6, offset=1, ungrouped=0):
    await page.evaluate(INJECT_JS, {
        "sizes": sizes, "genders": genders,
        "rows": rows, "cols": cols, "offset": offset,
        "ungrouped": ungrouped
    })
    await page.reload()
    await page.wait_for_timeout(700)


async def toggle_switch(page, name):
    """打开智能排座下拉并点某个开关"""
    await page.click("#randomDropdownBtn")
    await page.wait_for_timeout(150)
    await page.click(f'#randomDropdown [data-toggle="{name}"]')
    await page.wait_for_timeout(250)
    # 收起下拉,避免遮挡后续点击
    await page.click("#pageTitle")
    await page.wait_for_timeout(150)


async def switch_state(page):
    return await page.evaluate("""() => ({
        mixed: document.querySelector('#randomDropdown [data-toggle="mixed"]')?.getAttribute('aria-checked'),
        samegender: document.querySelector('#randomDropdown [data-toggle="samegender"]')?.getAttribute('aria-checked'),
        rotate: document.querySelector('#randomDropdown [data-toggle="rotate"]')?.getAttribute('aria-checked')
    })""")


async def main():
    global PASSED, FAILED
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        dialogs = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        async def _on_dialog(d):
            dialogs.append(d.message)
            await d.accept()

        page.on("dialog", lambda d: asyncio.ensure_future(_on_dialog(d)))

        await page.goto(BASE)
        await page.wait_for_timeout(600)

        # 2 组各 6 人,男女交替 ⇒ 初始 6 桌全是异性同桌
        await inject(page, [6, 6], "MFMFMFMFMFMF")

        # ── 场景 1:开关默认关闭 ⇒ 无闪烁 ──
        print("\n── 场景 1:默认关闭 ⇒ 无闪烁座位 ──")
        st = await switch_state(page)
        check(st["mixed"] == "false" and st["samegender"] == "false",
              f"两个性别开关默认关闭 {st}")
        r = await page.evaluate(HINT_JS, None)
        check(r["hintCount"] == 0, f"无闪烁座位(实际 {r['hintCount']})")

        # ── 场景 2:开「男女不同桌」⇒ 6 桌违规 = 12 个座位闪烁 ──
        print("\n── 场景 2:开「男女不同桌」⇒ 未达成同桌闪烁 ──")
        await toggle_switch(page, "samegender")
        st = await switch_state(page)
        check(st["samegender"] == "true", f"开关已开启 {st}")
        r = await page.evaluate(HINT_JS, "samegender")
        check(r["violations"] == 6, f"检测到 6 桌未达成(实际 {r['violations']})")
        check(r["hintCount"] == 12, f"12 个座位闪烁(实际 {r['hintCount']})")
        check(r["hinted"] == list(range(12)),
              f"闪烁的是全部 12 个座位 {r['hinted']}")

        # ── 场景 3:缓慢闪烁样式 ──
        print("\n── 场景 3:缓慢闪烁(animation)──")
        anim = await page.evaluate(ANIM_JS)
        check(anim is not None, "取到闪烁座位的计算样式")
        if anim:
            check(anim["name"] == "genderRuleBlink",
                  f"animation-name = {anim['name']}")
            check(anim["iteration"] == "infinite",
                  f"无限循环({anim['iteration']})")
            dur = float(str(anim["duration"]).replace("s", "") or 0)
            check(dur >= 2.0, f"周期缓慢 {anim['duration']}(≥2s)")

        # ── 场景 4:互斥切到「男女同桌」⇒ 重算(本例全部达成)──
        print("\n── 场景 4:切到「男女同桌」⇒ 提示重算 ──")
        await toggle_switch(page, "mixed")
        st = await switch_state(page)
        check(st["mixed"] == "true" and st["samegender"] == "false",
              f"互斥生效 {st}")
        r = await page.evaluate(HINT_JS, "mixed")
        check(r["violations"] == 0, f"异性同桌全部达成(实际 {r['violations']})")
        check(r["hintCount"] == 0, f"不再有闪烁座位(实际 {r['hintCount']})")

        # ── 场景 5:手动拖座换位 ⇒ 提示立即重算 ──
        print("\n── 场景 5:手动拖座后重新检测 ──")
        # 座位 0(男)↔ 座位 3(女)互换 ⇒ (0,1) 变女/女、(2,3) 变男/男
        await page.drag_and_drop('.seat[data-index="0"]', '.seat[data-index="3"]')
        await page.wait_for_timeout(500)
        r = await page.evaluate(HINT_JS, "mixed")
        check(r["violations"] == 2, f"换位后出现 2 桌同性(实际 {r['violations']})")
        check(r["hintCount"] == 4, f"4 个座位开始闪烁(实际 {r['hintCount']})")
        check(r["hinted"] == [0, 1, 2, 3], f"闪烁座位正确 {r['hinted']}")

        # ── 场景 6:关闭开关 ⇒ 闪烁清除 ──
        print("\n── 场景 6:关闭开关 ⇒ 提示清除 ──")
        await toggle_switch(page, "mixed")
        st = await switch_state(page)
        check(st["mixed"] == "false", f"开关已关闭 {st}")
        r = await page.evaluate(HINT_JS, None)
        check(r["hintCount"] == 0, f"闪烁全部清除(实际 {r['hintCount']})")

        # ── 场景 7:轮换 + 男女不同桌(直驱真实实例)──
        print("\n── 场景 7:小组轮换 + 男女不同桌 ⇒ 先轮换、后组内调整 ──")
        # 每组 3 男 3 女 ⇒ 组内最多排成 2 桌同性,必有 1 桌达不成
        await inject(page, [6, 6], "MMMFFFMMMFFF")
        before = await page.evaluate(HINT_JS, None)
        before0 = sorted(before["seats"][0:6])
        before1 = sorted(before["seats"][6:12])
        rot = await page.evaluate(
            """async () => {
                if (!window.__seatsTest) throw new Error('测试钩子未暴露');
                return window.__seatsTest.rotateGroupSeats(1, { genderMode: 'samegender' }) || {};
            }"""
        )
        await page.wait_for_timeout(400)
        after = await page.evaluate(HINT_JS, None)
        # 轮换语义:g1 → 区 1,g2 → 区 0(组内调整不得改变这一归属)
        check(sorted(after["seats"][6:12]) == before0,
              "g1 成员整体仍在区 1(未被挪到别的小组座位区)")
        check(sorted(after["seats"][0:6]) == before1,
              "g2 成员整体仍在区 0(未被挪到别的小组座位区)")
        gwarn = [w for w in (rot.get("warnings") or []) if "男女不同桌" in w]
        check(len(gwarn) == 1, f"存在 1 条未达成提示 {rot.get('warnings')}")
        check("2 桌" in (gwarn[0] if gwarn else ""),
              f"提示含未达成桌数 {gwarn}")
        r = await page.evaluate(HINT_JS, "samegender")
        check(r["violations"] == 2, f"实际剩 2 桌未达成(实际 {r['violations']})")
        # 开关此时是关的(重新注入过)⇒ 不闪烁;打开后应恰好 4 个座位闪烁
        check(r["hintCount"] == 0, "开关关闭时不闪烁")
        await toggle_switch(page, "samegender")
        r = await page.evaluate(HINT_JS, "samegender")
        check(r["hintCount"] == 4, f"开开关后 4 个座位闪烁(实际 {r['hintCount']})")

        # ── 场景 8:UI 端到端(小组轮换 + 男女不同桌 + 智能排座)──
        print("\n── 场景 8:端到端点「智能排座」──")
        await inject(page, [6, 6], "MMMFFFMMMFFF")
        await toggle_switch(page, "samegender")
        await toggle_switch(page, "rotate")
        st = await switch_state(page)
        check(st["samegender"] == "true" and st["rotate"] == "true",
              f"两个开关同时开启 {st}")
        dialogs.clear()
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(900)
        check(
            not any("随机" in m for m in dialogs),
            f"不再弹「完全随机」确认(实际 {dialogs})",
        )
        check(any("轮换" in m for m in dialogs), f"仍保留轮换确认(实际 {dialogs})")
        check(len(dialogs) == 1, f"一次点击只弹 1 个确认框(实际 {len(dialogs)})")
        r = await page.evaluate(HINT_JS, "samegender")
        check(r["hintCount"] == r["violations"] * 2,
              f"闪烁座位与检测结果一致(违规 {r['violations']} 桌 / 闪烁 {r['hintCount']} 座)")
        placed = len([x for x in r["seats"] if x])
        check(placed == 12, f"12 人全部在座(实际 {placed})")
        check(len(set(r["seats"])) == 12, "无重复占座")

        # ── 场景 8b:开启轮换 ⇒ 只做轮换,不做全班随机排座 ──
        print("\n── 场景 8b:开轮换点智能排座 ⇒ 不做全班随机 ──")
        # 2 组各 6 人 + 2 名无分组学生(s13/s14,初始占 12、13 号座)
        await inject(page, [6, 6], "MMMFFFMMMFFF", rows=2, cols=8, ungrouped=2)
        before = await page.evaluate(STATE_JS)
        await toggle_switch(page, "rotate")
        dialogs.clear()
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(900)
        after = await page.evaluate(STATE_JS)

        check(len(dialogs) == 1 and "轮换" in dialogs[0],
              f"只弹 1 个轮换确认(实际 {dialogs})")
        # 无分组学生:轮换原地不动;全班随机排座会把他们打散 ⇒ 可区分两条路径
        free_before = {i: s for i, s in enumerate(before["seats"]) if s and not before["groupOf"][s]}
        free_after = {i: s for i, s in enumerate(after["seats"]) if s and not after["groupOf"][s]}
        check(free_before == free_after and len(free_before) == 2,
              f"无分组学生座位原地不动(前 {free_before} / 后 {free_after})")

        def seats_of(d, gid):
            return {i for i, s in enumerate(d["seats"]) if s and d["groupOf"][s] == gid}

        check(seats_of(after, "g1") == set(range(6, 12)),
              f"g1 整体轮换到座位区 6-11(实际 {sorted(seats_of(after, 'g1'))})")
        check(seats_of(after, "g2") == set(range(0, 6)),
              f"g2 整体轮换到座位区 0-5(实际 {sorted(seats_of(after, 'g2'))})")
        check(len([x for x in after["seats"] if x]) == 14,
              "14 人全部在座(占座总数不变)")

        # ── 场景 9:只开性别规则(不开轮换)⇒ 仍要有排座确认 ──
        print("\n── 场景 9:未开轮换时保留排座确认 ──")
        await inject(page, [6, 6], "MMMFFFMMMFFF")
        await toggle_switch(page, "samegender")
        dialogs.clear()
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(800)
        check(
            any("男女不同桌" in m for m in dialogs),
            f"未开轮换 ⇒ 仍弹「男女不同桌」确认(实际 {dialogs})",
        )

        # ── 场景 10:无 JS 报错 ──
        print("\n── 场景 10:控制台无报错 ──")
        check(len(errors) == 0, f"无 pageerror {errors[:3]}")

        await page.screenshot(path="smoke_test_batch19.png", full_page=False)
        await browser.close()

    print("\n" + "=" * 56)
    print(f"总计: {PASSED + FAILED} 项,{PASSED} 通过,{FAILED} 失败")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
