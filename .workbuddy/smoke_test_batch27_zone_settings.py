# -*- coding: utf-8 -*-
"""
批次27 — 智能排座「区域设置」(九宫格倾向/避开) + 配对选择框自绘紧凑下拉

需求:
  1. 4 个配对选择框的候选列表：把「第几名」放到名字右侧，并降低列表项高度，
     以便一屏看到更多候选；
  2. 智能排座新增「区域设置」：可逐生设置「倾向区域」（尽量安排进去）和
     「避开区域」（尽量不安排进去）；教室按行列三等分划成 9 个区域
     （前左…后右）。

断言(共 15 项):
  1. 智能排座下拉里有「区域设置」菜单项
  2. 弹窗打开后：9 个区域格、表头、学生行数 = 名单人数
  3. 设置「倾向区域」→ 立即写入 localStorage（zonePref）
  4. 菜单项角标显示已设置人数 [n]
  5. 区域格计数随设置更新（前左显示「1 想坐」）
  6. 倾向与避开设成同一区域 → 被拒绝（alert），且下拉回退到原值
  7. 点「智能排座」后，设了「倾向」的学生确实落在该区域
  8. 设了「避开」的学生确实不在该区域
  9. 配对候选每项行高 ≤ 26px（原生 datalist 之前约 30px+，一屏装不下几项）
 10. 配对候选项结构：姓名在左、名次在右（.psi-name / .psi-rank）
 11. 配对候选支持按姓名过滤（输入片段只剩匹配项）
 12. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
然后:
  python .workbuddy/smoke_test_batch27_zone_settings.py
"""
import asyncio
import json

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

PASSED = 0
FAILED = 0
ERRORS = []
DIALOGS = []

FAKE_XLSX_LIB = """
window.XLSX = {
    read: function () { return { SheetNames: [], Sheets: {} }; },
    utils: { sheet_to_json: function () { return []; } }
};
"""

FAKE_HTML2CANVAS = """
window.html2canvas = function () {
    return Promise.reject(new Error('html2canvas stub in smoke test'));
};
"""

NAMES = ["张伟", "李娜", "王强", "赵敏", "孙悦", "陈晨", "周杰", "吴昊", "郑爽"]

ROWS = 3
COLS = 3

ROW_KEYS = ["front", "mid", "back"]
COL_KEYS = ["left", "center", "right"]


def band_index(i, total):
    """与 modules/zone.js 的 bandIndex 保持一致"""
    if total <= 1:
        return 1
    if total == 2:
        return 0 if i <= 0 else 2
    return min(2, (i * 3) // total)


def seat_zone(index, rows, cols):
    r, c = index // cols, index % cols
    return ROW_KEYS[band_index(r, rows)] + "-" + COL_KEYS[band_index(c, cols)]


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


async def read_config(page):
    return await page.evaluate(
        "() => JSON.parse(localStorage.getItem('classroomConfig') || '{}')")


async def main():
    global PASSED, FAILED, ERRORS

    students = [
        {"id": f"s{i+1}", "name": n, "groupId": None, "checkedIn": False,
         "gender": "male" if i % 2 == 0 else "female", "tags": [], "rank": i + 1,
         "zonePref": "", "zoneAvoid": ""}
        for i, n in enumerate(NAMES)
    ]
    cfg = {
        "title": "批次27测试",
        "rows": ROWS,
        "cols": COLS,
        "seats": [None] * (ROWS * COLS),
        "students": students,
        "groups": [],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "version": "1.3.5",
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)

        async def on_dialog(dialog):
            DIALOGS.append(f"{dialog.type}:{dialog.message}")
            await dialog.accept()      # 排座确认 / 冲突提示一律接受

        page.on("dialog", on_dialog)

        await page.route(
            "**/xlsx.full.min.js",
            lambda route: route.fulfill(
                status=200,
                content_type="application/javascript; charset=utf-8",
                body=FAKE_XLSX_LIB,
            ),
        )
        await page.route(
            "**/html2canvas*.js",
            lambda route: route.fulfill(
                status=200,
                content_type="application/javascript; charset=utf-8",
                body=FAKE_HTML2CANVAS,
            ),
        )
        await page.add_init_script(
            "localStorage.setItem('classroomConfig', %s);"
            % json.dumps(json.dumps(cfg, ensure_ascii=False))
        )
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_timeout(1200)

        # ═══ 1. 菜单项 ═══
        print("=== 1. 智能排座下拉里有「区域设置」 ===")
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        item = page.locator('[data-action="zoneSettings"]')
        if await item.count() == 1 and await item.is_visible():
            ok("菜单项「区域设置」存在：" + (await item.inner_text()).strip())
        else:
            bad("智能排座下拉里没有「区域设置」菜单项")

        # ═══ 2. 弹窗结构 ═══
        print("=== 2. 弹窗结构 ===")
        await item.click()
        await page.wait_for_timeout(400)
        popup = page.locator(".zone-popup")
        cells = await page.locator(".zone-popup .zone-cell").count()
        rows = await page.locator(".zone-popup .zone-row").count()
        heads = await page.locator(".zone-popup .zone-head span").count()
        if cells == 9 and rows == len(NAMES) and heads == 4:
            ok(f"9 个区域格 / {rows} 行学生 / 4 列表头")
        else:
            bad(f"结构不对：区域格 {cells}（期望 9）、学生行 {rows}（期望 {len(NAMES)}）、表头 {heads}")

        # ═══ 3. 设置倾向 → 立即保存 ═══
        print("=== 3. 设置倾向区域并即时保存 ===")
        row0 = page.locator(".zone-popup .zone-row").nth(0)   # 张伟 rank1
        await row0.locator(".zone-pref").select_option("front-left")
        await page.wait_for_timeout(800)
        saved = await read_config(page)
        z0 = next(s for s in saved.get("students", []) if s["name"] == "张伟")
        if z0.get("zonePref") == "front-left":
            ok("张伟 zonePref=front-left 已写入 localStorage")
        else:
            bad(f"未保存：zonePref={z0.get('zonePref')}")

        # ═══ 4. 菜单角标 ═══
        print("=== 4. 菜单项角标 ===")
        label = await page.inner_text('[data-action="zoneSettings"] .zone-settings-label')
        if "[1]" in label:
            ok(f"菜单项文字 = {label.strip()}")
        else:
            bad(f"角标不对：{label.strip()}（期望包含 [1]）")

        # 再设两个：李娜 倾向 back-right、王强 避开 front-left
        await page.locator(".zone-popup .zone-row").nth(1).locator(".zone-pref").select_option("back-right")
        await page.wait_for_timeout(200)
        await page.locator(".zone-popup .zone-row").nth(2).locator(".zone-avoid").select_option("front-left")
        await page.wait_for_timeout(200)
        await page.locator(".zone-popup .zone-row").nth(3).locator(".zone-avoid").select_option("back-center")
        await page.wait_for_timeout(500)

        # ═══ 5. 区域格计数 ═══
        print("=== 5. 区域格计数更新 ===")
        cell_txt = await page.inner_text('.zone-popup .zone-cell[data-zone-id="front-left"]')
        cell_txt2 = await page.inner_text('.zone-popup .zone-cell[data-zone-id="back-right"]')
        if "想坐" in cell_txt and "避开" in cell_txt and "想坐" in cell_txt2:
            ok("前左 = " + " ".join(cell_txt.split()) + "；后右 = " + " ".join(cell_txt2.split()))
        else:
            bad(f"区域格计数没更新：前左「{cell_txt}」后右「{cell_txt2}」")

        # ═══ 6. 倾向/避开同一个区域 → 拒绝 ═══
        print("=== 6. 倾向与避开冲突被拒 ===")
        before = await read_config(page)
        b0 = next(s for s in before["students"] if s["name"] == "张伟")
        DIALOGS.clear()
        await page.locator(".zone-popup .zone-row").nth(0).locator(".zone-avoid").select_option("front-left")
        await page.wait_for_timeout(500)
        after = await read_config(page)
        a0 = next(s for s in after["students"] if s["name"] == "张伟")
        avoid_value = await page.locator(".zone-popup .zone-row").nth(0).locator(".zone-avoid").input_value()
        if (a0.get("zoneAvoid") == "" and avoid_value == ""
                and any("冲突" in d or "同一" in d for d in DIALOGS)):
            ok("冲突被拒：zoneAvoid 未写入、下拉已回退，提示=" + DIALOGS[-1][:24])
        else:
            bad(f"冲突没被拦住：zoneAvoid={a0.get('zoneAvoid')} 下拉={avoid_value} 弹窗={DIALOGS}")

        # 关掉弹窗
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)

        # ═══ 7~8. 智能排座后区域偏好生效 ═══
        print("=== 7~8. 智能排座后区域偏好生效 ===")
        DIALOGS.clear()
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(1500   )
        arranged = await read_config(page)
        seats = arranged.get("seats") or []
        by_id = {s["id"]: s for s in arranged["students"]}
        seat_of = {}
        for idx, sid in enumerate(seats):
            if sid:
                seat_of[sid] = idx

        def zone_of_name(name):
            for sid, s in by_id.items():
                if s["name"] == name and sid in seat_of:
                    return seat_zone(seat_of[sid], ROWS, COLS)
            return None

        zhang = zone_of_name("张伟")
        li = zone_of_name("李娜")
        wang = zone_of_name("王强")
        if zhang == "front-left":
            ok(f"张伟（倾向前左）落在 {zhang}")
        else:
            bad(f"张伟应当在 front-left，实际 {zhang}")

        if li == "back-right":
            ok(f"李娜（倾向后右）落在 {li}")
        else:
            bad(f"李娜应当在 back-right，实际 {li}")

        # 避开是「尽量」，但 9 人 9 座里这两个区域各只有 1 个座位 ⇒ 必然能满足
        if wang is not None and wang != "front-left":
            ok(f"王强（避开前左）落在 {wang}")
        else:
            bad(f"王强不应在 front-left，实际 {wang}")

        zhao = zone_of_name("赵敏")
        if zhao is not None and zhao != "back-center":
            ok(f"赵敏（避开后中）落在 {zhao}")
        else:
            bad(f"赵敏不应在 back-center，实际 {zhao}")

        # ═══ 9~11. 配对候选下拉 ═══
        print("=== 9~11. 配对候选下拉 ===")
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(200)
        await page.click('[data-action="pairSettings"]')
        await page.wait_for_timeout(400)
        inp = page.locator(".pair-forced-a")
        await inp.click()
        await page.wait_for_timeout(300)

        metrics = await page.evaluate("""() => {
            const list = document.querySelector('.pair-suggest:not([hidden])');
            const items = list ? Array.prototype.slice.call(list.querySelectorAll('.pair-suggest-item')) : [];
            const h = items.length ? Math.round(items[0].getBoundingClientRect().height) : null;
            const first = items[0];
            return {
                count: items.length,
                itemH: h,
                name: first ? first.querySelector('.psi-name').textContent : null,
                rank: first ? first.querySelector('.psi-rank').textContent : null,
                listH: list ? Math.round(list.getBoundingClientRect().height) : null,
            };
        }""")

        if metrics["itemH"] is not None and metrics["itemH"] <= 26:
            ok(f"候选行高 {metrics['itemH']}px，列表高 {metrics['listH']}px，共 {metrics['count']} 项")
        else:
            bad(f"候选行高 {metrics['itemH']}px，期望 ≤ 26px")

        if metrics["name"] == "张伟" and metrics["rank"] == "第1名":
            ok(f"第一项 = 姓名「{metrics['name']}」+ 右侧「{metrics['rank']}」")
        else:
            bad(f"候选项结构不对：name={metrics['name']} rank={metrics['rank']}")

        await inp.fill("李")
        await page.wait_for_timeout(300)
        filtered = await page.evaluate("""() => {
            const list = document.querySelector('.pair-suggest:not([hidden])');
            const items = list ? Array.prototype.slice.call(list.querySelectorAll('.pair-suggest-item')) : [];
            return items.map(el => el.querySelector('.psi-name').textContent);
        }""")
        if filtered == ["李娜"]:
            ok("输入「李」过滤后只剩：李娜")
        else:
            bad(f"过滤结果不对：{filtered}")

        # ═══ 13. 与「男女同桌」同时生效（区域偏好不许破坏性别硬约束）═══
        print("=== 13. 区域偏好 + 男女同桌 同时生效 ===")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        await page.click('.dropdown-switch-row[data-toggle="mixed"]')
        await page.wait_for_timeout(250)
        DIALOGS.clear()
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(1600)

        mixed_cfg = await read_config(page)
        m_seats = mixed_cfg.get("seats") or []
        gender_of = {s["id"]: s.get("gender") for s in mixed_cfg["students"]}
        violations = 0
        for r in range(ROWS):
            a = m_seats[r * COLS] if r * COLS < len(m_seats) else None
            b = m_seats[r * COLS + 1] if r * COLS + 1 < len(m_seats) else None
            if a and b:
                ga, gb = gender_of.get(a), gender_of.get(b)
                if ga in ("male", "female") and gb in ("male", "female") and ga == gb:
                    violations += 1

        m_seat_of = {}
        for idx, sid in enumerate(m_seats):
            if sid:
                m_seat_of[sid] = idx
        m_name_of = {s["id"]: s["name"] for s in mixed_cfg["students"]}
        zhang2 = None
        for sid, idx in m_seat_of.items():
            if m_name_of.get(sid) == "张伟":
                zhang2 = seat_zone(idx, ROWS, COLS)

        seated = len(m_seat_of)
        # 区域偏好是软约束：与「男女同桌」抢同一批座位时，**硬约束优先**，
        # 偏好没达成就少达成 —— 所以这里只校验硬约束与排座完整性。
        if violations == 0 and seated == len(NAMES):
            ok(f"0 桌性别违规、{seated}/{len(NAMES)} 人入座（张伟落点 {zhang2}，偏好让位给性别规则）")
        else:
            bad(f"性别违规 {violations} 桌 / 入座 {seated}/{len(NAMES)}")

        # ═══ 12. 控制台 ═══
        print("=== 12. 控制台 ===")
        if not ERRORS:
            ok("全程无 JS 报错")
        else:
            bad("控制台报错：" + " | ".join(ERRORS[:3]))

        await browser.close()

    print("\n" + "=" * 42)
    print(f"通过 {PASSED} / 失败 {FAILED}")
    return 0 if FAILED == 0 else 1


raise SystemExit(asyncio.run(main()))
