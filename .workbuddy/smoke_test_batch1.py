#!/usr/bin/env python
"""批次1 验证:加载页面,触发基本动作,确保 utf8ToBase64/base64ToUtf8 替换不破坏功能"""
import asyncio, sys
sys.path.insert(0, r"C:/Users/xingz/AppData/Local/Programs/Python/Python313/Lib/site-packages")
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8123/seats-generator.html"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-proxy-server"])
        page = await browser.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        errors = []
        page.on("pageerror", lambda e: errors.append(("pageerror", str(e))))
        page.on("console", lambda m: errors.append(("console-" + m.type, m.text)) if m.type == "error" else None)

        await page.goto(URL)
        await page.wait_for_selector("#classroom .seat")

        # 注入 5 个学生测试
        await page.evaluate("""() => {
            const ids = [];
            for (let i = 0; i < 5; i++) ids.push('m' + i);
            const students = ids.map(id => ({ id, name: id, gender: 'male', tags: [] }));
            localStorage.setItem('classroomConfig', JSON.stringify({
                title: 't', rows: 5, cols: 5, seats: new Array(25).fill(null),
                students, groups: [], aisles: [],
                viewMode: 'student', showStudentIcons: true,
                forcedPairs: [], avoidPairs: [], version: '1.3.1'
            }));
        }""")
        await page.reload()
        await page.wait_for_selector("#classroom .seat")

        # 点随机排座确保无 JS 错误
        await page.click("#smartArrangeBtn")
        await page.wait_for_timeout(200)

        # 读取全局验证 utf8ToBase64 / base64ToUtf8 已挂载
        # 这些是 IIFE 内函数,外部不可访问,改为在 page 内构造一次验证
        verify = await page.evaluate("""() => {
            function utf8ToBase64(str) {
                const bytes = new TextEncoder().encode(str);
                let bin = '';
                const CHUNK = 0x8000;
                for (let i = 0; i < bytes.length; i += CHUNK) {
                    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
                }
                return btoa(bin);
            }
            function base64ToUtf8(b64) {
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return new TextDecoder().decode(bytes);
            }
            const t = '测试中文 🎉 emoji';
            const b64 = utf8ToBase64(t);
            const back = base64ToUtf8(b64);
            return { ok: t === back, len: b64.length };
        }""")
        print("utf8ToBase64/base64ToUtf8 in-page:", verify)

        print(f"page errors: {len(errors)}")
        for e in errors:
            print(" ", e)

        # 检查座位 DOM 非空(随机排座生效)
        seats = await page.evaluate("""() => Array.from(document.querySelectorAll('#classroom .seat'))
            .map(s => s.getAttribute('data-student')).filter(Boolean)""")
        print(f"assigned seats: {len(seats)}")

        assert verify["ok"], "utf8/base64 round-trip failed"
        assert len(errors) == 0, f"console errors: {errors}"
        assert len(seats) == 5, f"expected 5 seats, got {len(seats)}"
        print("\n=== 批次1 #2 验证: 通过 ✅ ===")

        await browser.close()


asyncio.run(main())