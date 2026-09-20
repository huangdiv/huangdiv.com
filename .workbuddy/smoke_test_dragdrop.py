import asyncio
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8123/seats-generator.html"

async def main():
    errors = []
    console_errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: errors.append(f"PAGEERROR: {e}"))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        resp = await page.goto(URL, wait_until="networkidle", timeout=30000)
        print("HTTP:", resp.status if resp else "N/A")
        await page.wait_for_timeout(800)

        # ── 场景 1: 基础加载(确认事件已绑定、无错误) ──
        basic = {
            "seats": await page.evaluate("document.querySelectorAll('#classroom .seat').length"),
            "students": await page.evaluate("document.querySelectorAll('#studentList .student-item').length"),
            "deleteZone": await page.evaluate("!!document.getElementById('deleteZone')"),
            "dragHint": await page.evaluate("!!document.getElementById('dragHint')"),
        }
        print("初始状态:", basic)
        assert basic["seats"] == 64
        assert basic["deleteZone"]
        assert basic["dragHint"]

        # ── 场景 2: 程序化触发 dragstart,验证 handleDragStart 不报错 ──
        # 模拟从一个非座位元素触发,应该早返回
        result = await page.evaluate("""() => {
            try {
                const target = document.querySelector('#classroom');
                const fakeEvent = new DragEvent('dragstart', { bubbles: true, cancelable: true });
                target.dispatchEvent(fakeEvent);
                return 'ok';
            } catch (e) {
                return 'err: ' + e.message;
            }
        }""")
        print("dragstart(无效目标):", result)
        assert result == 'ok'

        # ── 场景 3: 程序化触发 dragover / drop 在无效目标 ──
        result = await page.evaluate("""() => {
            try {
                const target = document.querySelector('#classroom');
                target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
                return 'ok';
            } catch (e) {
                return 'err: ' + e.message;
            }
        }""")
        print("dragover/drop 无效目标:", result)
        assert result == 'ok'

        # ── 场景 4: 点击 modeSwitchBtn(轮换)触发 clearDragHighlights ──
        # toggleCheckinMode 内部调用 clearDragHighlights();这是关键的回调路径
        await page.click("#modeSwitchBtn")   # 普通 → 签到
        await page.wait_for_timeout(300)
        banner_visible = await page.evaluate("!!document.querySelector('#classroom .mode-banner.checkin-banner.visible')")
        assert banner_visible, "签到 banner 未出现"
        await page.click("#modeSwitchBtn")   # 签到 → 分组
        await page.wait_for_timeout(300)
        await page.click("#modeSwitchBtn")   # 分组 → 普通
        await page.wait_for_timeout(300)
        # clearDragHighlights 应不报错,且 banner 消失
        banner_after = await page.evaluate("!!document.querySelector('#classroom .mode-banner')")
        assert not banner_after, "退出签到后 banner 应消失"

        # ── 场景 5: 模拟 dragenter / dragleave 座位高亮切换 ──
        # 由于初始无学生,空座位可作为 target
        result = await page.evaluate("""() => {
            const seat = document.querySelector('#classroom .seat');
            try {
                seat.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
                const hasHighlight1 = seat.classList.contains('highlight');
                seat.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: document.body }));
                const hasHighlight2 = seat.classList.contains('highlight');
                return [hasHighlight1, hasHighlight2];
            } catch (e) {
                return 'err: ' + e.message;
            }
        }""")
        print("dragenter/dragleave 座位高亮切换:", result)
        assert result[0] == True, f"dragenter 后应有 highlight,实际 {result[0]}"
        assert result[1] == False, f"dragleave 后应取消 highlight,实际 {result[1]}"

        # ── 场景 6: 验证 clearDragHighlights 公开方法可调用 ──
        # 通过轮换按钮完整走一遍三态,间接验证
        await page.click("#modeSwitchBtn")   # 普通 → 签到
        await page.wait_for_timeout(200)
        await page.click("#modeSwitchBtn")   # 签到 → 分组
        await page.wait_for_timeout(200)
        await page.click("#modeSwitchBtn")   # 分组 → 普通
        await page.wait_for_timeout(200)
        # 此时已多次进出签到,clearDragHighlights 被调用多次,应不报错
        final_seats = await page.evaluate("document.querySelectorAll('#classroom .seat').length")
        assert final_seats == 64

        print("\nerrors:", errors or "无")
        print("console errors:", console_errors or "无")

        await page.screenshot(path=r"C:\Users\xingz\WorkBuddy\Worktrees\huangdiv.com\master-93f997c3\.workbuddy\smoke_test_dragdrop.png", full_page=False)
        await browser.close()

    ok = (not errors) and (not console_errors)
    print("\n=== 模块化 dragdrop 验证:", "通过 ✅" if ok else "失败 ❌", "===")

asyncio.run(main())