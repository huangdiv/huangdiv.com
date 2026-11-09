# -*- coding: utf-8 -*-
"""
批次31 — 配对设置唯一性校验 + 座位区「配对关联线」

需求:
  1. 同一个人不能同时与两个人「强制同桌」，重复设置时弹出提示；
  2. 每个「强制同桌」配对的两座位之间画细、淡的实线（不带箭头）；
  3. 连线只走座位之间的空隙带，不能覆盖 / 影响中间的其他座位；
  4. 「回避同桌」默认不画；两人真的被排成同桌时才画红色虚线 + 中点 ×（不带箭头）；
  5. 开关名字叫「配对关联线」。

断言(共 39 项，按 20 组组织):
  1. 首屏(未打开弹窗)即有 1 个 .pair-link-layer，3 条强制线 + 1 条互斥线
  2. 强制/互斥两种线的 computed stroke 颜色不同，且强制线更淡、更细
  3. 两类线都不带箭头：无 marker 属性、SVG 内无 <marker>/<defs>；
     强制实线 / 互斥虚线 + 中点 × 保留；图例示意线也无箭头端点
  4. 图层 pointer-events:none，座位中心 elementFromPoint 命中的是 .seat
  5. 所有路径(getPointAtLength 采样)都不落在任何座位矩形内部  ← 核心
  6. 图例显示「强制同桌 3」「回避同桌冲突 1」
  7. 开关名为「配对关联线」；关闭 ⇒ 0 条线、图例隐藏；再开恢复
  8. 开关状态自动保存后刷新仍保留
  9. 已有 s1-s12 时再添加 s1+s2 ⇒ alert 点名冲突双方与原配对，列表不变
 10. 冲突时输入框不清空(方便用户改)，且不产生新连线
 11. 另一端撞车(s12+s2)同样被拦下
 12. 完全重复仍提示「该配对已存在」
 13. 添加不相关配对 s7+s8 ⇒ 成功，连线即时变 4 条
 14. 删除一条强制配对 ⇒ 连线即时减 1
 15. 回避的两人没坐同桌的配置 ⇒ 0 条互斥线(强制线仍在)
 16. 切换教师视角后连线仍在，且仍不压座位
 17. 打印样式下连线与图例隐藏
 17b. 导出图片的克隆体剔除 SVG 图层(避免 html2canvas 兼容问题)，座位仍完整
 17c. 同桌连线走向统一：多组同桌一律走座位上方、同排共用走廊、
      反转配对数组顺序后每条线 d 完全不变（v1.4.7 修复 index%2 交替上下）
 18. 版本号 1.4.8 + 全程无 JS 报错

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

NAMES = ["张伟", "李娜", "王强", "赵敏", "孙悦", "陈晨",
         "刘洋", "周婷", "吴磊", "郑爽", "钱进", "冯巩"]


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


def make_config(forced, avoid, title="批次31", view="student", show_links=True):
    students = [
        {"id": f"s{i+1}", "name": n, "groupId": None, "checkedIn": False,
         "gender": "male" if i % 2 == 0 else "female", "tags": [], "rank": i + 1,
         "zonePref": "", "zoneAvoid": ""}
        for i, n in enumerate(NAMES)
    ]
    return {
        "title": title,
        "rows": 3, "cols": 4,
        "seats": [f"s{i+1}" for i in range(12)],
        "students": students,
        "groups": [],
        "viewMode": view,
        "aisles": [],
        "showStudentIcons": True,
        "showPairLinks": show_links,
        "forcedPairs": forced,
        "avoidPairs": avoid,
        "version": "1.4.8",
    }


# 3 组强制(都跨行/跨列) + 1 组回避已同桌(s5/s6 = 座位 4/5) + 1 组回避已分开(s2/s4)
CFG_A = make_config(
    [["s1", "s12"], ["s3", "s10"], ["s5", "s9"]],
    [["s5", "s6"], ["s2", "s4"]],
)
# 回避的两组都没有被排成同桌
CFG_NO_CONFLICT = make_config(
    [["s1", "s12"], ["s3", "s10"], ["s5", "s9"]],
    [["s2", "s4"], ["s7", "s9"]],
)

# 19 组：4 组强制同桌都真的坐在相邻座位 + 1 组回避冲突同桌。
# 3 行 4 列无走道 ⇒ 同桌为 (0,1)(2,3)(4,5)(6,7)(8,9)(10,11)
DESKMATE_FORCED = [["s1", "s2"], ["s3", "s4"], ["s5", "s6"], ["s9", "s10"]]
CFG_DESKMATES = make_config(DESKMATE_FORCED, [["s7", "s8"]], title="同桌走向")
CFG_DESKMATES_REV = make_config(list(reversed(DESKMATE_FORCED)),
                                [["s7", "s8"]], title="同桌走向-反序")


async def link_info(page):
    return await page.evaluate("""() => {
        const svg = document.querySelector('.pair-link-layer');
        const forced = Array.from(document.querySelectorAll('.pair-link-forced'));
        const avoid = Array.from(document.querySelectorAll('.pair-link-avoid'));
        const css = el => el ? getComputedStyle(el) : null;
        const f = css(forced[0]), a = css(avoid[0]);
        const legend = document.getElementById('pairLinkLegend');
        const legendLine = document.querySelector('.pair-legend-line');
        const sw = document.querySelector('[data-toggle="pairlinks"] .dropdown-switch-label');
        return {
            layer: !!svg,
            viewBox: svg ? svg.getAttribute('viewBox') : '',
            pointer: svg ? css(svg).pointerEvents : '',
            forced: forced.length,
            avoid: avoid.length,
            crosses: document.querySelectorAll('.pair-link-cross').length,
            fStroke: f ? f.stroke : '',
            fWidth: f ? parseFloat(f.strokeWidth) : 0,
            aStroke: a ? a.stroke : '',
            aWidth: a ? parseFloat(a.strokeWidth) : 0,
            fDash: f ? f.strokeDasharray : '',
            aDash: a ? a.strokeDasharray : '',
            fStart: forced[0] ? forced[0].getAttribute('marker-start') : '',
            fEnd: forced[0] ? forced[0].getAttribute('marker-end') : '',
            aStart: avoid[0] ? avoid[0].getAttribute('marker-start') : '',
            aEnd: avoid[0] ? avoid[0].getAttribute('marker-end') : '',
            arrows: svg ? svg.querySelectorAll('marker, defs').length : -1,
            legendArrow: legendLine ? getComputedStyle(legendLine, '::after').content : '',
            switchLabel: sw ? sw.textContent.trim() : '',
            legendHidden: legend ? legend.hidden : null,
            legendText: legend ? legend.innerText.replace(/\\s+/g, ' ').trim() : '',
            version: (document.getElementById('appVersion') || {}).textContent || ''
        };
    }""")


PATH_HITS = """() => {
    const classroom = document.getElementById('classroom');
    const rects = Array.from(classroom.querySelectorAll('.seat[data-index]')).map(el => ({
        l: el.offsetLeft, t: el.offsetTop,
        r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight
    }));
    const hits = [];
    document.querySelectorAll('path.pair-link').forEach((p, pi) => {
        const len = p.getTotalLength();
        for (let k = 0; k <= 160; k++) {
            const pt = p.getPointAtLength(len * k / 160);
            for (let si = 0; si < rects.length; si++) {
                const s = rects[si];
                if (pt.x > s.l + 0.6 && pt.x < s.r - 0.6 &&
                    pt.y > s.t + 0.6 && pt.y < s.b - 0.6) {
                    hits.push({path: pi, seat: si,
                               x: Math.round(pt.x), y: Math.round(pt.y)});
                    break;
                }
            }
            if (hits.length > 6) return hits;
        }
    });
    return hits;
}"""


# 从真实 SVG path 反推每条线的「走廊 y」与走向（above / below）。
# startY 是座位边缘出发点的 y；水平段的 y 就是走廊 y：
#   走廊 y < startY ⇒ 线绕座位上方；走廊 y > startY ⇒ 绕下方。
LINK_GEOMETRY = """() => {
    return Array.from(document.querySelectorAll('path.pair-link')).map(p => {
        const d = p.getAttribute('d');
        const nums = (d.match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number);
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i+1]]);
        const startY = pts.length ? pts[0][1] : NaN;
        let laneY = null;
        for (let i = 0; i + 1 < pts.length; i++) {
            if (Math.abs(pts[i][1] - pts[i+1][1]) < 0.05 &&
                Math.abs(pts[i][0] - pts[i+1][0]) > 0.05) {
                laneY = pts[i][1];
                break;
            }
        }
        return {
            d: d,
            kind: p.classList.contains('pair-link-avoid') ? 'avoid' : 'forced',
            startY: startY,
            laneY: laneY,
            direction: laneY === null ? 'flat' : (laneY < startY ? 'above' : 'below')
        };
    });
}"""


async def mount(page, cfg):
    await page.evaluate(
        "cfg => localStorage.setItem('classroomConfig', JSON.stringify(cfg))", cfg)
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(1100)


async def open_dropdown(page):
    await page.click("#randomDropdownBtn")
    await page.wait_for_timeout(220)


async def fill_pair(page, type_, name_a, name_b):
    await page.fill(f".pair-{type_}-a", name_a)
    await page.fill(f".pair-{type_}-b", name_b)
    await page.click(f".pair-{type_}-add")
    await page.wait_for_timeout(240)


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
        # 只在首次导航播种：add_init_script 每次 reload 都会重跑，会把自动保存覆盖掉
        await page.add_init_script(
            "if (!sessionStorage.getItem('__seeded31')) {"
            "  localStorage.setItem('classroomConfig', %s);"
            "  sessionStorage.setItem('__seeded31', '1');"
            "}" % json.dumps(json.dumps(CFG_A, ensure_ascii=False)))

        await page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(1400)

        # ═══ 1. 首屏既有连线 ═══
        print("=== 1. 首屏连线 ===")
        info = await link_info(page)
        check(info["layer"] and info["forced"] == 3 and info["avoid"] == 1,
              f"首屏 1 图层 / 3 强制 / 1 互斥（实际 {info['forced']}/{info['avoid']}）")
        check(info["crosses"] == 1, "互斥连线带 1 个 × 标记")

        # ═══ 2. 颜色 / 线宽 ═══
        print("=== 2. 颜色与线宽 ===")
        check(bool(info["fStroke"]) and info["fStroke"] != info["aStroke"],
              f"两种线颜色不同（{info['fStroke']} vs {info['aStroke']}）")
        check(info["fWidth"] < info["aWidth"],
              f"强制线更细（{info['fWidth']} < {info['aWidth']}）")
        check("0.4" in info["fStroke"] and info["fStroke"] != info["aStroke"],
              "强制线是淡化色（含低 alpha）")

        # ═══ 3. 两类线都不带箭头，虚线 / 中点 × 保留 ═══
        print("=== 3. 无箭头端点 ===")
        check(all(not info[k] for k in ("fStart", "fEnd", "aStart", "aEnd")),
              "两类线都没有 marker-start / marker-end")
        check(info["arrows"] == 0,
              f"SVG 图层内没有 <marker>/<defs>（实际 {info['arrows']} 个）")
        check(info["fDash"] in ("none", "") and
              info["aDash"] not in ("none", "") and " " in (info["aDash"] or "") and
              info["crosses"] == 1,
              f"强制为实线、回避为虚线且中点 × 保留（{info['fDash']} / {info['aDash']}）")
        check(info["legendArrow"] == "none",
              f"图例示意线也没有箭头端点（::after content={info['legendArrow']}）")

        # ═══ 4. 不影响交互 ═══
        print("=== 4. 不遮挡 / 不影响座位 ===")
        check(info["pointer"] == "none", "图层 pointer-events:none")
        hit = await page.evaluate("""() => {
            const s = document.querySelector('.seat[data-index="5"]');
            const r = s.getBoundingClientRect();
            const el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
            return !!(el && el.closest('.seat'));
        }""")
        check(hit, "座位中心点击命中的仍是 .seat")

        hits = await page.evaluate(PATH_HITS)
        check(len(hits) == 0, f"路径不穿过任何座位内部（命中 {len(hits)} 处：{hits[:3]}）")

        # ═══ 6. 图例 ═══
        print("=== 6. 图例 ===")
        check("强制同桌 3" in info["legendText"] and
              "回避同桌冲突 1" in info["legendText"] and not info["legendHidden"],
              f"图例计数正确：{info['legendText']}")

        # ═══ 7/8. 开关 ═══
        print("=== 7-8. 开关与持久化 ===")
        await open_dropdown(page)
        sw = page.locator('[data-toggle="pairlinks"]')
        sw_label = (await sw.locator('.dropdown-switch-label').inner_text()).strip()
        check(sw_label == "配对关联线", f"开关文案为「配对关联线」（实际 {sw_label}）")
        check(await sw.get_attribute("aria-checked") == "true", "开关初始为开")
        await sw.click()
        await page.wait_for_timeout(300)
        off = await link_info(page)
        check(off["forced"] == 0 and off["avoid"] == 0 and off["legendHidden"],
              "关闭后 0 条线、图例隐藏")
        await page.wait_for_timeout(750)      # autoSave 500ms 防抖
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(1200)
        persisted = await link_info(page)
        check(persisted["forced"] == 0 and persisted["avoid"] == 0 and
              await page.locator('[data-toggle="pairlinks"]').get_attribute("aria-checked") == "false",
              "刷新后开关仍为关")
        await open_dropdown(page)
        await page.locator('[data-toggle="pairlinks"]').click()
        await page.wait_for_timeout(300)
        on = await link_info(page)
        check(on["forced"] == 3 and on["avoid"] == 1, "重新开启后连线恢复")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        # ═══ 9-12. 强制同桌唯一性 ═══
        print("=== 9-12. 强制同桌唯一性校验 ===")
        await open_dropdown(page)
        await page.click('[data-action="pairSettings"]')
        await page.wait_for_timeout(320)
        before = await page.locator(".pair-forced-list .pair-item").count()
        check(before == 3, f"弹窗里初始 3 组强制配对（实际 {before}）")

        DIALOGS.clear()
        await fill_pair(page, "forced", "张伟", "李娜")
        conflict_msg = DIALOGS[-1] if DIALOGS else ""
        check("张伟" in conflict_msg and "李娜" in conflict_msg and
              "张伟 ↔ 冯巩" in conflict_msg and "只能有一组" in conflict_msg,
              f"冲突提示点名双方与原配对：{conflict_msg[:70]}")
        vals = await page.evaluate("""() => [
            document.querySelector('.pair-forced-a').value,
            document.querySelector('.pair-forced-b').value]""")
        check(vals == ["张伟", "李娜"] and
              await page.locator(".pair-forced-list .pair-item").count() == 3,
              "冲突后保留输入、列表不变（不产生第 4 组）")

        DIALOGS.clear()
        await fill_pair(page, "forced", "冯巩", "李娜")
        check("冯巩" in (DIALOGS[-1] if DIALOGS else "") and
              await page.locator(".pair-forced-list .pair-item").count() == 3,
              "另一端撞车同样被拦下")

        DIALOGS.clear()
        await fill_pair(page, "forced", "张伟", "冯巩")
        check("该配对已存在" in (DIALOGS[-1] if DIALOGS else ""),
              "完全重复仍提示「该配对已存在」")

        # ═══ 13/14. 增删即时刷新 ═══
        print("=== 13-14. 增删配对即时刷新 ===")
        await fill_pair(page, "forced", "刘洋", "周婷")
        check(await page.locator(".pair-forced-list .pair-item").count() == 4,
              "不相关配对可正常添加")
        cur = await link_info(page)
        check(cur["forced"] == 4 and cur["avoid"] == 1,
              f"添加后连线即时变 4 条（实际 {cur['forced']}）")
        await page.locator(".pair-forced-list .pair-item-remove").first.click()
        await page.wait_for_timeout(280)
        cur = await link_info(page)
        check(cur["forced"] == 3, f"删除后连线减到 3 条（实际 {cur['forced']}）")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(250)

        # ═══ 15. 回避已分开 ⇒ 静默 ═══
        print("=== 15. 回避已分开时不画线 ===")
        await mount(page, CFG_NO_CONFLICT)
        info2 = await link_info(page)
        check(info2["avoid"] == 0 and info2["forced"] == 3 and info2["crosses"] == 0,
              f"两组回避都未同桌 ⇒ 0 条互斥线、3 条强制线（实际 {info2['avoid']}/{info2['forced']}）")
        check("回避同桌冲突" not in info2["legendText"], "图例隐藏回避项")

        # ═══ 16. 教师视角 ═══
        print("=== 16. 教师视角 ===")
        await mount(page, make_config(CFG_A["forcedPairs"], CFG_A["avoidPairs"],
                                      view="teacher"))
        await page.click("#toggleViewBtn")
        await page.wait_for_timeout(450)
        teacher = await link_info(page)
        check(teacher["forced"] == 3 and teacher["avoid"] == 1,
              "切换视角后连线仍在")
        hits2 = await page.evaluate(PATH_HITS)
        check(len(hits2) == 0, f"教师视角下路径仍不压座位（命中 {len(hits2)} 处）")

        # ═══ 17. 打印 ═══
        print("=== 17. 打印样式 ===")
        await page.emulate_media(media="print")
        await page.wait_for_timeout(200)
        disp = await page.evaluate("""() => ({
            layer: getComputedStyle(document.querySelector('.pair-link-layer')).display,
            legend: getComputedStyle(document.getElementById('pairLinkLegend')).display
        })""")
        check(disp["layer"] == "none" and disp["legend"] == "none",
              f"打印时连线与图例隐藏（{disp}）")
        await page.emulate_media(media="screen")

        # ═══ 17b. 导出图片克隆体不带 SVG 图层 ═══
        print("=== 17b. 导出图片克隆 ===")
        # 挂起的 Promise ⇒ 只截获传给 html2canvas 的容器，不触发下载 / 不报错
        await page.evaluate("""() => {
            window.__exportWrapper = null;
            window.html2canvas = function (el) {
                window.__exportWrapper = el;
                return new Promise(() => {});
            };
        }""")
        await page.click("#printDropdownBtn")
        await page.wait_for_timeout(220)
        await page.click('[data-action="exportImage"]')
        await page.wait_for_timeout(350)
        exp = await page.evaluate("""() => {
            const w = window.__exportWrapper;
            return w ? {
                captured: true,
                layers: w.querySelectorAll('.pair-link-layer').length,
                seats: w.querySelectorAll('.seat').length
            } : { captured: false, layers: -1, seats: -1 };
        }""")
        check(exp["captured"] and exp["layers"] == 0 and exp["seats"] == 12,
              f"导出克隆剔除连线图层且座位完整（{exp}）")

        # ═══ 17c. 同桌连线走向统一（v1.4.7）═══
        print("=== 17c. 同桌连线走向统一 ===")
        await mount(page, CFG_DESKMATES)
        geom = await page.evaluate(LINK_GEOMETRY)
        check(len(geom) == 5 and
              sum(1 for g in geom if g["kind"] == "forced") == 4,
              f"4 组强制同桌 + 1 组回避冲突同桌 ⇒ 5 条线（实际 {len(geom)}）")
        check(all(g["direction"] == "above" for g in geom),
              f"所有同桌线统一走座位上方（实际 {[g['direction'] for g in geom]}）")
        lanes_by_row = {}
        for g in geom:
            if g["laneY"] is not None:
                lanes_by_row.setdefault(round(g["startY"], 1), []).append(g["laneY"])
        check(all(g["laneY"] is not None for g in geom) and
              all(max(v) - min(v) < 0.05 for v in lanes_by_row.values()),
              f"同一排的同桌线共用同一条走廊、无序号抖动（{lanes_by_row}）")
        hits3 = await page.evaluate(PATH_HITS)
        check(len(hits3) == 0,
              f"统一走向后仍不压任何座位（命中 {len(hits3)} 处）")

        await mount(page, CFG_DESKMATES_REV)
        geom_rev = await page.evaluate(LINK_GEOMETRY)
        check(sorted(g["d"] for g in geom) == sorted(g["d"] for g in geom_rev),
              "反转配对数组顺序后，每条同桌线走向完全不变")

        # ═══ 18. 版本 + 无报错 ═══
        print("=== 18. 版本与控制台 ===")
        check(teacher["version"] == "1.4.8", f"版本号 1.4.8（实际 {teacher['version']}）")
        check(len(ERRORS) == 0, f"全程无 JS 报错（{ERRORS[:3]}）")

        await browser.close()

    print(f"\n{'='*56}")
    print(f"批次31: {PASSED} 通过, {FAILED} 失败")
    if FAILED:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
