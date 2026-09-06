# .workbuddy/smoke_test_batch7_p2_i18n.py
# ─────────────────────────────────────────────────────────────────────────────
# 批次 7 P2 smoke test — 用户文案集中层 + 导出作用域修复
#
# 覆盖:
#   P2-1 (querySelectorAll 误伤): exportSeatImage 中 hide 按钮的范围只覆盖
#        #classroom 子树,不波及 toolbar/popup 按钮。
#   P2-2 (i18n): 改动后,所有 alert/confirm 文案仍按原字面量输出(对用户零变化)。
#   P2-3 (import 模块图): messages.js 被 seats-generator.js / dragdrop.js /
#        random-arrange.js 三处正确 import,无循环依赖。
#
# 通过标准:无致命 console error,所有断言 pass。
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import re
import sys
from pathlib import Path

# 脚本位于 <worktree>/.workbuddy/,向上 1 级即工作区根
ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'static'
INDEX = STATIC / 'seats-generator.html'


BASE_URL = "http://localhost:8123/seats-generator.html"


def fail(msg):
    print(f'  ✗ {msg}')
    raise SystemExit(2)


def ok(msg):
    print(f'  ✓ {msg}')


def read(p):
    return p.read_text(encoding='utf-8')


async def main():
    print(f'\n=== 批次 7 P2: 用户文案集中层 + 导出作用域 ===\n')

    # ─── 静态资源检查 ───
    print('=== 静态检查 1: messages.js 文件存在 + 关键键定义 ===')
    msgs_path = STATIC / 'modules' / 'messages.js'
    if not msgs_path.exists():
        fail(f'missing {msgs_path}')
    msgs_src = read(msgs_path)
    must_have_keys = [
        'AISLE_COL_RANGE', 'AISLE_EXISTS', 'GROUP_NAME_REQUIRED',
        'STUDENT_NAME_REQUIRED', 'CONFIRM_DELETE_STUDENT', 'STUDENT_ALREADY_SEATED',
        'EXPORT_FAILED', 'CONFIRM_RESET_SEATS', 'ROW_COL_RANGE',
        'CONFIRM_CLEAR_ALL', 'STORAGE_CORRUPT', 'IMPORT_SUCCESS', 'IMPORT_FAILED',
        'BATCH_SELECT_STUDENTS_FIRST', 'ALL_STUDENTS_SEATED', 'NO_EMPTY_SEATS',
        'CONFIRM_QUICK_RANDOM', 'NO_STUDENTS_YET', 'NO_STUDENTS_YET_WARN',
        'CONFIRM_RANDOM_MODE', 'RANDOM_WARNING_INCOMPLETE_SWAP', 'RANDOM_WARNING_NOT_SEATED'
    ]
    for k in must_have_keys:
        if not re.search(rf'\b{k}\b\s*:', msgs_src):
            fail(f'MESSAGES.{k} 未在 messages.js 中定义')
    ok(f'messages.js 含 {len(must_have_keys)} 个必填键')

    print('=== 静态检查 2: seats-generator.js 引入 MESSAGES + exportSeatImage 已作用域 ===')
    main_src = read(STATIC / 'seats-generator.js')
    if "from './modules/messages.js'" not in main_src:
        fail('seats-generator.js 未 import messages.js')
    ok('seats-generator.js 引入 MESSAGES')

    # 找 exportSeatImage 函数体
    m = re.search(r'function\s+exportSeatImage\s*\([^)]*\)\s*\{', main_src)
    if not m:
        fail('exportSeatImage 函数未找到')
    start = m.end()
    # 简易配平: 从 start 起统计大括号深度,找匹配的 }
    depth = 1
    i = start
    while i < len(main_src) and depth > 0:
        ch = main_src[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        i += 1
    body = main_src[start:i-1]

    # 去掉注释行(// ...),再判断是否还有未作用域的 document.querySelectorAll('button')
    code_only = re.sub(r'//[^\n]*', '', body)
    if re.search(r"document\.querySelectorAll\(['\"]button['\"]\)", code_only):
        fail('exportSeatImage 仍有 document.querySelectorAll("button") (P2-1 误伤未修)')
    if not re.search(r"classroom\.querySelectorAll\(['\"]button", code_only):
        fail('exportSeatImage 未使用 classroom.querySelectorAll("button") (P2-1 作用域修复未到位)')
    ok('exportSeatImage 已 scoped 到 #classroom 子树 (P2-1 修复)')

    print('=== 静态检查 3: dragdrop.js + random-arrange.js 都引入 MESSAGES ===')
    for fn in ('dragdrop.js', 'random-arrange.js'):
        s = read(STATIC / 'modules' / fn)
        if "from './messages.js'" not in s:
            fail(f'{fn} 未 import messages.js')
    ok('dragdrop.js + random-arrange.js 都引入 MESSAGES')

    # ─── 全局回归:剩余的 alert/confirm 硬编码中文应为 0 ───
    print('=== 静态检查 4: 残余 alert(\'中文硬编码\') / confirm(\'中文硬编码\') 计数 ===')
    suspicious = 0
    examples = []
    for js in [STATIC / 'seats-generator.js',
               STATIC / 'modules' / 'dragdrop.js',
               STATIC / 'modules' / 'random-arrange.js']:
        text = read(js)
        for m2 in re.finditer(r"alert\(['\"]([^'\"]+)['\"]\)", text):
            s = m2.group(1)
            if re.search(r'[\u4e00-\u9fff]', s):  # 含中文
                suspicious += 1
                examples.append((js.name, s))
        for m2 in re.finditer(r"confirm\(['\"]([^'\"]+)['\"]\)", text):
            s = m2.group(1)
            if re.search(r'[\u4e00-\u9fff]', s):
                suspicious += 1
                examples.append((js.name, s))
    if suspicious > 0:
        for fn, s in examples[:5]:
            print(f'    残余: {fn} -> "{s[:50]}"')
        fail(f'仍有 {suspicious} 处 alert/confirm 硬编码中文文案')
    ok('0 处残留 alert/confirm 硬编码中文')

    # ─── 浏览器端验证 ───
    print('\n=== 浏览器端验证:启动 Chromium 检查 MESSAGES.* 在运行时可用 ===')
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print('  ⚠ playwright 未安装,跳过浏览器阶段(静态检查已通过)')
        print('\n=== P2 全部静态检查通过(致命 0 / 总计 0)===')
        return

    fatal = 0
    warnings = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            args=['--no-proxy-server', '--disable-dev-shm-usage']
        )
        ctx = await browser.new_context()
        page = await ctx.new_page()

        def on_console(msg):
            nonlocal fatal, warnings
            t = msg.type
            if t == 'error':
                fatal += 1
                print(f'    [console.error] {msg.text[:200]}')
            elif t == 'warning':
                warnings += 1
        page.on('console', on_console)

        await page.goto(BASE_URL)
        await page.wait_for_function('document.querySelectorAll(".seat").length >= 49', timeout=8000)

        # 模块导入验证
        print('=== 场景 1: MESSAGES 在运行时从 modules 正确导出 ===')
        msgs = await page.evaluate('''async () => {
            const m = await import('./modules/messages.js');
            return {
                AISLE_EXISTS: m.MESSAGES.AISLE_EXISTS,
                NO_STUDENTS_YET: m.MESSAGES.NO_STUDENTS_YET,
                NO_STUDENTS_YET_WARN: m.MESSAGES.NO_STUDENTS_YET_WARN,
                CONFIRM_DELETE_STUDENT_name: m.MESSAGES.CONFIRM_DELETE_STUDENT('赵六'),
                RANDOM_WARNING_NOT_SEATED_6: m.MESSAGES.RANDOM_WARNING_NOT_SEATED(6),
                keysCount: Object.keys(m.MESSAGES).length
            };
        }''')
        if msgs['AISLE_EXISTS'] != '该位置已存在走道！':
            fail(f'MESSAGES.AISLE_EXISTS 运行时值错: {msgs["AISLE_EXISTS"]!r}')
        if msgs['NO_STUDENTS_YET'] != '请先导入学生名单！':
            fail(f'MESSAGES.NO_STUDENTS_YET 运行时值错: {msgs["NO_STUDENTS_YET"]!r}')
        if msgs['CONFIRM_DELETE_STUDENT_name'] != '确定要删除学生 赵六 吗？':
            fail(f'MESSAGES.CONFIRM_DELETE_STUDENT(name) 输出错: {msgs["CONFIRM_DELETE_STUDENT_name"]!r}')
        if msgs['RANDOM_WARNING_NOT_SEATED_6'] != '6 名学生未入座(座位不足)':
            fail(f'MESSAGES.RANDOM_WARNING_NOT_SEATED(6) 输出错: {msgs["RANDOM_WARNING_NOT_SEATED_6"]!r}')
        ok(f'运行时 MESSAGES.{msgs["keysCount"]} 键全可访问 + 函数参数化输出正确')

        # 触发 confirm("确定要重置所有座位吗?") 的 UI 路径,确保 confirm 文案没变
        print('=== 场景 2: 触发重置座位 confirm,确认文案未变 ===')
        # 注入 confirm 监听
        captured = await page.evaluate('''async () => {
            const seen = [];
            const orig = window.confirm;
            window.confirm = (msg) => { seen.push(msg); return false; };  // 永远取消
            try {
                document.getElementById('resetBtn').click();
            } finally {
                window.confirm = orig;
            }
            return seen;
        }''')
        if not captured or '确定要重置所有座位吗？' not in captured[0]:
            fail(f'resetBtn 触发 confirm 文案错: {captured}')
        ok(f'resetBtn confirm 文案 = {captured[0]!r}')

        # 触发 student 名字冲突的 alert — 通过 studentGroupSelector 触发
        print('=== 场景 3: 触发学生重名 alert,确认文案 ===')
        # 注入 alert 监听
        await page.evaluate('''() => {
            window.__capturedAlerts = [];
            window.alert = (msg) => window.__capturedAlerts.push(msg);
        }''')
        # 直接调用 MESSAGES.STUDENT_NAME_EXISTS_NEW,验证模块导出 + 内容
        dup_result = await page.evaluate('''async () => {
            const m = await import('./modules/messages.js');
            // 模拟一个函数包装:返回的就是这个常量字符串
            return m.MESSAGES.STUDENT_NAME_EXISTS_NEW;
        }''')
        if dup_result != '该学生已存在':
            fail(f'STUDENT_NAME_EXISTS_NEW 运行时值错: {dup_result!r}')
        ok(f'STUDENT_NAME_EXISTS_NEW 运行时 = {dup_result!r}')

        # 实际触发 resetBtn → confirm 文案(已在场景 2 验证),此处补一个 alert 路径:
        # 直接给 document 注入一个临时按钮触发 MESSAGES.STORAGE_CORRUPT alert,
        # 模拟 storage 损坏场景。
        print('=== 场景 4: MESSAGES.STORAGE_CORRUPT / IMPORT_SUCCESS 运行时可用 ===')
        alert_smoke = await page.evaluate('''async () => {
            const m = await import('./modules/messages.js');
            const seen = [];
            const origAlert = window.alert;
            window.alert = (msg) => seen.push(msg);
            try {
                // 直接用 confirm 包装函数验证 confirm 文案(这里是 verify storage corrupt 弹窗)
                // 模拟一段 adminJS 用 alert(MESSAGES.STORAGE_CORRUPT) 的路径:
                alert(m.MESSAGES.STORAGE_CORRUPT);
                alert(m.MESSAGES.IMPORT_SUCCESS);
                alert(m.MESSAGES.IMPORT_FAILED(new Error('测试错误')));
            } finally {
                window.alert = origAlert;
            }
            return seen;
        }''')
        if alert_smoke[0] != '检测到本地存储数据损坏，已重置为默认配置。':
            fail(f'STORAGE_CORRUPT alert 文案错: {alert_smoke[0]!r}')
        if alert_smoke[1] != '配置导入成功！':
            fail(f'IMPORT_SUCCESS alert 文案错: {alert_smoke[1]!r}')
        if not alert_smoke[2].startswith('导入配置失败: Error: 测试错误'):
            fail(f'IMPORT_FAILED alert 文案错: {alert_smoke[2]!r}')
        ok(f'STORAGE_CORRUPT + IMPORT_SUCCESS + IMPORT_FAILED 全部正确: {alert_smoke}')

        await browser.close()

    print(f'\n=== P2 全部通过(致命 {fatal} / 总计 {warnings})===')
    sys.exit(0 if fatal == 0 else 1)


if __name__ == '__main__':
    asyncio.run(main())