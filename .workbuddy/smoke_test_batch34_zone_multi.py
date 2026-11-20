# -*- coding: utf-8 -*-
"""
批次34 — 区域设置「倾向 / 避开」均支持区域多选（v1.4.10）

需求:
  每个学生的「倾向区域」和「避开区域」都能同时选多个九宫格区域。
  倾向：落在其中任意一个即算满足；避开：落在其中任意一个即算未满足。

断言(共 28 项):
  1. 弹窗结构：9 个区域格 / 9 行学生 / 4 列表头
  2. 每行两个多选触发器 button，且已完全移除旧的单选 <select>
  3. hint 说明「多选」；同一时刻只有一个 .zone-picker
  4. 旧配置单值字符串被兼容升级：s4 触发器显示「前左」，落盘为数组
  5. 多倾向命中任一 → zone-status-ok（绿）
  6. 多倾向全不命中 → bad + 仅「倾向」描红
  7. 多避开命中任一 → bad + 仅「避开」描红
  8. 菜单角标按「学生人数」计，一个学生多选仍算 1 人
  9. 顶部汇总条按学生计（倾向 3 项、避开 1 项），不是按区域数
 10. 点「倾向」→ 展开 9 个 checkbox，aria-expanded=true
 11. 勾 1 个 → localStorage.zonePref 是数组
 12. 勾 2 个 → 按九宫格固定顺序稳定化（与点击次序无关）
 13. 勾 3 个 → 触发器显示「3 区」，title 列出三个中文名
 14. 区域预览格计数：多选的区域各 +1（叠加预置数据）
 15. 取消其中一个 → 数组缩回 2 个（可增可减）
 16. 切到「避开」→ 旧面板收起，全局仍只有一个 picker
 17. 避开也支持多选（2 个区域）
 18. 倾向/避开交集被拦：alert + checkbox 回退 + 配置不变
 19. 反向同样被拦：在倾向里勾已避开的区域
 20. 「清空」把该字段归零，触发器回到「未设置」
 21. 点面板外自动收起
 22. Esc 第一次只收起面板、弹窗仍在；第二次才关闭弹窗
 23. 刷新后多选设置完整保留（数组持久化）
 24. 键盘可达：Tab / 空格能勾选面板里的 checkbox
 25. 版本号 1.4.10
 26. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
"""
import asyncio
import json

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"
PASSED = 0
FAILED = 0
ERRORS = []
DIALOGS = []

FAKE_XLSX = """window.XLSX = {
    read: function () { return { SheetNames: [], Sheets: {} }; },
    utils: { sheet_to_json: function () { return []; } }
};"""
FAKE_H2C = "window.html2canvas = () => Promise.reject(new Error('stub'));"

NAMES = ["张伟", "李娜", "王强", "赵敏", "孙悦",
         "陈晨", "刘洋", "周婷", "吴磊"]


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


def check(cond, msg):
    (ok if cond else bad)(msg)


def make_config():
    # 3×3 教室，9 人全部按 rank 本位入座 ⇒ 下标 i 的区域可由 seatZone(i,3,3) 推出：
    #   0 前左 / 1 前中 / 2 前右 / 3 中左 / 4 中中 / 5 中右 / 6 后左 / 7 后中 / 8 后右
    # 预置几组数据，用真实颜色提示验证多选判定语义。
    presets = {
        "s1": (["front-left", "front-center"], []),      # 命中前左 ⇒ ok
        "s2": (["back-right", "back-left"], []),         # 两个都没命中 ⇒ prefBad
        "s3": ([], ["front-right", "front-center"]),     # 命中前右 ⇒ avoidBad
        "s4": ("front-left", []),                        # 故意用旧版单值字符串
    }
    students = []
    for i, n in enumerate(NAMES):
        sid = f"s{i+1}"
        pref, avoid = presets.get(sid, ("", ""))
        students.append({
            "id": sid, "name": n, "groupId": None, "checkedIn": False,
            "gender": "male" if i % 2 == 0 else "female", "tags": [],
            "rank": i + 1, "zonePref": pref, "zoneAvoid": avoid,
        })
    return {
        "title": "批次34 区域多选",
        "rows": 3, "cols": 3,
        "seats": [f"s{i+1}" for i in range(9)],
        "students": students,
        "groups": [],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "showPairLinks": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "version": "1.4.10",
    }


async def read_config(page):
    return await page.evaluate(
        "() => JSON.parse(localStorage.getItem('classroomConfig') || '{}')")


async def saved_config(page):
    # autoSave 是 500ms 防抖：连续勾选会不断重置定时器，读盘前必须留够空隙
    await page.wait_for_timeout(750)
    return await read_config(page)


def student_of(cfg, sid):
    return next(s for s in cfg.get("students", []) if s["id"] == sid)


def zpref(cfg, sid):
    return student_of(cfg, sid).get("zonePref")


def zavoid(cfg, sid):
    return student_of(cfg, sid).get("zoneAvoid")


async def row_state(page, idx):
    return await page.evaluate("""(i) => {
        const row = document.querySelectorAll('.zone-popup .zone-row')[i];
        if (!row) return null;
        const st = ['ok', 'bad', 'na'].find(k => row.classList.contains('zone-status-' + k)) || '';
        const pref = row.querySelector('.zone-pref');
        const avoid = row.querySelector('.zone-avoid');
        return {
            status: st,
            prefBad: !!(pref && pref.classList.contains('zone-field-bad')),
            avoidBad: !!(avoid && avoid.classList.contains('zone-field-bad')),
            prefText: pref ? pref.textContent.trim() : '',
            avoidText: avoid ? avoid.textContent.trim() : '',
            title: row.getAttribute('title') || '',
        };
    }""", idx)


async def open_zone_popup(page):
    await page.click("#randomDropdownBtn")
    await page.wait_for_timeout(220)
    await page.click('[data-action="zoneSettings"]')
    await page.wait_for_timeout(350)


async def toggle_field(page, row_idx, field):
    cls = "zone-pref" if field == "zonePref" else "zone-avoid"
    await page.locator(".zone-popup .zone-row").nth(row_idx).locator("." + cls).click()
    await page.wait_for_timeout(180)


async def tick(page, zone_id, checked=True):
    cb = page.locator(
        f'.zone-popup .zone-picker .zone-pick-cell[data-zone-id="{zone_id}"] input')
    # 用 click 而不是 check/uncheck：交集冲突时 JS 会把 checkbox 回退成未勾选，
    # check() 会因「状态没变成 checked」抛错，而那正是我们要断言的预期行为。
    if await cb.is_checked() != checked:
        await cb.click()
    await page.wait_for_timeout(180)


async def main():
    global PASSED, FAILED

    async def on_dialog(d):
        DIALOGS.append(d.message)
        await d.accept()

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)
        page.on("dialog", lambda d: asyncio.create_task(on_dialog(d)))

        await page.route("**/xlsx.full.min.js",
                         lambda r: r.fulfill(status=200,
                                             content_type="application/javascript; charset=utf-8",
                                             body=FAKE_XLSX))
        await page.route("**/html2canvas*.js",
                         lambda r: r.fulfill(status=200,
                                             content_type="application/javascript; charset=utf-8",
                                             body=FAKE_H2C))
        # sessionStorage 守卫：reload 时不覆盖自动保存的结果
        await page.add_init_script(
            "if (!sessionStorage.getItem('__seeded34')) {"
            "  localStorage.setItem('classroomConfig', %s);"
            "  sessionStorage.setItem('__seeded34', '1');"
            "}" % json.dumps(json.dumps(make_config(), ensure_ascii=False)))

        await page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(1400)

        # ═══ 1~3. 结构 ═══
        print("=== 1~3. 弹窗结构与触发器 ===")
        await open_zone_popup(page)
        cells = await page.locator(".zone-popup .zone-cell").count()
        rows = await page.locator(".zone-popup .zone-row").count()
        heads = await page.locator(".zone-popup .zone-head span").count()
        check(cells == 9 and rows == 9 and heads == 4,
              f"9 区域格 / 9 行学生 / 4 列表头（实际 {cells}/{rows}/{heads}）")

        buttons = await page.locator(".zone-popup .zone-row button.zone-select").count()
        selects = await page.locator(".zone-popup select.zone-select").count()
        check(buttons == 18 and selects == 0,
              f"18 个多选触发器 button、0 个旧 select（实际 button={buttons} select={selects}）")
        hint = await page.locator(".zone-popup .zone-hint").inner_text()
        check("多选" in hint, "说明文案明确写了「可多选」")

        # ═══ 4~9. 预设数据：旧配置兼容 + 多选满足判定 ═══
        print("=== 4~9. 旧值兼容 + 多选满足情况 ===")
        s4_text = (await row_state(page, 3))["prefText"]
        check(s4_text == "前左", f"旧单值字符串仍正确显示（实际 {s4_text!r}）")

        st1 = await row_state(page, 0)
        check(st1["status"] == "ok" and not st1["prefBad"],
              "多倾向命中任一 ⇒ 绿底 ok（张伟）")
        st2 = await row_state(page, 1)
        check(st2["status"] == "bad" and st2["prefBad"] and not st2["avoidBad"],
              "多倾向全不命中 ⇒ bad 且仅倾向描红（李娜）")
        st3 = await row_state(page, 2)
        check(st3["status"] == "bad" and st3["avoidBad"] and not st3["prefBad"],
              "多避开命中任一 ⇒ bad 且仅避开描红（王强）")

        label = (await page.locator('[data-action="zoneSettings"] .zone-settings-label')
                 .inner_text()).strip()
        check("[4]" in label, f"菜单角标按学生人数 = 4（实际 {label!r}）")
        summary = (await page.locator(".zone-popup .zone-status-line").inner_text()).strip()
        check("倾向 1/3" in summary and "避开 0/1" in summary,
              f"汇总条按学生计而非区域数（倾向 1/3、避开 0/1），实际 {summary!r}")

        # ═══ 10~15. 倾向多选交互（用第 5 行 孙悦 s5）═══
        print("=== 10~15. 倾向多选 ===")
        await toggle_field(page, 4, "zonePref")
        pickers = await page.locator(".zone-popup .zone-picker").count()
        checks = await page.locator(".zone-popup .zone-picker .zone-pick-cell input").count()
        expanded = await page.locator(
            '.zone-popup .zone-row').nth(4).locator('.zone-pref').get_attribute("aria-expanded")
        check(pickers == 1 and checks == 9 and expanded == "true",
              f"展开 1 个面板 / 9 个 checkbox / aria-expanded=true"
              f"（实际 {pickers}/{checks}/{expanded}）")

        await tick(page, "front-left")
        cfg = await saved_config(page)
        check(zpref(cfg, "s5") == ["front-left"],
              f"勾 1 个 ⇒ zonePref 是数组（实际 {zpref(cfg, 's5')!r}）")

        await tick(page, "front-center")
        cfg = await saved_config(page)
        check(zpref(cfg, "s5") == ["front-left", "front-center"],
              f"勾 2 个 ⇒ 数组含两项（实际 {zpref(cfg, 's5')!r}）")

        await tick(page, "front-right")
        cfg = await saved_config(page)
        st5 = await row_state(page, 4)
        title = await page.locator(".zone-popup .zone-row").nth(4).locator(
            ".zone-pref").get_attribute("title")
        check(zpref(cfg, "s5") == ["front-left", "front-center", "front-right"]
              and st5["prefText"] == "3 区" and "前左" in title and "前右" in title,
              f"勾 3 个 ⇒ 触发器「3 区」+ title 列出全部区域"
              f"（实际 {zpref(cfg, 's5')!r} / {st5['prefText']!r} / {title!r}）")

        grid = {}
        for z in ("front-left", "front-center", "front-right", "mid-left"):
            txt = await page.locator(
                f'.zone-popup .zone-cell[data-zone-id="{z}"]').inner_text()
            grid[z] = txt
        # 预置：s1 选前左+前中、s4 旧单值选前左 ⇒ 前左 3 人、前中 2 人；
        # 前右只有刚勾选的 s5 ⇒ 1 人。一个学生选几个区域就给几格各 +1。
        check("3 想坐" in grid["front-left"] and
              "2 想坐" in grid["front-center"] and
              "1 想坐" in grid["front-right"] and
              "想坐" not in grid["mid-left"],
              f"多选按区域计数：前左 3 / 前中 2 / 前右 1 / 中左 0（实际 {grid}）")

        await tick(page, "front-center", checked=False)
        cfg = await saved_config(page)
        check(zpref(cfg, "s5") == ["front-left", "front-right"],
              f"取消勾选 ⇒ 数组缩回 2 个（实际 {zpref(cfg, 's5')!r}）")

        # ═══ 16~20. 避开多选 + 交集校验 + 清空 ═══
        print("=== 16~20. 避开多选 / 冲突 / 清空 ===")
        await toggle_field(page, 4, "zoneAvoid")
        pickers = await page.locator(".zone-popup .zone-picker").count()
        field = await page.locator(".zone-popup .zone-picker").get_attribute("data-field")
        check(pickers == 1 and field == "zoneAvoid",
              f"切到避开 ⇒ 旧面板收起、只剩 1 个且 data-field 正确（{pickers}/{field}）")

        await tick(page, "back-left")
        await tick(page, "back-right")
        cfg = await saved_config(page)
        check(zavoid(cfg, "s5") == ["back-left", "back-right"],
              f"避开也支持 2 个区域（实际 {zavoid(cfg, 's5')!r}）")

        DIALOGS.clear()
        await tick(page, "front-left")   # 已在倾向里 ⇒ 应被拒
        cfg = await saved_config(page)
        cb_checked = await page.locator(
            '.zone-popup .zone-picker .zone-pick-cell[data-zone-id="front-left"] input'
        ).is_checked()
        check(not cb_checked and zavoid(cfg, "s5") == ["back-left", "back-right"]
              and any("同一" in d for d in DIALOGS),
              f"交集被拦：alert + checkbox 回退 + 配置不变"
              f"（checked={cb_checked} avoid={zavoid(cfg, 's5')!r} dialogs={DIALOGS}）")

        await toggle_field(page, 4, "zonePref")
        DIALOGS.clear()
        await tick(page, "back-left")    # 已在避开里 ⇒ 反向也要拦
        cfg = await saved_config(page)
        cb_checked = await page.locator(
            '.zone-popup .zone-picker .zone-pick-cell[data-zone-id="back-left"] input'
        ).is_checked()
        check(not cb_checked and "back-left" not in zpref(cfg, "s5")
              and any("同一" in d for d in DIALOGS),
              "反向交集同样被拦（倾向里勾已避开的区域）")

        await page.locator(".zone-popup .zone-pick-clear").click()
        await page.wait_for_timeout(220)
        cfg = await saved_config(page)
        st5 = await row_state(page, 4)
        check(zpref(cfg, "s5") == [] and st5["prefText"] == "未设置",
              f"清空 ⇒ 数组归零且触发器回「未设置」（实际 {zpref(cfg, 's5')!r}/{st5['prefText']!r}）")

        # 落盘后顺带确认旧配置已被 migrate 升级为数组
        check(zpref(cfg, "s4") == ["front-left"],
              f"旧单值字符串经 migrate 落盘为数组（实际 {zpref(cfg, 's4')!r}）")

        # ═══ 21~22. 收起行为 / Esc ═══
        print("=== 21~22. 收起与 Esc ===")
        await page.locator(".zone-popup .zone-hint").click()
        await page.wait_for_timeout(180)
        check(await page.locator(".zone-popup .zone-picker").count() == 0,
              "点击面板外自动收起")

        await toggle_field(page, 4, "zoneAvoid")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)
        picker_after = await page.locator(".zone-popup .zone-picker").count()
        popup_after = await page.locator(".zone-popup").count()
        check(picker_after == 0 and popup_after == 1,
              f"第一次 Esc 只收起面板、弹窗保留（picker={picker_after} popup={popup_after}）")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        check(await page.locator(".zone-popup").count() == 0,
              "第二次 Esc 关闭整个弹窗")

        # ═══ 23. 持久化 ═══
        print("=== 23. 刷新后持久化 ===")
        await page.wait_for_timeout(700)   # 等 autoSave 防抖
        await page.reload(wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(1300)
        cfg = await saved_config(page)
        check(zpref(cfg, "s5") == [] and zavoid(cfg, "s5") == ["back-left", "back-right"],
              f"刷新后多选数组完整保留（实际 {zpref(cfg, 's5')!r}/{zavoid(cfg, 's5')!r}）")

        # ═══ 24. 键盘可达 ═══
        print("=== 24. 键盘可达 ===")
        await open_zone_popup(page)
        await toggle_field(page, 4, "zonePref")
        # 面板打开时焦点应落在第一个 checkbox 上，直接空格即可勾选
        await page.keyboard.press("Space")
        await page.wait_for_timeout(220)
        cfg = await saved_config(page)
        check("front-left" in list(zpref(cfg, "s5") or []),
              f"键盘空格可勾选（实际 {zpref(cfg, 's5')!r}）")
        await page.keyboard.press("Escape")
        await page.keyboard.press("Escape")

        # ═══ 25~26. 版本 + 控制台 ═══
        print("=== 25~26. 版本与控制台 ===")
        version = await page.locator("#appVersion").inner_text()
        check(version.strip() == "1.4.10", f"版本号 1.4.10（实际 {version!r}）")
        check(len(ERRORS) == 0, f"全程无 JS 报错（实际 {ERRORS[:3]}）")

        await browser.close()

    print("\n" + "=" * 56)
    print(f"批次34 结果: {PASSED} 通过 / {FAILED} 失败")
    if ERRORS:
        print("控制台错误:")
        for e in ERRORS[:8]:
            print("  -", e)
    if FAILED:
        raise SystemExit(1)
    print("✅ 全部通过")


if __name__ == "__main__":
    asyncio.run(main())
