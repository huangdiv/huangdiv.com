# -*- coding: utf-8 -*-
"""
批次33 — 「按排名均衡分组」余数按组号倒序划归（v1.4.9）

需求:
  总人数不能被组数整除时，多出来的 r 人一律划归**排在后面的组**：
  1组、2组…只有 floor(N/G) 人，倒数第 r 个组起每组 floor(N/G)+1 人。
  旧实现让最后不足一批的人分给 slotOrder 的前 r 个组，而 slotOrder 按
  批次奇偶正/逆交替 ⇒ 偶数批时反而是前面的组多人（10人4组 ⇒ 3,3,2,2）。

断言(共 22 项):
  每个场景 3 项（组数+组名 / 人数精确 / 全部学生归属有效组），共 6 场景：
    A. 10 人 4 组 → [2,2,3,3]   ← 旧实现会给 [3,3,2,2]
    B. 14 人 4 组 → [3,3,4,4]   ← 奇数批，旧实现本就正确，验证不回归
    C.  9 人 4 组 → [2,2,2,3]   ← r=1，仅最后一组多人
    D. 13 人 5 组 → [2,2,3,3,3] ← r=3
    E. 12 人 4 组 → [3,3,3,3]   ← 整除，蛇形完全不变
    F. 17 人 6 组 → [2,3,3,3,3,3] ← r=G-1，仅第一组是 q 人
  另加 4 项：
   19. 同一场景重复点击结果完全一致（确定性）
   20. 按钮 title 说明「人数不整除时多出的人分给排在后面的组」
   21. 版本号 1.4.9
   22. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
然后:
  python .workbuddy/smoke_test_batch33_balance_remainder.py
"""
import asyncio
import json

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"
PASSED = 0
FAILED = 0
ERRORS = []

FAKE_XLSX = """window.XLSX = {
    read: function () { return { SheetNames: [], Sheets: {} }; },
    utils: { sheet_to_json: function () { return []; } }
};"""
FAKE_H2C = "window.html2canvas = () => Promise.reject(new Error('stub'));"

ROWS, COLS = 8, 8
NAMES = ["张伟", "李娜", "王强", "赵敏", "孙悦", "陈晨", "刘洋", "周婷",
         "吴磊", "郑爽", "钱进", "冯巩", "蒋欣", "韩磊", "沈月", "许巍", "何炅"]

# (说明, 学生数 N, 组数 G, 期望各组人数)
CASES = [
    ("A. 10 人 4 组（余数批为偶数批，旧逻辑反例）", 10, 4, [2, 2, 3, 3]),
    ("B. 14 人 4 组（余数批为奇数批，回归）", 14, 4, [3, 3, 4, 4]),
    ("C.  9 人 4 组（r=1）", 9, 4, [2, 2, 2, 3]),
    ("D. 13 人 5 组（r=3）", 13, 5, [2, 2, 3, 3, 3]),
    ("E. 12 人 4 组（整除，蛇形不变）", 12, 4, [3, 3, 3, 3]),
    ("F. 17 人 6 组（r=G-1）", 17, 6, [2, 3, 3, 3, 3, 3]),
]


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


def make_config(n):
    students = []
    for i in range(n):
        students.append({
            "id": f"s{i+1}", "name": NAMES[i % len(NAMES)] + (str(i + 1) if i >= len(NAMES) else ""),
            "groupId": None, "checkedIn": False, "gender": "", "tags": [],
            "rank": i + 1, "zonePref": "", "zoneAvoid": ""
        })
    seats = [None] * (ROWS * COLS)
    for i in range(n):
        seats[i] = f"s{i+1}"
    return {
        "title": "批次33-余数倒序划归",
        "rows": ROWS, "cols": COLS,
        "seats": seats,
        "students": students,
        "groups": [],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "showPairLinks": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "version": "1.4.9",
    }


async def read_config(page):
    return await page.evaluate("() => JSON.parse(localStorage.getItem('classroomConfig') || '{}')")


async def mount(page, cfg):
    await page.evaluate(
        "cfg => localStorage.setItem('classroomConfig', JSON.stringify(cfg))", cfg)
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(1150)


def summarize(cfg):
    gids = [g["id"] for g in cfg.get("groups", [])]
    gnames = [g["name"] for g in cfg.get("groups", [])]
    counts = {gid: 0 for gid in gids}
    valid = set(gids)
    assigned = 0
    dangling = 0
    for s in cfg.get("students", []):
        gid = s.get("groupId")
        if gid in valid:
            counts[gid] += 1
            assigned += 1
        elif gid:
            dangling += 1
    return gids, gnames, [counts[g] for g in gids], assigned, dangling


async def main():
    global PASSED, FAILED

    prompt_value = {"g": "4"}

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)

        async def on_dialog(dialog):
            if dialog.type == "prompt":
                await dialog.accept(prompt_value["g"])
            else:
                await dialog.accept()

        page.on("dialog", on_dialog)

        await page.route("**/xlsx.full.min.js",
                         lambda r: r.fulfill(status=200,
                                             content_type="application/javascript; charset=utf-8",
                                             body=FAKE_XLSX))
        await page.route("**/html2canvas*.js",
                         lambda r: r.fulfill(status=200,
                                             content_type="application/javascript; charset=utf-8",
                                             body=FAKE_H2C))
        await page.add_init_script(
            "if (!sessionStorage.getItem('__seeded33')) {"
            "  localStorage.setItem('classroomConfig', %s);"
            "  sessionStorage.setItem('__seeded33', '1');"
            "}" % json.dumps(json.dumps(make_config(CASES[0][1]), ensure_ascii=False)))

        await page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(1400)

        first_counts = None
        for label, n, g, expected in CASES:
            print(f"=== {label} → 期望 {expected} ===")
            await mount(page, make_config(n))
            prompt_value["g"] = str(g)
            await page.click("#balanceGroupBtn")
            await page.wait_for_timeout(1150)
            cfg = await read_config(page)
            gids, gnames, counts, assigned, dangling = summarize(cfg)

            check(len(gids) == g and gnames == [f"{i+1}组" for i in range(g)],
                  f"{label}: 分成 {g} 组且命名 1组…{g}组（实际 {gnames}）")
            check(counts == expected,
                  f"{label}: 各组人数 {expected}（实际 {counts}）")
            check(assigned == n and dangling == 0 and all(c > 0 for c in counts),
                  f"{label}: {n} 名学生全部归属有效组、无空组/悬空引用"
                  f"（assigned={assigned}, dangling={dangling}）")

            if label.startswith("A."):
                first_counts = counts
                # ═══ 19. 重复点击确定性 ═══
                print("=== 19. 重复点击确定性 ===")
                await page.click("#balanceGroupBtn")
                await page.wait_for_timeout(1150)
                again = summarize(await read_config(page))[2]
                check(again == first_counts,
                      f"再点一次各组人数不变（{first_counts} → {again}）")

        # ═══ 20. 按钮 title ═══
        print("=== 20. 按钮说明 ===")
        title = await page.get_attribute("#balanceGroupBtn", "title")
        check(title is not None and "多出的人分给排在后面的组" in title,
              f"按钮 title 说明余数划归规则（实际 {title}）")

        # ═══ 21. 版本号 ═══
        print("=== 21. 版本号 ===")
        version = (await page.text_content("#appVersion") or "").strip()
        check(version == "1.4.9", f"版本号 1.4.9（实际 {version}）")

        # ═══ 22. 无 JS 报错 ═══
        print("=== 22. 控制台 ===")
        check(len(ERRORS) == 0, f"全程无 JS 报错（实际 {len(ERRORS)} 条: {ERRORS[:3]}）")

        await browser.close()

    print("\n" + "=" * 46)
    print(f"批次33 结果: {PASSED} 通过 / {FAILED} 失败")
    if FAILED:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
