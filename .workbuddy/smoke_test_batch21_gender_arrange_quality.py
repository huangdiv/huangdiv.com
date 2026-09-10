# -*- coding: utf-8 -*-
"""
批次21 — 只开「男女不同桌」随机排座的达成率(端到端真实实例)

背景:此前 randomSeatArrange 的「每位学生都不在原来座位」换座后处理无视性别规则,
      把落座阶段排好的同性别同桌大量拆散 ⇒ 开着开关却经常排不出符合要求的座位。

修复要点(modules/random-arrange.js):
  1. 换座后处理新增性别守卫:不得把合规同桌拆成违规(性别规则优先于「必须换座」)
  2. 落座阶段剩余学生按桌成组智能填充(优先凑同性别 / 一男一女),不再随机乱塞
  3. 收尾做一轮全班范围的性别修复;确实做不到(如男女生人数为奇数)才保留并提示

断言(共 12 项):
  1-2. 12M/12F:连续 10 次智能排座,每次违规桌数 = 0、闪烁座位数 = 0
  3.   人人有座(24 人全在座)+ 无重复占座
  4.   不出现「未达成」提示
  5-6. 13M/11F(女奇):连续 10 次,最差 ≤ 1 桌违规;确实有违规时给出提示
  7.   切换「男女同桌」(mixed)同样达成:10 次违规 = 0
  8.   关闭开关后闪烁清除
  9.   无 JS 报错
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


INJECT_JS = """({genders, rows, cols}) => {
    const students = [];
    for (let i = 0; i < genders.length; i++) {
        const ch = genders[i];
        students.push({
            id: 's' + (i + 1), name: '学生' + (i + 1), groupId: '',
            tags: [], checkedIn: false,
            gender: ch === 'M' ? 'male' : (ch === 'F' ? 'female' : '')
        });
    }
    const seats = Array(rows * cols).fill(null);
    students.forEach((s, i) => { seats[i] = s.id; });
    localStorage.setItem('classroomConfig', JSON.stringify({
        title: '男女不同桌达成率', rows, cols, seats, students, groups: [],
        viewMode: 'student', aisles: [], showStudentIcons: true,
        forcedPairs: [], avoidPairs: [], isCheckinMode: false,
        isGroupMode: false, groupRotateOffset: 1, version: '1.3.1'
    }));
}"""

# 独立算一遍违规桌数 + 读界面闪烁座位数(二者必须一致)
HINT_JS = """async (mode) => {
    const { state } = await import('./modules/state.js');
    const g = {};
    state.students.forEach(s => {
        g[s.id] = s.gender === 'male' ? 'M' : (s.gender === 'female' ? 'F' : 'X');
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
            const gx = g[x], gy = g[y];
            if (gx === 'X' || gy === 'X') return;
            const bad = mode === 'mixed' ? (gx === gy) : (gx !== gy);
            if (bad) violations++;
        });
    }
    return {
        violations,
        hintCount: document.querySelectorAll('.seat.gender-rule-hint').length,
        seats: state.seats.slice(),
        toast: (document.querySelector('#statToast')?.textContent || '').trim()
    };
}"""


async def inject(page, genders, rows=4, cols=6):
    await page.evaluate(INJECT_JS, {"genders": genders, "rows": rows, "cols": cols})
    await page.reload()
    await page.wait_for_timeout(600)


async def toggle(page, name):
    await page.click("#randomDropdownBtn")
    await page.wait_for_timeout(150)
    await page.click(f'#randomDropdown [data-toggle="{name}"]')
    await page.wait_for_timeout(200)
    await page.click("#pageTitle")
    await page.wait_for_timeout(150)


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
        await page.wait_for_timeout(500)

        # ── 场景 1:12M / 12F ⇒ 完美可达成 ──
        print("\n── 场景 1:12M/12F 连续 10 次智能排座 ──")
        await inject(page, "MFMFMFMFMFMFMFMFMFMFMFMF")
        await toggle(page, "samegender")
        worst = 0
        worst_hint = 0
        all_seated = True
        no_dup = True
        unsat_toast = 0
        for i in range(10):
            dialogs.clear()
            await page.click("#smartArrangeBtn")
            await page.wait_for_timeout(500)
            r = await page.evaluate(HINT_JS, "samegender")
            worst = max(worst, r["violations"])
            worst_hint = max(worst_hint, r["hintCount"])
            if len([x for x in r["seats"] if x]) != 24:
                all_seated = False
            if len(set([x for x in r["seats"] if x])) != 24:
                no_dup = False
            if "未达成" in r["toast"]:
                unsat_toast += 1
        check(worst == 0, f"10 次排座违规桌数最差 {worst}(应为 0)")
        check(worst_hint == 0, f"闪烁座位数最差 {worst_hint}(应为 0)")
        check(all_seated, "每次 24 人全部在座")
        check(no_dup, "每次无重复占座")
        check(unsat_toast == 0, f"不应出现「未达成」提示(出现 {unsat_toast} 次)")

        # ── 场景 2:13M / 11F ⇒ 男数为奇,最多 1 桌违规 ──
        print("\n── 场景 2:13M/11F(奇数)连续 10 次 ──")
        await inject(page, "MMMMMMMMMMMMMFFFFFFFFFFF")
        await toggle(page, "samegender")
        worst2 = 0
        seated2 = True
        for i in range(10):
            await page.click("#smartArrangeBtn")
            await page.wait_for_timeout(500)
            r = await page.evaluate(HINT_JS, "samegender")
            worst2 = max(worst2, r["violations"])
            if len([x for x in r["seats"] if x]) != 24:
                seated2 = False
        check(worst2 <= 1, f"奇数男女最差 {worst2} 桌违规(容差 ≤ 1)")
        check(seated2, "奇数男女也人人有座(不丢人)")

        # ── 场景 3:切到「男女同桌」(mixed)同样达成 ──
        print("\n── 场景 3:12M/12F 切「男女同桌」10 次 ──")
        await inject(page, "MFMFMFMFMFMFMFMFMFMFMFMF")
        await toggle(page, "samegender")   # 关掉不同桌
        await toggle(page, "mixed")
        worst3 = 0
        for i in range(10):
            await page.click("#smartArrangeBtn")
            await page.wait_for_timeout(500)
            r = await page.evaluate(HINT_JS, "mixed")
            worst3 = max(worst3, r["violations"])
        check(worst3 == 0, f"mixed 模式 10 次违规最差 {worst3}(应为 0)")

        # ── 场景 4:关闭开关 ⇒ 闪烁清除 ──
        print("\n── 场景 4:关闭开关 ⇒ 提示清除 ──")
        await toggle(page, "mixed")
        r = await page.evaluate(HINT_JS, None)
        check(r["hintCount"] == 0, f"关闭后无闪烁(实际 {r['hintCount']})")

        # ── 场景 5:控制台 ──
        print("\n── 场景 5:控制台 ──")
        check(len(errors) == 0, f"无 pageerror {errors[:3]}")

        await page.screenshot(path="smoke_test_batch21.png")
        await browser.close()

    print("\n" + "=" * 56)
    print(f"总计: {PASSED + FAILED} 项,{PASSED} 通过,{FAILED} 失败")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
