# -*- coding: utf-8 -*-
"""
批次32 — 「按组聚座」按每组人数各自取最紧凑矩形（v1.4.8）

需求:
  点击「按组聚座」后，每一组按**自己的实际人数**把座位收拢到最紧凑状态：
  主目标是「该组座位占据的总排数 + 总列数」最小；同等条件下空位更少、
  再同等优先更窄 ⇒ 6 人稳定得到 3 行 × 2 列：
  (1排1列)(1排2列)(2排1列)(2排2列)(3排1列)(3排2列)。
  其他组同理，各组形状彼此独立，不再共用「按最大组人数」算出的统一块。

断言(共 18 项):
  1. 起始座位是打散的（至少一组未达最优紧凑度），保证后续不是「本来就很紧凑」
  2. 点击后 6 人组精确占据 (1,1)(1,2)(2,1)(2,2)(3,1)(3,2)
  3. 6/4/2 人组的形状依次为 3×2 / 2×2 / 2×1
  4. 三种形状互不相同（不再共用统一块）
  5. 每组「行数+列数」等于该组人数的理论最优值 5 / 4 / 3
  6. 每组外接矩形无空洞，12 人全部入座且座位互不重叠
  7. 从左到右铺开：第 1 组在最左，后续组在其右侧
  8. 提示条列出各组「人数:形状」
  9. 按钮 title 说明「最紧凑」
 10. 再点一次结果完全一致（确定性、不抖动）
 11. 有未分组学生占座时，这些座位上的学生原地不动
 12. 有占座时 12 名分组学生仍全部入座
 13. 分组学生不占用被锁座位、彼此不重叠
 14. 有占座时每组仍达到理论最优紧凑度
 15. 人数差更大时（7/4/1 人）各组依次为 4×2 / 2×2 / 1×1
 16. 人数差很大时每组仍达最优行列和（旧算法会把 4 人组拉成 1×4）
 17. 版本号 1.4.8
 18. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
然后:
  python .workbuddy/smoke_test_batch32_group_compact.py
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
SIZES = [6, 4, 2]
IDEAL = {1: (1, 1, 2), 2: (2, 1, 3), 4: (2, 2, 4),
         5: (3, 2, 5), 6: (3, 2, 5), 7: (4, 2, 6)}

NAMES = ["张伟", "李娜", "王强", "赵敏", "孙悦", "陈晨",
         "刘洋", "周婷", "吴磊", "郑爽", "钱进", "冯巩"]
LOCKED_NAMES = ["未甲", "未乙", "未丙"]
LOCKED_SEATS = [0, 1, 8]


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


def make_config(locked=False, sizes=None):
    sizes = list(sizes or SIZES)
    students = []
    idx = 0
    for gi, size in enumerate(sizes):
        for _ in range(size):
            students.append({
                "id": f"s{idx+1}", "name": NAMES[idx], "groupId": f"g{gi+1}",
                "checkedIn": False, "gender": "male" if idx % 2 == 0 else "female",
                "tags": [], "rank": idx + 1, "zonePref": "", "zoneAvoid": ""
            })
            idx += 1
    if locked:
        for k, name in enumerate(LOCKED_NAMES):
            students.append({
                "id": f"u{k+1}", "name": name, "groupId": None,
                "checkedIn": False, "gender": "male", "tags": [],
                "rank": idx + k + 1, "zonePref": "", "zoneAvoid": ""
            })

    seats = [None] * (ROWS * COLS)
    if locked:
        for k, pos in enumerate(LOCKED_SEATS):
            seats[pos] = f"u{k+1}"
        scattered = [63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52]
    else:
        scattered = [0, 9, 18, 27, 36, 45, 54, 63, 3, 12, 21, 30]
    for k, sid in enumerate([f"s{i+1}" for i in range(sum(sizes))]):
        seats[scattered[k]] = sid

    return {
        "title": "批次32-按组最紧凑",
        "rows": ROWS, "cols": COLS,
        "seats": seats,
        "students": students,
        "groups": [
            {"id": f"g{i+1}", "name": f"{i+1}组",
             "color": ["#4f8ef7", "#f7a14f", "#5fc27e"][i % 3]}
            for i in range(len(sizes))
        ],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "showPairLinks": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "version": "1.4.8",
    }


def shape_of(indices):
    """返回 (rows, cols, area, span, r0, c0)，行列均为 1 基计数，r0/c0 为 0 基。"""
    if not indices:
        return (0, 0, 0, 0, 0, 0)
    rs = [i // COLS for i in indices]
    cs = [i % COLS for i in indices]
    r0, r1 = min(rs), max(rs)
    c0, c1 = min(cs), max(cs)
    rows, cols = r1 - r0 + 1, c1 - c0 + 1
    return (rows, cols, rows * cols, rows + cols, r0, c0)


def grouped_seats(cfg):
    group_of = {s["id"]: s.get("groupId") for s in cfg["students"] if s.get("groupId")}
    result = {g["id"]: [] for g in cfg["groups"]}
    for i, sid in enumerate(cfg["seats"]):
        if sid and sid in group_of and group_of[sid] in result:
            result[group_of[sid]].append(i)
    return result


async def read_config(page):
    return await page.evaluate("() => JSON.parse(localStorage.getItem('classroomConfig') || '{}')")


async def mount(page, cfg):
    await page.evaluate(
        "cfg => localStorage.setItem('classroomConfig', JSON.stringify(cfg))", cfg)
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(1100)


async def main():
    global PASSED, FAILED

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        await page.route("**/xlsx.full.min.js",
                         lambda r: r.fulfill(status=200,
                                             content_type="application/javascript; charset=utf-8",
                                             body=FAKE_XLSX))
        await page.route("**/html2canvas*.js",
                         lambda r: r.fulfill(status=200,
                                             content_type="application/javascript; charset=utf-8",
                                             body=FAKE_H2C))
        await page.add_init_script(
            "if (!sessionStorage.getItem('__seeded32')) {"
            "  localStorage.setItem('classroomConfig', %s);"
            "  sessionStorage.setItem('__seeded32', '1');"
            "}" % json.dumps(json.dumps(make_config(), ensure_ascii=False)))

        await page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(1400)

        # ═══ 1. 起始状态确实是打散的 ═══
        print("=== 1. 起始状态 ===")
        before = grouped_seats(await read_config(page))
        before_spans = {g: shape_of(v)[3] for g, v in before.items()}
        check(any(before_spans[g] > IDEAL[SIZES[i]][2] for i, g in enumerate(["g1", "g2", "g3"])),
              f"起始座位是打散的（span: {before_spans}）")

        # ═══ 2~6. 点击「按组聚座」═══
        print("=== 2~6. 按组聚座（6/4/2 人）===")
        await page.click("#arrangeGroupBtn")
        await page.wait_for_timeout(1100)
        cfg = await read_config(page)
        blocks = grouped_seats(cfg)
        shapes = {g: shape_of(v) for g, v in blocks.items()}

        check(blocks["g1"] == [0, 1, 8, 9, 16, 17],
              f"6 人组精确占据 3行×2列 的前三排前两列：{sorted(blocks['g1'])}")
        got = [(shapes[g][0], shapes[g][1]) for g in ["g1", "g2", "g3"]]
        check(got == [(3, 2), (2, 2), (2, 1)], f"三组形状依次为 3×2 / 2×2 / 2×1：{got}")
        check(len(set(got)) == 3, "三组形状互不相同（不再共用统一块）")
        spans = [shapes[g][3] for g in ["g1", "g2", "g3"]]
        check(spans == [5, 4, 3], f"每组行数+列数达到该人数最优值：{spans}")
        allidx = [i for v in blocks.values() for i in v]
        check(len(allidx) == 12 and len(set(allidx)) == 12
              and all(shapes[g][2] == len(blocks[g]) for g in blocks),
              "12 人全部入座、互不重叠、每组外接矩形无空洞")
        check(shapes["g2"][5] > shapes["g1"][5] and shapes["g3"][5] > shapes["g2"][5],
              f"从左到右铺开（c0: {[shapes[g][5] for g in ['g1','g2','g3']]}）")

        # ═══ 7. 提示文案 / 按钮说明 ═══
        print("=== 7. 提示文案 ===")
        toast = (await page.locator(".stat-toast").text_content() or "").strip()
        title = await page.get_attribute("#arrangeGroupBtn", "title")
        check("各组按人数收拢" in toast and "6人:3行×2列" in toast
              and "4人:2行×2列" in toast and "2人:2行×1列" in toast,
              f"提示条逐组给出人数与形状：{toast}")
        check("最紧凑" in (title or ""), f"按钮说明已更新：{title}")

        # ═══ 8. 再次点击结果不变 ═══
        print("=== 8. 幂等性 ===")
        await page.click("#arrangeGroupBtn")
        await page.wait_for_timeout(1100)
        cfg2 = await read_config(page)
        check(json.dumps(cfg["seats"], ensure_ascii=False) ==
              json.dumps(cfg2["seats"], ensure_ascii=False),
              "再次点击座位布局完全一致（确定性）")

        # ═══ 9~12. 有未分组学生占座 ═══
        print("=== 9~12. 未分组学生占座时 ===")
        locked_cfg = make_config(locked=True)
        await mount(page, locked_cfg)
        await page.click("#arrangeGroupBtn")
        await page.wait_for_timeout(1100)
        cfg3 = await read_config(page)
        blocks3 = grouped_seats(cfg3)
        shapes3 = {g: shape_of(v) for g, v in blocks3.items()}

        locked_ok = all(cfg3["seats"][pos] == f"u{k+1}" for k, pos in enumerate(LOCKED_SEATS))
        check(locked_ok, f"被占座位 {LOCKED_SEATS} 上的未分组学生原地不动："
                         f"{[cfg3['seats'][p] for p in LOCKED_SEATS]}")
        all3 = [i for v in blocks3.values() for i in v]
        grouped_ids = {s["id"] for s in cfg3["students"] if s.get("groupId")}
        seated_grouped = [sid for sid in cfg3["seats"] if sid in grouped_ids]
        check(len(seated_grouped) == 12 and len(set(seated_grouped)) == 12,
              f"12 名分组学生仍全部入座（实际 {len(seated_grouped)}）")
        check(all(i not in LOCKED_SEATS for i in all3) and len(all3) == len(set(all3)),
              "分组学生不占用被锁座位、彼此不重叠")
        spans3 = [shapes3[g][3] for g in ["g1", "g2", "g3"]]
        check(spans3 == [5, 4, 3], f"有占座时每组仍达最优紧凑度：{spans3}")

        # ═══ 15~16. 组人数差更大（7/4/1 人）═══
        # 旧算法会按最大组 7 人给所有组套 2×4 块 ⇒ 4 人组变成 1×4（span 5，非最优）。
        print("=== 15~16. 组人数差更大（7/4/1 人）===")
        alt_sizes = [7, 4, 1]
        await mount(page, make_config(sizes=alt_sizes))
        await page.click("#arrangeGroupBtn")
        await page.wait_for_timeout(1100)
        cfg4 = await read_config(page)
        blocks4 = grouped_seats(cfg4)
        shapes4 = [shape_of(blocks4[f"g{k+1}"]) for k in range(len(alt_sizes))]
        got4 = [(s[0], s[1]) for s in shapes4]
        check(got4 == [IDEAL[n][:2] for n in alt_sizes],
              f"7/4/1 人组依次为 4×2 / 2×2 / 1×1：{got4}")
        check([s[3] for s in shapes4] == [IDEAL[n][2] for n in alt_sizes],
              f"人数差很大时每组仍达最优行列和：{[s[3] for s in shapes4]}")

        # ═══ 17~18. 版本 + 无报错 ═══
        print("=== 17~18. 版本与控制台 ===")
        version = await page.evaluate(
            "() => (document.getElementById('appVersion') || {}).textContent || ''")
        check(version.strip() == "1.4.8", f"版本号 1.4.8（实际 {version!r}）")
        check(not ERRORS, f"全程无 JS 报错（{ERRORS[:3]}）")

        await browser.close()

    print("=" * 46)
    print(f"批次32 结果：{PASSED} 通过 / {FAILED} 失败")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
