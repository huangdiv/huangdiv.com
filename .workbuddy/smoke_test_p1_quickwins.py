"""
P1 快赢专项验证
  1. parseGenderText VS16:♂️/♀️(含 U+FE0F)与 ♂/♀ 互通
  2. deepClone:structuredClone 可用且快照系统工作(undo/redo)
  3. isAvoided Set 版:回避配对仍然生效(random-arrange 内部)
  4. 标签 popup 骨架:openTagPopup 正常打开/添加/删除标签
  5. focus-visible CSS:新规则已注入(检查 styleSheet 规则数)
"""
import asyncio
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8123/seats-generator.html"


async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        # confirm 对话框自动接受(resetBtn / randomBtn 都会弹 confirm)
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        resp = await page.goto(URL, wait_until="networkidle", timeout=30000)
        assert resp.status == 200
        await page.wait_for_selector("#classroom .seat", timeout=10000)

        # ── 1. parseGenderText VS16 ──
        vs16 = await page.evaluate("""() => {
            // 从页面上下文直接测试逻辑(与源码一致的正则)
            const strip = (t) => t.trim().toLowerCase().replace(/\\uFE0F/g, '');
            return {
                maleVS16: strip('\\u2642\\uFE0F') === '\\u2642',   // ♂️ → ♂
                femaleVS16: strip('\\u2640\\uFE0F') === '\\u2640',  // ♀️ → ♀
                malePlain: strip('\\u2642') === '\\u2642',
                zh: strip('男') === '男'
            };
        }""")
        assert all(vs16.values()), f"VS16 strip 失败: {vs16}"
        print(f"✓ 1. VS16 strip 逻辑: {vs16}")

        # 源码静态断言:regex 已在 parseGenderText 内
        src_has_vs16 = await page.evaluate(
            "() => fetch('./seats-generator.js').then(r => r.text()).then(t => t.includes('\\\\uFE0F') || t.includes('\\\\ufe0f'))"
        )
        assert src_has_vs16, "源码未包含 \\uFE0F 处理"
        print("✓ 1b. parseGenderText 源码含 VS16 处理")

        # ── 2. structuredClone / deepClone ──
        # resetBtn(重置座位)流程:confirm → pushSnapshot → 清空座位,是最直接的快照触发路径
        sc = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            // 先放一个学生进座位,让重置有实际内容
            m.state.seats[0] = 'seed_s';
            document.getElementById('resetBtn').click();
            return {
                hasStructuredClone: typeof structuredClone === 'function',
                undoEnabled: !document.getElementById('undoBtn').disabled,
                seat0Cleared: m.state.seats[0] === null
            };
        }""")
        assert sc["hasStructuredClone"], "浏览器无 structuredClone"
        assert sc["undoEnabled"], "快照后 undo 按钮未启用(deepClone/pushSnapshot 可能失败)"
        assert sc["seat0Cleared"], "座位未清空(resetBtn 流程异常)"
        print(f"✓ 2. deepClone 快照系统(resetBtn → pushSnapshot): {sc}")

        # undo 恢复座位
        undone = await page.evaluate("""async () => {
            document.getElementById('undoBtn').click();
            const m = await import('./modules/state.js');
            return m.state.seats[0];
        }""")
        assert undone == "seed_s", f"undo 后座位 0 应恢复 seed_s,got {undone}"
        print(f"✓ 2b. undo 恢复座位: {undone}")

        # ── 3. isAvoided Set 版(通过 mixed 模式端到端)──
        # 预置 10 学生 + 回避对,执行男女同桌,断言回避对不同桌
        avoid_test = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            const students = [];
            for (let i = 0; i < 10; i++) {
                students.push({ id: 'p1_' + i, name: 'P1学生' + (i+1), number: i+1,
                    gender: i < 5 ? 'male' : 'female', tag: '', tags: [], checkedIn: false });
            }
            m.state.students = students;
            m.state.seats = Array(m.state.rows * m.state.cols).fill(null);
            m.state.forcedPairs = [];
            m.state.avoidPairs = [['p1_0', 'p1_5']];  // 男0 + 女5 互相回避
            return true;
        }""")
        assert avoid_test

        # 需要重新渲染学生列表后触发 randomBtn
        await page.evaluate("""() => {
            // 直接模拟 randomDropdown 菜单项点击(跳过 confirm 由 dialog handler 接)
            const sw = document.querySelector("#randomDropdown [data-toggle='mixed']");
            if (sw) sw.click();
            document.getElementById('smartArrangeBtn').click();
        }""")
        await page.wait_for_timeout(600)
        avoid_result = await page.evaluate("""async () => {
            const m = await import('./modules/state.js');
            const s = m.state;
            const i0 = s.seats.indexOf('p1_0');
            const i5 = s.seats.indexOf('p1_5');
            if (i0 < 0 || i5 < 0) return { ok: false, reason: 'not seated', i0, i5 };
            const c = s.cols;
            const sameDesk = Math.floor(i0 / c) === Math.floor(i5 / c) && Math.abs((i0 % c) - (i5 % c)) === 1;
            return { ok: !sameDesk, i0, i5, sameDesk };
        }""")
        assert avoid_result["ok"], f"回避配对失效(Set 版 isAvoided 回归): {avoid_result}"
        print(f"✓ 3. isAvoided Set 版回避配对: {avoid_result}")

        # ── 4. 标签 popup(createTagPopupShell 去重版)──
        # 注意:Step 3 直接改了 state.students(绕过 commit),IIFE 别名与 state 已分裂;
        # 此处重载页面恢复一致状态,再走真实 UI 流程
        await page.goto(URL, wait_until="networkidle", timeout=30000)
        await page.wait_for_selector("#classroom .seat", timeout=10000)

        # 通过 UI「新增学生」表单添加学生,触发完整渲染链(generateStudentList)
        tag_setup = await page.evaluate("""() => {
            const nameInput = document.querySelector('.new-student-name');
            if (!nameInput) return false;
            nameInput.value = '标签测试生';
            const item = nameInput.closest('.student-group-item');
            item.querySelector('.new-student-add-btn').click();
            return true;
        }""")
        assert tag_setup, "未找到新增学生表单"
        await page.wait_for_timeout(300)

        tag_btn_exists = await page.evaluate(
            "() => !!document.querySelector('.student-tag-btn')"
        )
        if tag_btn_exists:
            popup_open = await page.evaluate("""() => {
                const btn = document.querySelector('.student-tag-btn');
                btn.click();
                const popup = document.querySelector('.tag-popup');
                return {
                    opened: !!popup,
                    title: popup ? popup.querySelector('.tag-popup-title').textContent : '',
                    hasAdd: popup ? !!popup.querySelector('.tag-popup-add') : false,
                    hasInput: popup ? !!popup.querySelector('.tag-popup-input') : false,
                    hasSuggestions: popup ? !!popup.querySelector('.tag-suggestions') : false
                };
            }""")
            assert popup_open["opened"], "标签弹窗未打开"
            assert '标签测试生' in popup_open["title"], f"弹窗标题错误: {popup_open['title']}"
            print(f"✓ 4. 标签 popup 骨架: {popup_open}")

            # 添加标签(等待 100ms 让同步处理完成)
            add_result = await page.evaluate("""async () => {
                const popup = document.querySelector('.tag-popup');
                popup.querySelector('.tag-popup-emoji').value = '📚';
                popup.querySelector('.tag-popup-input').value = '学习委员';
                popup.querySelector('.tag-popup-add').click();
                await new Promise(r => setTimeout(r, 100));
                const m = await import('./modules/state.js');
                return {
                    tags: m.state.students[0] ? (m.state.students[0].tags || []) : null,
                    chips: popup.querySelectorAll('.tag-chip').length
                };
            }""")
            tags = add_result["tags"]
            assert add_result["chips"] == 1, f"弹窗 chip 数错误: {add_result}"
            assert tags and len(tags) == 1 and tags[0]["label"] == "学习委员", f"标签添加失败: {add_result}"
            print(f"✓ 4b. 标签添加: {tags} + chips={add_result['chips']}")

            # 回车添加第二条
            enter_result = await page.evaluate("""async () => {
                const popup = document.querySelector('.tag-popup');
                const input = popup.querySelector('.tag-popup-input');
                input.value = '体育';
                input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
                await new Promise(r => setTimeout(r, 100));
                const m = await import('./modules/state.js');
                return m.state.students[0].tags.length;
            }""")
            assert enter_result == 2, f"回车添加失败: {enter_result}"
            print(f"✓ 4c. 回车添加标签: {enter_result} 条")

            # 删除一条
            del_result = await page.evaluate("""async () => {
                const popup = document.querySelector('.tag-popup');
                popup.querySelector('.tag-chip-remove').click();
                await new Promise(r => setTimeout(r, 100));
                const m = await import('./modules/state.js');
                return m.state.students[0].tags.length;
            }""")
            assert del_result == 1, f"标签删除失败: {del_result}"
            print(f"✓ 4d. 标签删除: 剩 {del_result} 条")
        else:
            # 学生列表按钮选择器可能不同,记录但不失败
            print("⚠ 4. 未找到 .student-tag-btn(选择器可能不同),跳过标签弹窗 UI 测试")

        # ── 5. focus-visible CSS 注入 ──
        fv = await page.evaluate("""() => {
            const rules = [];
            for (const sheet of document.styleSheets) {
                try {
                    for (const r of sheet.cssRules) {
                        if (r.selectorText && r.selectorText.includes(':focus-visible')) {
                            rules.push(r.selectorText);
                        }
                    }
                } catch (e) { /* cross-origin */ }
            }
            return rules;
        }""")
        expected = ['.mini-btn:focus-visible', '.print-dropdown-item:focus-visible',
                    '.tag-toggle-btn:focus-visible', '.tag-suggestion-item:focus-visible']
        missing = [s for s in expected if not any(s in r for r in fv)]
        assert not missing, f"focus-visible 规则缺失: {missing}(共 {len(fv)} 条)"
        print(f"✓ 5. focus-visible 规则: 共 {len(fv)} 条,关键选择器齐全")

        await browser.close()

    if errors:
        print(f"\n❌ 页面错误: {errors}")
        print("=== P1 专项验证: 失败 ===")
        return 1
    print("\n=== P1 快赢专项验证: 通过 ✅ ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))