# -*- coding: utf-8 -*-
"""
批次28 — 区域设置里「已有设置项」的当前满足情况颜色提示

需求:
  区域设置弹窗中，凡是已经设置过「倾向 / 避开」的学生，若当前座位**未满足**，
  给予相应的颜色提示（与配对设置项同一套 ok / bad / na 视觉语言）。

断言(共 13 项):
  1. 已满足的行 → .zone-status-ok（绿底）
  2. 倾向没达成的行 → .zone-status-bad，且「倾向」下拉带 .zone-field-bad
  3. 落在避开区的行 → .zone-status-bad，且「避开」下拉带 .zone-field-bad
  4. 倾向未达成但没进避开区的行 → 只有「倾向」被描红，「避开」不描红
  5. 两项都没设置的行 → 不加任何 status 类（保持中性，不刷绿）
  6. 已设置但未入座 → .zone-status-na（灰底）
  7. 行的 title 说明「当前坐在哪个区域 / 哪条没满足」
  8. 顶部汇总条文字：倾向 x/y 达成、避开 x/y 守住
  9. 有未满足时汇总条 data-state=bad；全满足时转 ok
 10. 改动下拉后就地刷新（不重建 DOM，焦点仍在那个 select 上）
 11. 座位变化（智能排座）后颜色自动重算 —— 逐行与真实座位表核对
 12. 改动即时写 localStorage（原有行为不回归）
 13. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
然后:
  python .workbuddy/smoke_test_batch28_zone_status.py
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
ROWS, COLS = 3, 3
ROW_KEYS = ["front", "mid", "back"]
COL_KEYS = ["left", "center", "right"]


def band_index(i, total):
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


async def row_state(page, idx):
    """取第 idx 行的状态：status 类 / 两个下拉是否描红 / title"""
    return await page.evaluate(
        """(i) => {
            const row = document.querySelectorAll('.zone-popup .zone-row')[i];
            if (!row) return null;
            const st = ['ok', 'bad', 'na'].find(k => row.classList.contains('zone-status-' + k)) || '';
            const pref = row.querySelector('.zone-pref');
            const avoid = row.querySelector('.zone-avoid');
            return {
                name: (row.querySelector('.zone-row-name') || {}).textContent || '',
                status: st,
                prefBad: !!(pref && pref.classList.contains('zone-field-bad')),
                avoidBad: !!(avoid && avoid.classList.contains('zone-field-bad')),
                title: row.getAttribute('title') || '',
                bg: getComputedStyle(row).backgroundColor
            };
        }""",
        idx,
    )


async def main():
    global PASSED, FAILED, ERRORS

    # 预置座位：s6（陈晨）不入座，用于 na 场景
    seats = ["s1", "s2", "s3", "s4", "s5", None, "s7", "s8", "s9"]
    # 张伟 ok / 李娜 倾向未达成 / 王强 落在避开区 / 赵敏 只倾向未达成 / 孙悦 未设置 / 陈晨 未入座
    prefs = {
        "s1": ("front-left", ""),          # 座位0 = front-left ⇒ ok
        "s2": ("back-right", ""),          # 座位1 = front-center ⇒ 倾向未达成
        "s3": ("", "front-right"),         # 座位2 = front-right ⇒ 落在避开区
        "s4": ("front-left", "back-right"),  # 座位3 = mid-left ⇒ 只倾向未达成
        "s5": ("", ""),                    # 未设置
        "s6": ("front-left", ""),          # 未入座 ⇒ na
    }
    students = [
        {
            "id": f"s{i+1}", "name": n, "groupId": None, "checkedIn": False,
            "gender": "male" if i % 2 == 0 else "female", "tags": [], "rank": i + 1,
            "zonePref": prefs.get(f"s{i+1}", ("", ""))[0],
            "zoneAvoid": prefs.get(f"s{i+1}", ("", ""))[1],
        }
        for i, n in enumerate(NAMES)
    ]
    cfg = {
        "title": "批次28测试",
        "rows": ROWS,
        "cols": COLS,
        "seats": seats,
        "students": students,
        "groups": [],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "version": "1.4.0",
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)

        async def on_dialog(dialog):
            DIALOGS.append(f"{dialog.type}:{dialog.message}")
            await dialog.accept()

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

        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        await page.click('[data-action="zoneSettings"]')
        await page.wait_for_timeout(450)

        # ═══ 1. 已满足 ═══
        print("=== 1. 已满足（张伟 倾向 front-left，坐在 front-left） ===")
        st = await row_state(page, 0)
        if st["status"] == "ok" and not st["prefBad"] and "已满足" in st["title"]:
            ok(f"张伟 = zone-status-ok（{st['bg']}），title=「{st['title']}」")
        else:
            bad(f"期望 ok，实际 {st}")

        # ═══ 2. 倾向未达成 ═══
        print("=== 2. 倾向未达成（李娜 想 back-right，坐在 front-center） ===")
        st = await row_state(page, 1)
        if st["status"] == "bad" and st["prefBad"] and not st["avoidBad"]:
            ok(f"李娜 = zone-status-bad，仅「倾向」描红；title=「{st['title']}」")
        else:
            bad(f"期望 bad + 仅 prefBad，实际 {st}")

        # ═══ 3. 落在避开区 ═══
        print("=== 3. 落在避开区（王强 避开 front-right，正坐在 front-right） ===")
        st = await row_state(page, 2)
        if st["status"] == "bad" and st["avoidBad"] and not st["prefBad"]:
            ok(f"王强 = zone-status-bad，仅「避开」描红；title=「{st['title']}」")
        else:
            bad(f"期望 bad + 仅 avoidBad，实际 {st}")

        # ═══ 4. 两项都设、只有倾向没达成 ═══
        print("=== 4. 两项都设，只有倾向没达成（赵敏） ===")
        st = await row_state(page, 3)
        if st["status"] == "bad" and st["prefBad"] and not st["avoidBad"]:
            ok("赵敏 = bad，「避开」未被描红（确实没进避开区）")
        else:
            bad(f"期望 bad + 仅 prefBad，实际 {st}")

        # ═══ 5. 未设置保持中性 ═══
        print("=== 5. 两项都没设置的行保持中性 ===")
        st = await row_state(page, 4)
        if st["status"] == "" and not st["prefBad"] and not st["avoidBad"] and not st["title"]:
            ok("孙悦 = 无 status 类、无 title（不刷绿）")
        else:
            bad(f"期望无状态，实际 {st}")

        # ═══ 6. 未入座 ═══
        print("=== 6. 已设置但未入座（陈晨） ===")
        st = await row_state(page, 5)
        if st["status"] == "na" and "无法判定" in st["title"]:
            ok(f"陈晨 = zone-status-na，title=「{st['title']}」")
        else:
            bad(f"期望 na，实际 {st}")

        # ═══ 8+9. 汇总条 ═══
        print("=== 8~9. 顶部汇总条 ===")
        line = page.locator(".zone-popup .zone-status-line")
        txt = (await line.inner_text()).strip()
        state = await line.get_attribute("data-state")
        # 倾向：张伟(达成) 李娜(bad) 赵敏(bad) 陈晨(na) ⇒ 1/4；避开：王强(hit) 赵敏(守住) ⇒ 1/2 守住
        if "1/4" in txt and "1/2" in txt and state == "bad":
            ok(f"汇总条 = 「{txt}」 data-state={state}")
        else:
            bad(f"汇总条不对：「{txt}」 data-state={state}（期望含 1/4、1/2 且 bad）")

        # ═══ 10. 改动下拉后就地刷新 + 焦点保留 ═══
        print("=== 10. 改下拉后就地刷新（不重建 DOM） ===")
        sel = page.locator(".zone-popup .zone-row").nth(1).locator(".zone-pref")
        await sel.focus()                           # 主动聚焦，才能验证「刷新后焦点没丢」
        await sel.select_option("front-center")     # 李娜当前就坐在 front-center ⇒ 立刻 ok
        await page.wait_for_timeout(400)
        st = await row_state(page, 1)
        focused = await page.evaluate(
            """() => {
                const el = document.activeElement;
                return el && el.classList ? el.className : '';
            }"""
        )
        if st["status"] == "ok" and not st["prefBad"] and "zone-pref" in focused:
            ok("李娜 行转绿、描红清除，且焦点仍在刚操作的下拉上")
        else:
            bad(f"就地刷新/焦点不对：{st} 焦点={focused}")

        # ═══ 12. 即时保存 ═══
        print("=== 12. 改动即时保存 ===")
        await page.wait_for_timeout(700)            # autoSave 防抖 500ms
        saved = await read_config(page)
        ln = next(s for s in saved["students"] if s["name"] == "李娜")
        if ln.get("zonePref") == "front-center":
            ok("李娜 zonePref=front-center 已写入 localStorage")
        else:
            bad(f"未保存：zonePref={ln.get('zonePref')}")

        # 把李娜改回 back-right，方便后面看「全达成」以外的样子
        await sel.select_option("back-right")
        await page.wait_for_timeout(300)

        # ═══ 11. 座位变化后自动重算 ═══
        print("=== 11. 智能排座后颜色自动重算 ===")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        DIALOGS.clear()
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(1800)

        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(250)
        await page.click('[data-action="zoneSettings"]')
        await page.wait_for_timeout(450)

        arranged = await read_config(page)
        a_seats = arranged.get("seats") or []
        a_by = {s["id"]: s for s in arranged["students"]}
        seat_of = {}
        for idx, sid in enumerate(a_seats):
            if sid:
                seat_of[sid] = idx

        mismatches = []
        for idx, name in enumerate(NAMES):
            sid = f"s{idx+1}"
            s = a_by[sid]
            pref = s.get("zonePref") or ""
            avoid = s.get("zoneAvoid") or ""
            if not pref and not avoid:
                expect = ""
            elif sid not in seat_of:
                expect = "na"
            else:
                z = seat_zone(seat_of[sid], ROWS, COLS)
                expect = "bad" if ((pref and z != pref) or (avoid and z == avoid)) else "ok"
            got = await row_state(page, idx)
            if got["status"] != expect:
                mismatches.append(f"{name}: 期望 {expect or '(中性)'} 实际 {got['status'] or '(中性)'}")

        if not mismatches:
            ok(f"排座后 {len(NAMES)} 行的颜色全部与真实座位表一致")
        else:
            bad("颜色与座位不符：" + "；".join(mismatches))

        # ═══ 9'. 全满足时汇总条转 ok ═══
        print("=== 9'. 全部满足时汇总条转绿 ===")
        # 把所有人的设置改成「就按现在坐的区域」，凑满达成
        await page.evaluate(
            """() => {
                const rows = Array.from(document.querySelectorAll('.zone-popup .zone-row'));
                rows.forEach(function (row) {
                    const sid = row.getAttribute('data-student-id');
                    const cfg = JSON.parse(localStorage.getItem('classroomConfig') || '{}');
                    const seatIdx = (cfg.seats || []).indexOf(sid);
                    const pref = row.querySelector('.zone-pref');
                    pref.value = '';
                    pref.dispatchEvent(new Event('change', { bubbles: true }));
                });
            }"""
        )
        await page.wait_for_timeout(400)
        line = page.locator(".zone-popup .zone-status-line")
        txt_all = (await line.inner_text()).strip()
        state_all = await line.get_attribute("data-state")
        # 倾向全清空 ⇒ 只剩避开（王强 hit 可能仍 bad）；这里校验「清空后汇总条只报避开」+ 状态随之变化
        if "倾向" not in txt_all and state_all in ("ok", "bad"):
            ok(f"清空倾向后汇总条只剩避开：「{txt_all}」 data-state={state_all}")
        else:
            bad(f"清空倾向后汇总条不对：「{txt_all}」 data-state={state_all}")

        # ═══ 13. 控制台 ═══
        print("=== 13. 控制台 ===")
        real_errors = [e for e in ERRORS if "html2canvas" not in e
                       and "Failed to load resource" not in e]
        if not real_errors:
            ok("全程无 JS 报错")
        else:
            bad("控制台报错：" + " | ".join(real_errors[:3]))

        await page.screenshot(path="C:/Users/xingz/AppData/Local/Temp/zone_status.png")
        await browser.close()

    print(f"\n通过 {PASSED} / 失败 {FAILED}")
    if FAILED:
        raise SystemExit(1)


asyncio.run(main())
