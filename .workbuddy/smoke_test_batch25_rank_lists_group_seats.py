# -*- coding: utf-8 -*-
"""
批次25 — 名单统一按排名呈现 / 配对设置搜索 / 均衡分组时按组聚座 / 分组均衡系数

需求:
  1. 所有出现学生姓名列表的界面，以及导出名单/Excel，默认按排名顺序呈现；
  2. 「配对设置」下的选择学生框，增强为可输入姓名搜索；
  3. 「按排名均衡分组」决策过程中同时按组聚座（同组学生坐成一个矩形块，
     块内行数与列数之差尽量不超过 2）；
  4. 分组设置下、分组模式下显示各分组的「均衡系数」，便于横向对比。

断言(共 16 项):
  1. 未入座名单按排名升序（DOM 顺序 === 期望顺序）
  2. 详细设置栏按排名升序
  3. 统计块 → 下载 Excel：表头首列为「排名」
  4. 导出的行按排名升序，且排名等于期望值
  5. 配对设置是「输入框」而不是下拉（4 个 .pair-search-input）
  6. 配对候选（自绘下拉 .pair-suggest）按排名升序
  7. 输入姓名片段 + 回车 → 成功添加配对（自动补全为完整姓名）
  8. 输入不存在的姓名 → 不添加、且给出提示
  9. 按排名均衡分组：3 组、每组 4 人
 10. 每组座位连成一片（无空洞），且行列差 <= 2
 11. 不同分组的座位不重叠
 12. 分组设置里每组都有均衡系数徽标，取值 0~100
 13. 顶部「整体均衡」汇总可见
 14. 分组模式 banner 的分组按钮上带均衡系数
 15. 随机打乱座位后，「按组聚座」能把同组学生重新聚拢
 16. 全程无 JS 报错

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
然后:
  python .workbuddy/smoke_test_batch25_rank_lists_group_seats.py
"""
import asyncio
import json

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

PASSED = 0
FAILED = 0
ERRORS = []

# 页面外链 xlsx / html2canvas；本机代理下会拖死加载，统一打桩（本用例不需要真实解析）
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

# 名单：导入顺序与排名顺序**故意不同**（排名 = 成绩名次）
STUDENTS = [
    ("张伟", "male", 7),
    ("李娜", "female", 3),
    ("王强", "male", 11),
    ("赵敏", "female", 1),
    ("孙悦", "female", 9),
    ("陈晨", "male", 5),
    ("周杰", "male", 2),
    ("吴昊", "male", 12),
    ("郑爽", "female", 4),
    ("冯磊", "male", 10),
    ("何静", "female", 6),
    ("许阳", "male", 8),
]

ROWS = 4
COLS = 6

BY_RANK = [s[0] for s in sorted(STUDENTS, key=lambda x: x[2])]


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


def group_seat_blocks(seats, cfg_students):
    """把座位数组按分组聚成 {groupId: [座位下标...]}"""
    group_of = {s["id"]: s.get("groupId") for s in cfg_students if s.get("groupId")}
    blocks = {}
    for idx, sid in enumerate(seats):
        gid = group_of.get(sid)
        if gid:
            blocks.setdefault(gid, []).append(idx)
    return blocks


def block_shape(indices, cols):
    rows = [i // cols + 1 for i in indices]
    colv = [i % cols + 1 for i in indices]
    r0, r1 = min(rows), max(rows)
    c0, c1 = min(colv), max(colv)
    return (r1 - r0 + 1, c1 - c0 + 1, (r1 - r0 + 1) * (c1 - c0 + 1))


async def read_config(page):
    return await page.evaluate("() => JSON.parse(localStorage.getItem('classroomConfig') || '{}')")


async def main():
    global PASSED, FAILED, ERRORS

    students = [
        {"id": f"s{i+1}", "name": name, "groupId": None, "checkedIn": False,
         "gender": gender, "tags": [], "rank": rank}
        for i, (name, gender, rank) in enumerate(STUDENTS)
    ]
    cfgs = {
        "title": "批次25测试",
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
        "version": "1.3.4",
    }

    dialog_log = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        context = await browser.new_context(accept_downloads=True)
        page = await context.new_page()
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)

        async def on_dialog(dialog):
            dialog_log.append(f"{dialog.type}:{dialog.message}")
            if dialog.type == "prompt":
                await dialog.accept("3")      # 「按排名均衡分组」问组数
            else:
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
            % json.dumps(json.dumps(cfgs, ensure_ascii=False))
        )
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

        # ═══ 1. 未入座名单按排名 ═══
        print("=== 1. 未入座名单按排名升序 ===")
        names = await page.eval_on_selector_all(
            "#studentList .student-item .student-name",
            "els => els.map(e => e.textContent.trim())",
        )
        if names == BY_RANK:
            ok("未入座名单按排名升序：" + "、".join(names[:4]) + " …")
        else:
            bad(f"未入座名单顺序不对\n     期望 {BY_RANK}\n     实际 {names}")

        # ═══ 2. 详细设置栏按排名 ═══
        print("=== 2. 详细设置栏按排名升序 ===")
        if not await page.locator("#studentManagement").is_visible():
            await page.click('[data-target="studentManagement"]')
            await page.wait_for_timeout(400)
        detail = await page.eval_on_selector_all(
            "#studentGroupSelector .student-group-item .student-name-input",
            "els => els.map(e => e.value.trim())",
        )
        if detail == BY_RANK:
            ok("详细设置栏按排名升序")
        else:
            bad(f"详细设置顺序不对\n     期望 {BY_RANK}\n     实际 {detail}")

        # ═══ 3~4. 统计块 → 下载 Excel：排名列 + 排序 ═══
        print("=== 3~4. 导出 Excel 按排名 ===")
        await page.evaluate(
            """() => {
                window.__lastAoa = null;
                window.__excelWritten = false;
                window.XLSX = {
                    utils: {
                        aoa_to_sheet: (aoa) => { window.__lastAoa = aoa; return {}; },
                        book_new: () => ({}),
                        book_append_sheet: () => {}
                    },
                    writeFile: () => { window.__excelWritten = true; }
                };
            }"""
        )
        await page.click('.stat-block[data-stat="totalStudents"]')
        await page.wait_for_timeout(350)
        menu_item = page.locator('.stat-action-menu-item[data-action="excel"]')
        if await menu_item.count() == 1:
            await menu_item.click()
            await page.wait_for_timeout(400)
        else:
            bad("统计块菜单里找不到「下载 Excel」")
        aoa = await page.evaluate("() => window.__lastAoa")
        written = await page.evaluate("() => window.__excelWritten")
        if aoa and aoa[0] and aoa[0][0] == "排名":
            ok("导出表头首列为「排名」：" + " / ".join(aoa[0]))
        else:
            bad(f"导出表头首列应为「排名」，实际 {aoa[0] if aoa else '<未导出>'}")

        if aoa and len(aoa) == 13:
            exported = [row[1] for row in aoa[1:]]
            ranks = [row[0] for row in aoa[1:]]
            if exported == BY_RANK and ranks == list(range(1, 13)):
                ok("导出 12 行按排名升序，排名列 1..12")
            else:
                bad(f"导出顺序/排名不对\n     姓名 {exported}\n     排名 {ranks}")
        else:
            bad(f"导出应有 13 行（含表头），实际 {len(aoa) if aoa else 0}")

        # ═══ 5~8. 配对设置：可搜索 ═══
        print("=== 5~8. 配对设置可输入姓名搜索 ===")
        await page.click("#randomDropdownBtn")
        await page.wait_for_timeout(400)
        await page.click('[data-action="pairSettings"]')
        await page.wait_for_timeout(500)

        search_count = await page.locator(".pair-popup .pair-search-input").count()
        select_count = await page.locator(".pair-popup select").count()
        if search_count == 4 and select_count == 0:
            ok("4 个学生选择框均为可输入的搜索框（无 select）")
        else:
            bad(f"搜索框数量异常：input={search_count} select={select_count}")

        # 自绘候选列表（原生 datalist 已换掉）：聚焦即展开，按排名升序
        await page.click(".pair-forced-a")
        await page.wait_for_timeout(300)
        options = await page.eval_on_selector_all(
            ".pair-suggest:not([hidden]) .pair-suggest-item .psi-name",
            "els => els.map(e => e.textContent.trim())"
        )
        if options == BY_RANK:
            ok("候选名单按排名升序（共 %d 人）" % len(options))
        else:
            bad(f"候选顺序不对\n     期望 {BY_RANK}\n     实际 {options}")

        # 输入片段 + 回车
        await page.fill(".pair-forced-a", "李")
        await page.fill(".pair-forced-b", "周")
        await page.press(".pair-forced-b", "Enter")
        await page.wait_for_timeout(400)
        pair_text = await page.eval_on_selector_all(
            ".pair-forced-list .pair-item .pair-item-names",
            "els => els.map(e => e.textContent.trim())",
        )
        if pair_text == ["李娜 ↔ 周杰"]:
            ok("输入姓名片段 + 回车 → 添加配对，并自动补全姓名")
        else:
            bad(f"配对添加结果异常：{pair_text}")
        filled = await page.evaluate("() => document.querySelector('.pair-forced-a').value")
        if filled == "":
            ok("添加后输入框自动清空（便于连续录入）")
        else:
            bad(f"添加后输入框未清空，实际 {filled!r}")

        # 不存在的姓名
        await page.fill(".pair-avoid-a", "查无此人")
        await page.fill(".pair-avoid-b", "张伟")
        await page.press(".pair-avoid-a", "Enter")
        await page.wait_for_timeout(400)
        avoid_items = await page.locator(".pair-avoid-list .pair-item").count()
        warned = any("没有找到" in m for m in dialog_log)
        if avoid_items == 0 and warned:
            ok("输入不存在的姓名 → 不添加并提示")
        else:
            bad(f"不存在的姓名处理异常：items={avoid_items} 提示={warned}")

        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)

        # ═══ 9~11. 按排名均衡分组 + 按组聚座 ═══
        print("=== 9~11. 均衡分组同时按组聚座 ===")
        await page.click("#balanceGroupBtn")
        await page.wait_for_timeout(1800)

        cfg = await read_config(page)
        groups = cfg.get("groups", [])
        counts = {}
        for s in cfg["students"]:
            gid = s.get("groupId")
            if gid:
                counts[gid] = counts.get(gid, 0) + 1
        if len(groups) == 3 and sorted(counts.values()) == [4, 4, 4]:
            ok("分成 3 组、每组 4 人")
        else:
            bad(f"分组结果异常：{len(groups)} 组，人数 {sorted(counts.values())}")

        blocks = group_seat_blocks(cfg["seats"], cfg["students"])
        if len(blocks) == 3:
            shapes_ok = True
            detail_txt = []
            for gid, idxs in blocks.items():
                r, c, area = block_shape(idxs, COLS)
                detail_txt.append(f"{r}×{c}")
                if area != len(idxs) or abs(r - c) > 2:
                    shapes_ok = False
            if shapes_ok:
                ok("每组座位连成一片（无空洞），形状 " + " / ".join(detail_txt))
            else:
                bad(f"座位未聚拢或有空洞：{detail_txt}（每组人数 {[len(v) for v in blocks.values()]}）")
        else:
            bad(f"应有 3 个分组有座位，实际 {len(blocks)}")

        all_seats = [i for idxs in blocks.values() for i in idxs]
        if len(all_seats) == len(set(all_seats)) == 12:
            ok("12 名学生全部入座且座位互不重叠")
        else:
            bad(f"座位重叠或遗漏：{len(all_seats)} 个座位 / {len(set(all_seats))} 个唯一")

        # ═══ 12~13. 分组设置里的均衡系数 ═══
        print("=== 12~13. 分组均衡系数 ===")
        badges = await page.eval_on_selector_all(
            "#groupList .group-item .group-balance-badge",
            "els => els.map(e => ({ score: e.textContent.trim(), level: e.dataset.level, title: e.title }))",
        )
        if len(badges) == 3 and all(b["score"].isdigit() and 0 <= int(b["score"]) <= 100
                                    and b["level"] in ("good", "fair", "poor") for b in badges):
            ok("每组都有均衡系数徽标：" + " / ".join(f'{b["score"]}({b["level"]})' for b in badges))
        else:
            bad(f"均衡系数徽标异常：{badges}")

        summary = page.locator("#groupBalanceSummary")
        summary_text = (await summary.inner_text()).strip() if await summary.count() else ""
        if summary_text and "整体均衡" in summary_text:
            ok("顶部整体均衡汇总：" + summary_text.replace("\n", " "))
        else:
            bad(f"整体均衡汇总缺失，实际 {summary_text!r}")

        # ═══ 14. 分组模式 banner 的系数 ═══
        print("=== 14. 分组模式 banner ===")
        await page.click("#modeSwitchBtn")   # 普通 → 签到
        await page.wait_for_timeout(500)
        await page.click("#modeSwitchBtn")   # 签到 → 分组
        await page.wait_for_timeout(900)
        banner_badges = await page.eval_on_selector_all(
            "#groupModeList .group-mode-group-btn .group-mode-balance",
            "els => els.map(e => e.textContent.trim())",
        )
        if len(banner_badges) == 3 and all(x.isdigit() for x in banner_badges):
            ok("分组模式 banner 的分组按钮带均衡系数：" + " / ".join(banner_badges))
        else:
            bad(f"分组模式系数异常：{banner_badges}")

        # ═══ 15. 打乱后「按组聚座」 ═══
        print("=== 15. 按组聚座（打乱后重新聚拢）===")
        await page.evaluate(
            """() => {
                if (!window.__seatsTest) throw new Error('测试钩子未暴露');
                return window.__seatsTest.randomSeatArrange('random') || {};
            }"""
        )
        await page.wait_for_timeout(900)
        cfg_scrambled = await read_config(page)
        scrambled_blocks = group_seat_blocks(cfg_scrambled["seats"], cfg_scrambled["students"])
        scrambled_compact = all(
            block_shape(idxs, COLS)[2] == len(idxs) for idxs in scrambled_blocks.values()
        )

        await page.evaluate("() => document.querySelectorAll('.mode-banner-close')[0]?.click()")
        await page.wait_for_timeout(300)
        await page.click("#modeSwitchBtn")   # 分组 → 普通
        await page.wait_for_timeout(500)
        await page.click("#arrangeGroupBtn")
        await page.wait_for_timeout(1200)

        cfg_final = await read_config(page)
        final_blocks = group_seat_blocks(cfg_final["seats"], cfg_final["students"])
        final_shapes = [block_shape(idxs, COLS) for idxs in final_blocks.values()]
        final_ok = (
            len(final_blocks) == 3
            and sum(len(v) for v in final_blocks.values()) == 12
            and all(area == len(idxs) and abs(r - c) <= 2
                    for (r, c, area), idxs in zip(final_shapes, final_blocks.values()))
        )
        if final_ok:
            ok("按组聚座后重新聚拢：" + " / ".join(f"{r}×{c}" for r, c, _ in final_shapes)
               + ("（打乱后确实不紧凑，已验证修复）" if not scrambled_compact else "（打乱后仍紧凑，修复校验略弱）"))
        else:
            bad(f"按组聚座未生效：{final_shapes}")

        # ═══ 16. 无 JS 报错 ═══
        print("=== 16. 控制台 ===")
        if not ERRORS:
            ok("全程无 JS 报错")
        else:
            bad("控制台有报错：\n     " + "\n     ".join(ERRORS[:6]))

        await browser.close()

    print("\n==========================================")
    print(f"通过 {PASSED} / 失败 {FAILED}")
    if FAILED:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
