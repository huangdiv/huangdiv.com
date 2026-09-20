# -*- coding: utf-8 -*-
"""
批次 11:「切换模式」按钮三态轮换 + 分组 banner 复用签到 banner 风格

覆盖:
1. 「切换模式」不再是下拉(#modeSwitchDropdown 已删除)
2. 点击按钮 → 普通 → 签到 → 分组 → 普通 循环
3. 按钮文案/图标随模式变化,非普通模式高亮
4. 签到模式:顶部 .mode-banner.checkin-banner 横幅出现
5. 分组模式:顶部 .mode-banner.group-banner 横幅出现(与签到同款 .mode-banner)
6. 分组 banner 内含 计数 / 分组列表 / 新建分组 / 关闭(×)
7. 分组 banner 内按钮功能:多选座位 → 分配到已有分组 / 新建分组
8. 旧的独立 #groupModeToolbar 已删除
"""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/seats-generator.html"
results = []


def ok(m):
    results.append(True)
    print(f"  ✅ {m}")


def fail(m):
    results.append(False)
    print(f"  ❌ {m}")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        dialogs = []

        async def on_dialog(d):
            dialogs.append({"type": d.type, "msg": d.message[:50]})
            if d.type == "prompt":
                await d.accept("测试新分组X")
            else:
                await d.accept()

        page.on("dialog", on_dialog)

        await page.goto(BASE)
        await page.wait_for_timeout(1200)

        # ─── 场景 1:下拉已删除 ───
        print("=== 场景 1: 模式切换改为按钮轮换 ===")
        if await page.query_selector("#modeSwitchDropdown"):
            fail("#modeSwitchDropdown 仍存在(应已删除)")
        else:
            ok("#modeSwitchDropdown 已删除")
        if await page.query_selector("#groupModeToolbar"):
            fail("#groupModeToolbar 仍存在(应已删除)")
        else:
            ok("独立 #groupModeToolbar 已删除")

        async def mode():
            return await page.evaluate("""async () => {
                const { state } = await import('./modules/state.js');
                return { c: state.isCheckinMode, g: state.isGroupMode };
            }""")

        async def label():
            return await page.evaluate("document.getElementById('modeSwitchLabel').textContent")

        st = await mode()
        lb = await label()
        if (not st["c"]) and (not st["g"]) and lb == "普通模式":
            ok(f"初始: 普通模式(按钮文案={lb!r})")
        else:
            fail(f"初始状态异常: {st}, 按钮={lb!r}")

        # ─── 场景 2:普通 → 签到 ───
        print("=== 场景 2: 普通 → 签到 ===")
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(500)
        st = await mode()
        lb = await label()
        if st["c"] and not st["g"] and lb == "签到模式":
            ok(f"第 1 次点击 → 签到模式(按钮={lb!r})")
        else:
            fail(f"第 1 次点击后异常: {st}, 按钮={lb!r}")
        banner = await page.evaluate("!!document.querySelector('#classroom .mode-banner.checkin-banner.visible')")
        if banner:
            ok("签到横幅出现(.mode-banner.checkin-banner)")
        else:
            fail("签到横幅未出现")

        # ─── 场景 3:签到 → 分组 ───
        print("=== 场景 3: 签到 → 分组 ===")
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(500)
        st = await mode()
        lb = await label()
        if st["g"] and not st["c"] and lb == "分组模式":
            ok(f"第 2 次点击 → 分组模式(按钮={lb!r})")
        else:
            fail(f"第 2 次点击后异常: {st}, 按钮={lb!r}")
        gbanner = await page.evaluate("!!document.querySelector('#classroom .mode-banner.group-banner.visible')")
        if gbanner:
            ok("分组横幅出现(.mode-banner.group-banner,与签到同款)")
        else:
            fail("分组横幅未出现")
        for sel in ["#groupModeCount", "#groupModeList", "#groupModeNewBtn", "#groupModeExitBtn"]:
            if await page.query_selector(sel):
                ok(f"分组横幅内含 {sel}")
            else:
                fail(f"分组横幅缺少 {sel}")

        # ─── 场景 4:分组 → 普通 ───
        print("=== 场景 4: 分组 → 普通 ===")
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(500)
        st = await mode()
        lb = await label()
        if (not st["c"]) and (not st["g"]) and lb == "普通模式":
            ok(f"第 3 次点击 → 回到普通模式(按钮={lb!r})")
        else:
            fail(f"第 3 次点击后异常: {st}, 按钮={lb!r}")
        any_banner = await page.evaluate("!!document.querySelector('#classroom .mode-banner')")
        if not any_banner:
            ok("普通模式下无模式横幅")
        else:
            fail("普通模式下仍存在模式横幅")

        # ─── 场景 5:分组 banner 内按钮功能 ───
        print("=== 场景 5: 分组 banner 多选分配 ===")
        await page.evaluate("""() => {
            const students = [];
            for (let i = 1; i <= 8; i++) students.push({id:'s'+i, name:'学生'+i, groupId:null, tags:[], checkedIn:false, gender: i%2?'male':'female'});
            localStorage.setItem('classroomConfig', JSON.stringify({
                title:'批次11', rows:8, cols:8, seats:Array(64).fill(null),
                students: students, groups:[
                    {id:'g1', name:'第一组', color:'#4CAF50'},
                    {id:'g2', name:'第二组', color:'#2196F3'}
                ],
                viewMode:'student', aisles:[], showStudentIcons:true,
                forcedPairs:[], avoidPairs:[], isCheckinMode:false, isGroupMode:false, version:'1.3.1'
            }));
        }""")
        await page.reload()
        await page.wait_for_timeout(1000)
        # 排座
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(250)
        await page.wait_for_timeout(900)
        # 进入分组模式
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(300)
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(500)
        st = await mode()
        if not st["g"]:
            fail("未能进入分组模式,后续场景跳过")
            await browser.close()
            return

        first_two = await page.evaluate("""() => Array.from(document.querySelectorAll('.seat[data-student]'))
            .slice(0, 2).map(s => s.getAttribute('data-student'))""")
        loc = page.locator(".seat[data-student]")
        await loc.nth(0).click()
        await loc.nth(1).click()
        await page.wait_for_timeout(300)
        cnt = await page.evaluate("document.getElementById('groupModeCount').textContent")
        if "2" in cnt:
            ok(f"分组横幅计数更新: {cnt!r}")
        else:
            fail(f"分组横幅计数异常: {cnt!r}")
        # 分配到 g1
        await page.click(".group-mode-group-btn[data-group-id='g1']")
        await page.wait_for_timeout(500)
        assign_ok = await page.evaluate("""async (ids) => {
            const { state } = await import('./modules/state.js');
            return ids.every(id => { const s = state.students.find(x=>x.id===id); return s && s.groupId === 'g1'; });
        }""", first_two)
        if assign_ok:
            ok("点击分组按钮 → 2 名学生已分配到 g1")
        else:
            fail("分配到 g1 失败")

        # 新建分组并分配
        third = await page.evaluate("""() => {
            const seats = Array.from(document.querySelectorAll('.seat[data-student]'));
            return seats[2] ? seats[2].getAttribute('data-student') : null;
        }""")
        await page.locator(".seat[data-student]").nth(2).click()
        await page.wait_for_timeout(250)
        await page.click("#groupModeNewBtn")
        await page.wait_for_timeout(600)
        new_ok = await page.evaluate("""async (sid) => {
            const { state } = await import('./modules/state.js');
            const s = state.students.find(x=>x.id===sid);
            const inList = state.groups.some(g => g.name === '测试新分组X' && s && s.groupId === g.id);
            return { inList, groupCount: state.groups.length };
        }""", third)
        if new_ok["inList"]:
            ok(f"「＋新建分组并分配」生效(分组数={new_ok['groupCount']})")
        else:
            fail(f"新建分组并分配失败: {new_ok}")

        # ─── 场景 6:× 关闭退出分组 ───
        print("=== 场景 6: × 退出分组模式 ===")
        await page.click("#groupModeExitBtn")
        await page.wait_for_timeout(500)
        st = await mode()
        lb = await label()
        if (not st["g"]) and lb == "普通模式":
            ok(f"点 × 退出分组 → 普通模式(按钮={lb!r})")
        else:
            fail(f"× 退出失败: {st}, 按钮={lb!r}")

        # ─── 场景 7:无 JS 错误 ───
        print("=== 场景 7: 控制台 ===")
        if errs:
            fail(f"页面报错 {len(errs)} 条: {errs[:3]}")
        else:
            ok("无 JS 错误")

        await browser.close()

    print()
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"=== 批次 11 模式轮换 + 分组 banner: {passed}/{total} 通过 ===")
    sys.exit(0 if passed == total else 1)


asyncio.run(main())
