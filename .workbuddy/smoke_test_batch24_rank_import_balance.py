# -*- coding: utf-8 -*-
"""
批次24 — 学生排名(rank)属性 + 导入增量合并 + 按排名均衡分组

需求:
  1. 导入学生名单为**增量合并**:未导入的属性保持原值,不重建名单;
  2. 新增「排名」属性,默认按导入顺序编号,支持选 Excel 某列 + 升/降序作为排名依据;
  3. 座位右下角显示排名数字(字号同左上角坐标),受标签显示开关控制;
     标签过多时隐藏后面的图标,但不影响排名数字;
  4. 详细设置栏按排名顺序显示学生;
  5. 分组设置 / 分组模式 banner 增加「按排名均衡分组」。

断言(共 14 项):
  1. 导入区出现「同时导入排名」,且能自动识别「排名」列
  2. 第一次导入(只导排名):学生总数 6,且是增量(原 3 人未丢)
  3. 未导入的属性保持原值:张三的标签仍是 8 个
  4. 未导入的属性保持原值:李四性别仍是「女」
  5. 排名按依据列升序编号(李四1 / 孙七2 / 王五3 / 赵六4 / 张三5 / 周八6)
  6. 已入座学生座位不变(张三仍在 0 号位)
  7. 座位右下角显示排名数字,且字号与左上角「X排Y列」一致
  8. 排名数字确实位于座位右下角(几何校验)
  9. 标签过多时排名数字仍可见,且不被图标覆盖(几何校验)
 10. 第二次导入(导排名+性别+标签):学生总数仍是 6(不重复添加)
 11. 第二次导入:性别被更新(王五 → 男),空值不覆盖原值(李四仍是女)
 12. 第二次导入:标签为增量合并(张三 8 → 9 个,保留原标签)
 13. 详细设置栏按排名顺序显示学生
 14. 按排名均衡分组:3 组 / 1组2组3组 / 每组 2 人且性别 1男1女;关闭图标开关后排名数字隐藏

运行前先起本地服务:
  cd static && python -m http.server 8123 --bind 127.0.0.1
"""
import asyncio
import json
import os
import sys
import tempfile

from openpyxl import Workbook
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"

PASSED = 0
FAILED = 0
ERRORS = []

# 页面通过 <script src="https://cdn.sheetjs.com/..."> 加载 xlsx 解析库。
# 本机代理对该 CDN 的大文件下载不稳定(会截断),且把它拖慢到 domcontentloaded 超时。
# 测试里把该请求拦下来,注入一个「解析器桩」:仍上传真实 .xlsx、仍走真实 FileReader,
# 只跳过第三方解析 —— 被测的列识别 / 合并 / 排名 / 分组逻辑全部照常执行。
FAKE_XLSX_LIB = """
window.XLSX = {
    read: function () {
        return { SheetNames: ['名单'], Sheets: { '名单': { __fake: true } } };
    },
    utils: {
        sheet_to_json: function () { return window.__FAKE_ROWS__ || []; }
    }
};
"""

# 页面还外链了 html2canvas(用于导出图片)。本用例不测导出,给个桩避免网络阻塞加载。
FAKE_HTML2CANVAS = """
window.html2canvas = function () {
    return Promise.reject(new Error('html2canvas stub in smoke test'));
};
"""

XLSX_ROWS = [
    ["姓名", "排名", "标签", "性别"],
    ["张三", 50, "纪律委员", "男"],
    ["李四", 10, "", ""],        # 性别留空 ⇒ 导入时不应覆盖原值
    ["王五", 30, "", "男"],
    ["赵六", 40, "", "女"],
    ["孙七", 20, "", "男"],
    ["周八", 60, "", "女"],
]


def ok(msg):
    global PASSED
    PASSED += 1
    print(f"  [OK] {msg}")


def bad(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


def build_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "名单"
    for row in XLSX_ROWS:
        ws.append(list(row))
    wb.save(path)


async def open_io_panel(page):
    """展开「导入导出」折叠面板"""
    panel = page.locator("#ioPanel")
    if not await panel.is_visible():
        await page.click('[data-target="ioPanel"]')
        await page.wait_for_timeout(300)


async def open_student_panel(page):
    """展开「学生管理」折叠面板(分组设置 / 详细设置都在里面)"""
    panel = page.locator("#studentManagement")
    if not await panel.is_visible():
        await page.click('[data-target="studentManagement"]')
        await page.wait_for_timeout(300)


async def upload_and_configure(page, xlsx_path, *, rank=True, gender=False, tag=False):
    await open_io_panel(page)
    await page.set_input_files("#fileInput", xlsx_path)
    await page.wait_for_timeout(1200)          # 等 XLSX 解析 + 预览渲染
    if rank:
        await page.check("#enableRankImport")
        await page.select_option("#rankColumnSelect", "1")
        await page.select_option("#rankOrderSelect", "asc")
    if gender:
        await page.check("#enableGenderImport")
        await page.select_option("#genderColumnSelect", "3")
    if tag:
        await page.check("#enableTagImport")
        await page.select_option("#tagColumnSelect", "2")


async def read_config(page):
    return await page.evaluate("() => JSON.parse(localStorage.getItem('classroomConfig') || '{}')")


async def main():
    global PASSED, FAILED, ERRORS

    tmpdir = tempfile.mkdtemp(prefix="rank_smoke_")
    xlsx_path = os.path.join(tmpdir, "roster.xlsx")
    build_xlsx(xlsx_path)
    # 第二次上传用另一个文件名:同一个 file input 选同一路径不会触发 change
    xlsx_path2 = os.path.join(tmpdir, "roster2.xlsx")
    build_xlsx(xlsx_path2)

    # 初始:3 名学生(无 rank,模拟老配置),张三已入座且带 8 个标签
    zhang_tags = [{"emoji": "👑", "label": "班长"}] + [
        {"emoji": e, "label": "标签%d" % (i + 1)}
        for i, e in enumerate(["📚", "⚽", "🎨", "🌟", "🧹", "🤫", "🔖"])
    ]
    students = [
        {"id": "s1", "name": "张三", "groupId": None, "checkedIn": False,
         "gender": "male", "tags": zhang_tags},
        {"id": "s2", "name": "李四", "groupId": None, "checkedIn": False,
         "gender": "female", "tags": []},
        {"id": "s3", "name": "王五", "groupId": None, "checkedIn": False,
         "gender": "", "tags": []},
    ]
    cfgs = {
        "title": "批次24测试",
        "rows": 2,
        "cols": 3,
        "seats": ["s1", None, None, None, None, None],
        "students": students,
        "groups": [],
        "viewMode": "student",
        "aisles": [],
        "showStudentIcons": True,
        "forcedPairs": [],
        "avoidPairs": [],
        "version": "1.3.2",
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        page = await browser.new_page(accept_downloads=True)
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)

        async def on_dialog(dialog):
            # 「按排名均衡分组」用 prompt 询问组数,其余 confirm 一律确认
            if dialog.type == "prompt":
                await dialog.accept("3")
            else:
                await dialog.accept()

        page.on("dialog", on_dialog)

        # 拦截 xlsx CDN / html2canvas(见上方常量注释)
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
        await page.add_init_script(
            "window.__FAKE_ROWS__ = %s;" % json.dumps(XLSX_ROWS, ensure_ascii=False)
        )
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

        # ─── 0. 迁移:老配置应自动补 rank 1..N(张三排第 1) ───
        badge0 = page.locator('.seat[data-index="0"] .seat-rank')
        if await badge0.count() == 1 and (await badge0.inner_text()).strip() == "1":
            ok("老配置迁移:按名单顺序自动补排名(张三 = 1)")
        else:
            bad(f"老配置迁移后座位排名应为 1,实际 {await badge0.inner_text() if await badge0.count() else '<无>'!r}")

        # ─── 1. 排名导入区出现 + 自动识别排名列 ───
        print("=== 1. 「同时导入排名」区域与自动识别 ===")
        await upload_and_configure(page, xlsx_path, rank=False)
        if await page.locator("#rankImportSection").is_visible():
            ok("导入区出现「同时导入排名」")
        else:
            bad("导入区未出现「同时导入排名」")
        detected = await page.evaluate("() => document.getElementById('rankColumnSelect').value")
        if str(detected) == "1":
            ok("自动识别「排名」列(索引 1)")
        else:
            bad(f"排名列自动识别失败,实际索引 {detected}")

        # ─── 2~6. 第一次导入(只导排名) ───
        print("=== 2~6. 增量导入(仅排名) ===")
        await page.check("#enableRankImport")
        await page.select_option("#rankColumnSelect", "1")
        await page.select_option("#rankOrderSelect", "asc")
        await page.click("#confirmImportBtn")
        await page.wait_for_timeout(1400)

        cfg = await read_config(page)
        names = [s["name"] for s in cfg["students"]]
        if len(names) == 6:
            ok(f"增量导入后共 6 名学生: {names}")
        else:
            bad(f"增量导入后应有 6 名学生,实际 {len(names)}: {names}")

        by_name = {s["name"]: s for s in cfg["students"]}
        zhang = by_name.get("张三", {})
        li = by_name.get("李四", {})
        if len(zhang.get("tags") or []) == 8:
            ok("张三原有 8 个标签保持不变(未勾选标签导入)")
        else:
            bad(f"张三标签数应仍为 8,实际 {len(zhang.get('tags') or [])}")
        if li.get("gender") == "female":
            ok("李四性别仍为「女」(未勾选性别导入)")
        else:
            bad(f"李四性别应为 female,实际 {li.get('gender')!r}")

        expect_rank = {"李四": 1, "孙七": 2, "王五": 3, "赵六": 4, "张三": 5, "周八": 6}
        got_rank = {n: by_name.get(n, {}).get("rank") for n in expect_rank}
        if got_rank == expect_rank:
            ok(f"排名按依据列升序编号: {got_rank}")
        else:
            bad(f"排名编号不符: 期望 {expect_rank}, 实际 {got_rank}")

        seat0 = await page.get_attribute('.seat[data-index="0"]', "data-student")
        if seat0 == "s1":
            ok("已入座学生座位未变(张三仍在 0 号位)")
        else:
            bad(f"0 号位学生应为 s1,实际 {seat0}")

        # ─── 7~9. 座位排名数字 ───
        print("=== 7~9. 座位右下角排名数字 ===")
        rank_el = page.locator('.seat[data-index="0"] .seat-rank')
        if await rank_el.count() == 1 and (await rank_el.inner_text()).strip() == "5":
            ok("座位右下角显示排名数字 5")
        else:
            bad("座位未显示正确的排名数字")

        fs_rank = await page.eval_on_selector(
            '.seat[data-index="0"] .seat-rank', "el => getComputedStyle(el).fontSize")
        fs_num = await page.eval_on_selector(
            '.seat[data-index="0"] .seat-number', "el => getComputedStyle(el).fontSize")
        if fs_rank == fs_num:
            ok(f"排名数字字号与左上角坐标一致({fs_rank})")
        else:
            bad(f"字号不一致: 排名 {fs_rank} / 坐标 {fs_num}")

        geo = await page.evaluate("""() => {
            const seat = document.querySelector('.seat[data-index="0"]');
            const rank = seat.querySelector('.seat-rank');
            const icons = seat.querySelector('.seat-icons');
            const sr = seat.getBoundingClientRect();
            const rr = rank.getBoundingClientRect();
            const ir = icons ? icons.getBoundingClientRect() : null;
            return {
                seat: {left: sr.left, right: sr.right, top: sr.top, bottom: sr.bottom},
                rank: {left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom},
                icons: ir ? {left: ir.left, right: ir.right} : null
            };
        }""")
        s, r = geo["seat"], geo["rank"]
        if r["right"] >= s["right"] - 8 and r["bottom"] >= s["bottom"] - 8:
            ok("排名数字位于座位右下角")
        else:
            bad(f"排名数字位置不对: seat={s} rank={r}")

        if geo["icons"] and geo["icons"]["right"] <= r["left"] + 2:
            ok("标签图标过多时自动截断,未覆盖排名数字")
        else:
            bad(f"图标与排名数字重叠: icons={geo['icons']} rank={r}")

        # ─── 10~12. 第二次导入(排名+性别+标签),验证合并语义 ───
        print("=== 10~12. 第二次导入(排名+性别+标签) ===")
        await upload_and_configure(page, xlsx_path2, rank=True, gender=True, tag=True)
        await page.click("#confirmImportBtn")
        await page.wait_for_timeout(1400)

        cfg = await read_config(page)
        by_name = {s["name"]: s for s in cfg["students"]}
        if len(cfg["students"]) == 6:
            ok("重复导入不会重复添加学生(仍为 6 人)")
        else:
            bad(f"重复导入后应仍为 6 人,实际 {len(cfg['students'])}")

        if by_name["王五"].get("gender") == "male":
            ok("性别被更新(王五 → 男)")
        else:
            bad(f"王五性别应更新为 male,实际 {by_name['王五'].get('gender')!r}")
        if by_name["李四"].get("gender") == "female":
            ok("空单元格不覆盖原值(李四仍为女)")
        else:
            bad(f"李四性别应保持 female,实际 {by_name['李四'].get('gender')!r}")

        zhang_tags2 = by_name["张三"].get("tags") or []
        labels2 = [t.get("label") for t in zhang_tags2]
        if len(zhang_tags2) == 9 and "班长" in labels2 and "纪律委员" in labels2:
            ok(f"标签增量合并:8 → {len(zhang_tags2)} 个,原标签保留")
        else:
            bad(f"标签合并异常: {len(zhang_tags2)} 个 {labels2}")

        # ─── 13. 详细设置按排名排序 ───
        print("=== 13. 详细设置栏排序 ===")
        order = await page.evaluate("""() => Array.from(
            document.querySelectorAll('#studentGroupSelector .student-group-item'))
            .map(el => {
                const input = el.querySelector('.student-name-input');
                return input ? input.value : null;
            }).filter(Boolean)""")
        expect_order = ["李四", "孙七", "王五", "赵六", "张三", "周八"]
        if order == expect_order:
            ok(f"详细设置按排名顺序显示: {order}")
        else:
            bad(f"详细设置排序不符: 期望 {expect_order}, 实际 {order}")

        # ─── 14. 按排名均衡分组(分组设置栏入口) ───
        print("=== 14. 按排名均衡分组 ===")
        await open_student_panel(page)
        await page.click("#balanceGroupBtn")
        await page.wait_for_timeout(1600)

        cfg = await read_config(page)
        groups = cfg.get("groups") or []
        gnames = [g["name"] for g in groups]
        if gnames == ["1组", "2组", "3组"]:
            ok(f"自动命名分组: {gnames}")
        else:
            bad(f"分组命名不符: {gnames}")

        colors = [g["color"] for g in groups]
        if len(set(colors)) == len(colors):
            ok(f"各组配色互不相同: {colors}")
        else:
            bad(f"分组配色有重复: {colors}")

        gid_to_name = {g["id"]: g["name"] for g in groups}
        members = {}
        for st in cfg["students"]:
            members.setdefault(gid_to_name.get(st.get("groupId"), "?"), []).append(st)

        if all(len(members.get(n, [])) == 2 for n in gnames):
            ok("每组人数相等(6 人 3 组 → 每组 2 人)")
        else:
            bad(f"每组人数不均: {[len(members.get(n, [])) for n in gnames]}")

        gender_ok = True
        detail = []
        for n in gnames:
            males = sum(1 for st in members.get(n, []) if st.get("gender") == "male")
            females = sum(1 for st in members.get(n, []) if st.get("gender") == "female")
            detail.append(f"{n}:{males}男{females}女")
            if abs(males - females) > 1:
                gender_ok = False
        if gender_ok:
            ok("各组性别均衡(" + " / ".join(detail) + ")")
        else:
            bad("各组性别失衡: " + " / ".join(detail))

        # 分组模式 banner 里也有同一入口
        print("=== 15. 分组模式 banner 入口 ===")
        await page.click("#modeSwitchBtn")          # 普通 → 签到
        await page.wait_for_timeout(500)
        await page.click("#modeSwitchBtn")          # 签到 → 分组
        await page.wait_for_timeout(800)
        banner_btn = page.locator("#groupModeBalanceBtn")
        if await banner_btn.count() == 1 and await banner_btn.is_visible():
            ok("分组模式 banner 中存在「按排名均衡分组」按钮")
        else:
            bad("分组模式 banner 中缺少「按排名均衡分组」按钮")
        if await banner_btn.count() == 1:
            await banner_btn.click()
            await page.wait_for_timeout(1500)
            cfg = await read_config(page)
            gnames2 = [g["name"] for g in (cfg.get("groups") or [])]
            assigned2 = sum(1 for s in cfg["students"] if s.get("groupId"))
            if gnames2 == ["1组", "2组", "3组"] and assigned2 == 6:
                ok("banner 入口可用:仍为 3 组且 6 名学生全部有归属")
            else:
                bad(f"banner 入口执行异常: 组={gnames2}, 已分组人数={assigned2}")

        # 关闭标签显示 ⇒ 排名数字同步隐藏
        print("=== 16. 标签显示开关联动 ===")
        await page.click("#toggleIconsBtn")
        await page.wait_for_timeout(800)
        left = await page.locator(".seat-rank").count()
        number_left = await page.locator(".seat-number").count()
        if left == 0 and number_left == 0:
            ok("关闭图标开关后,排名数字与坐标标签一起隐藏")
        else:
            bad(f"关闭图标开关后仍有 {left} 个排名数字 / {number_left} 个坐标标签")

        # ─── 收尾 ───
        print("=== 15. 控制台 ===")
        if not ERRORS:
            ok("全程无 JS 报错")
        else:
            bad("出现 JS 报错: " + " | ".join(ERRORS[:5]))

        await browser.close()

    print("\n" + "=" * 60)
    print(f"总计: {PASSED} 通过, {FAILED} 失败")
    if FAILED:
        print("❌ 存在失败项")
        return 1
    print("✅ 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
