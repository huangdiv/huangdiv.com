# -*- coding: utf-8 -*-
"""
批次 10:模式切换按钮轮换 + 分组模式(座位多选 → 批量分配/新建分组)

覆盖:
1. 原"签到模式"按钮已变为"切换模式"轮换按钮(下拉已删除)
2. 点击按钮:普通 → 签到 → 分组 三态轮换
3. 进入分组模式:classroom 加 group-mode、顶部 .group-banner 出现
4. 座位表点击多选学生 → 高亮 + 计数
5. 点已有分组按钮 → 选中学生统一分配 groupId(持久化)
6. ＋新建分组并分配 → 新建分组 + 分配
7. banner × 退出分组模式
8. 签到/分组互斥(轮换按钮路径)
"""
import asyncio, json, sys
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

        # ─── 场景 1:轮换按钮取代下拉 ───
        print("=== 场景 1: 切换模式轮换按钮 ===")
        old_btn = await page.query_selector("#checkinModeBtn")
        if old_btn:
            fail("旧的 #checkinModeBtn 仍存在(应已改为轮换按钮)")
        else:
            ok("旧的 #checkinModeBtn 已移除")
        ms_btn = await page.query_selector("#modeSwitchBtn")
        if ms_btn:
            ok("新的 #modeSwitchBtn 存在")
        else:
            fail("#modeSwitchBtn 缺失")
        if await page.query_selector("#modeSwitchDropdown"):
            fail("#modeSwitchDropdown 仍存在(应已删除)")
        else:
            ok("#modeSwitchDropdown 已删除(改为点击轮换)")
        label = await page.evaluate("document.getElementById('modeSwitchLabel').textContent")
        if label == "普通模式":
            ok(f"初始按钮文案 = 普通模式({label!r})")
        else:
            fail(f"初始按钮文案异常: {label!r}")

        # ─── 场景 2:普通 → 签到 → 分组 轮换进入分组模式 ───
        print("=== 场景 2: 轮换进入分组模式 ===")
        await page.click("#modeSwitchBtn")          # 普通 → 签到
        await page.wait_for_timeout(400)
        s1 = await page.evaluate("""async () => { const {state}=await import('./modules/state.js'); return {c:state.isCheckinMode,g:state.isGroupMode}; }""")
        if s1["c"] and not s1["g"]:
            ok("第 1 次点击 → 签到模式")
        else:
            fail(f"第 1 次点击后异常: {s1}")
        await page.click("#modeSwitchBtn")          # 签到 → 分组
        await page.wait_for_timeout(500)
        is_group = await page.evaluate("""async () => { const {state}=await import('./modules/state.js'); return state.isGroupMode; }""")
        banner_disp = await page.evaluate("!!document.querySelector('#classroom .mode-banner.group-banner.visible')")
        has_class = await page.evaluate("document.getElementById('classroom').classList.contains('group-mode')")
        if is_group:
            ok("第 2 次点击 → 分组模式(isGroupMode=true)")
        else:
            fail("第 2 次点击后 isGroupMode 未置 true")
        if banner_disp:
            ok("分组横幅显示(.mode-banner.group-banner)")
        else:
            fail("分组横幅未显示")
        if has_class:
            ok("classroom 添加 group-mode 类")
        else:
            fail("classroom 未添加 group-mode 类")

        # ─── 场景 3:座位表多选学生 ───
        print("=== 场景 3: 座位多选 ===")
        await page.evaluate("""() => {
            const students = [];
            for (let i = 1; i <= 8; i++) students.push({id:'s'+i, name:'学生'+i, groupId:null, tags:[], checkedIn:false, gender: i%2?'male':'female'});
            localStorage.setItem('classroomConfig', JSON.stringify({
                title:'批次10', rows:8, cols:8, seats:Array(64).fill(null),
                students: students, groups:[
                    {id:'g1', name:'第一组', color:'#4CAF50'},
                    {id:'g2', name:'第二组', color:'#2196F3'}
                ],
                viewMode:'student', aisles:[{afterCol:2,width:30},{afterCol:4,width:30},{afterCol:6,width:30}],
                showStudentIcons:true, forcedPairs:[], avoidPairs:[], isCheckinMode:false, isGroupMode:true, version:'1.3.1'
            }));
        }""")
        await page.reload()
        await page.wait_for_timeout(1000)
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(300)
        await page.wait_for_timeout(900)
        seated = await page.evaluate("document.querySelectorAll('.seat.empty[data-student]').length")
        named = await page.evaluate("Array.from(document.querySelectorAll('.seat[data-student]')).filter(s => s.getAttribute('data-student')).length")
        if named == 0:
            fail("排座后无学生入座,无法测试多选")
            await browser.close()
            return
        ok(f"排座后有 {named} 个学生入座(空座位残留 data-student: {seated})")

        already = await page.evaluate("""async () => { const {state}=await import('./modules/state.js'); return state.isGroupMode; }""")
        if not already:
            await page.click("#modeSwitchBtn")
            await page.wait_for_timeout(200)
            await page.click("#modeSwitchBtn")
            await page.wait_for_timeout(300)

        first_two = await page.evaluate("""() => {
            const seats = Array.from(document.querySelectorAll('.seat[data-student]'))
                .filter(s => s.getAttribute('data-student')).slice(0, 2);
            return seats.map(s => s.getAttribute('data-student'));
        }""")
        loc = page.locator(".seat[data-student]").filter(has_not_empty := None) if False else page.locator(".seat[data-student]")
        # 点击前两个"有学生"的座位(用 data-student 非空过滤后的索引不可直接用于 locator,改为 evaluate 点击)
        await page.evaluate("""(ids) => {
            ids.forEach(id => {
                const seat = document.querySelector('.seat[data-student="' + id + '"]');
                seat.dispatchEvent(new MouseEvent('click', {bubbles: true}));
            });
        }""", first_two)
        await page.wait_for_timeout(300)
        selected = await page.evaluate("document.querySelectorAll('.seat.group-selected').length")
        if selected == 2:
            ok("点击两个座位 → 2 个 group-selected 高亮")
        else:
            fail(f"选中高亮数应为 2,实际 {selected}")
        cnt_text = await page.evaluate("document.getElementById('groupModeCount').textContent")
        if "2" in cnt_text:
            ok(f"计数显示正确: {cnt_text!r}")
        else:
            fail(f"计数文本异常: {cnt_text!r}")

        # ─── 场景 4:分配到已有分组(g1) ───
        print("=== 场景 4: 批量分配到已有分组 ===")
        await page.click(".group-mode-group-btn[data-group-id='g1']")
        await page.wait_for_timeout(500)
        assign_ok = await page.evaluate("""async (ids) => {
            const { state } = await import('./modules/state.js');
            return ids.every(id => { const s = state.students.find(x=>x.id===id); return s && s.groupId === 'g1'; });
        }""", first_two)
        if assign_ok:
            ok("选中的 2 名学生已分配到 g1(持久化前校验)")
        else:
            fail("分配到 g1 失败")
        cleared = await page.evaluate("document.querySelectorAll('.seat.group-selected').length")
        if cleared == 0:
            ok("分配后选中高亮已清空")
        else:
            fail(f"分配后高亮应清空,实际 {cleared}")

        # ─── 场景 5:新建分组并分配 ───
        print("=== 场景 5: 新建分组并分配 ===")
        third_id = await page.evaluate("""() => {
            const seats = Array.from(document.querySelectorAll('.seat[data-student]'))
                .filter(s => s.getAttribute('data-student'));
            return seats[2] ? seats[2].getAttribute('data-student') : null;
        }""")
        if not third_id:
            fail("无第三个座位可测试新建分组")
        else:
            await page.evaluate("""(sid) => {
                const seat = document.querySelector('.seat[data-student="' + sid + '"]');
                seat.dispatchEvent(new MouseEvent('click', {bubbles: true}));
            }""", third_id)
            await page.wait_for_timeout(200)
            await page.click("#groupModeNewBtn")
            await page.wait_for_timeout(500)
            new_ok = await page.evaluate("""async (sid) => {
                const { state } = await import('./modules/state.js');
                const s = state.students.find(x=>x.id===sid);
                const inList = state.groups.some(g => g.name === '测试新分组X' && s && s.groupId === g.id);
                return { inList, groupCount: state.groups.length };
            }""", third_id)
            if new_ok["inList"]:
                ok(f"新建分组'测试新分组X'并分配第3名学生成功(分组数={new_ok['groupCount']})")
            else:
                fail(f"新建分组并分配失败: {new_ok}")

        # ─── 场景 6:banner × 退出分组模式 ───
        print("=== 场景 6: 退出分组模式 ===")
        await page.click("#groupModeExitBtn")
        await page.wait_for_timeout(300)
        exit_group = await page.evaluate("""async () => { const {state}=await import('./modules/state.js'); return state.isGroupMode; }""")
        exit_class = await page.evaluate("document.getElementById('classroom').classList.contains('group-mode')")
        exit_banner = await page.evaluate("!!document.querySelector('#classroom .mode-banner')")
        if not exit_group and not exit_class and not exit_banner:
            ok("退出分组模式:isGroupMode=false / 无 group-mode 类 / 横幅移除")
        else:
            fail(f"退出分组模式不彻底: isGroupMode={exit_group}, class={exit_class}, banner={exit_banner}")

        # ─── 场景 7:签到/分组互斥(轮换按钮路径:普通→签到,签到中直接进分组) ───
        print("=== 场景 7: 签到与分组互斥 ===")
        await page.click("#modeSwitchBtn")   # 普通 → 签到
        await page.wait_for_timeout(250)
        mid = await page.evaluate("""async () => { const {state}=await import('./modules/state.js'); return {c:state.isCheckinMode,g:state.isGroupMode}; }""")
        if not (mid["c"] and not mid["g"]):
            fail(f"进入签到失败: {mid}")
        await page.click("#modeSwitchBtn")   # 签到 → 分组
        await page.wait_for_timeout(300)
        mutual = await page.evaluate("""async () => {
            const { state } = await import('./modules/state.js');
            return {
                checkin: state.isCheckinMode, group: state.isGroupMode,
                cClass: document.getElementById('classroom').classList.contains('checkin-mode'),
                gClass: document.getElementById('classroom').classList.contains('group-mode')
            };
        }""")
        if (not mutual["checkin"]) and mutual["group"] and (not mutual["cClass"]) and mutual["gClass"]:
            ok("签到 → 分组轮换:签到自动退出(互斥成立)")
        else:
            fail(f"互斥失败: {mutual}")
        # 再点一次回到普通
        await page.click("#modeSwitchBtn")
        await page.wait_for_timeout(300)
        back = await page.evaluate("""async () => { const {state}=await import('./modules/state.js'); return {c:state.isCheckinMode,g:state.isGroupMode}; }""")
        if not back["c"] and not back["g"]:
            ok("第 3 次点击 → 回到普通模式(完整轮换闭环)")
        else:
            fail(f"回到普通模式失败: {back}")

        await browser.close()

    print()
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"=== 批次 10 模式轮换/分组模式: {passed}/{total} 通过 ===")
    print(f"=== dialog 处理: {len(dialogs)} 条 ===")
    sys.exit(0 if passed == total else 1)


asyncio.run(main())
