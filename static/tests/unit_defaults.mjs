// =====================================================================
// tests/unit_defaults.mjs
//
// Node ESM 单元测试 — 默认座位表布局(批次 8)
//
// 覆盖:
//   A. state.js 默认值:rows=8 / cols=8 / aisles=[{2,30},{4,30},{6,30}]
//   B. migrate.js 常量:DEFAULT_ROWS=8 / DEFAULT_COLS=8
//   C. migrate.js 默认 aisles 钳制逻辑(无效 → [];有效 → 保留 width)
//   D. 第一行 seats 长度等于 8*8=64
//
// 运行:  node static/tests/unit_defaults.mjs
// 退出码:0 = 全部通过;非 0 = 有失败。
// =====================================================================

// state.js 顶层声明里读 location.search,沙箱里给个空字符串即可
globalThis.location = { search: '' };

const { state } = await import('../modules/state.js');
const { migrateConfig, DEFAULT_ROWS, DEFAULT_COLS } = await import('../modules/migrate.js');

// === TAP runner ===
let __passed__ = 0;
let __failed__ = 0;
const __failures__ = [];
let __current__ = '';

function group(name, fn) {
    __current__ = name;
    console.log(`\n# ${name}`);
    try { fn(); }
    catch (e) {
        __failed__++;
        __failures__.push({ group: name, error: e });
        console.log(`  ! group threw: ${e.message}`);
    }
}

function test(name, fn) {
    const fullName = `${__current__} > ${name}`;
    try {
        fn();
        __passed__++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        __failed__++;
        __failures__.push({ name: fullName, error: e });
        console.log(`  ✗ ${name}`);
        console.log(`      ${e.message}`);
    }
}

function assertEq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg ? msg + ': ' : '') + `expected ${e}, got ${a}`);
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

group('A. state.js 默认值 — 8×8 + 第 2/4/6 列后 30px 走道', () => {
    test('rows = 8', () => assertEq(state.rows, 8));
    test('cols = 8', () => assertEq(state.cols, 8));
    test('seats 长度 = 64', () => {
        assert(Array.isArray(state.seats));
        assertEq(state.seats.length, 64);
        assertEq(state.seats.every(s => s === null), true);
    });
    test('aisles = [{2,30},{4,30},{6,30}](按 afterCol 升序)', () => {
        assertEq(state.aisles, [
            { afterCol: 2, width: 30 },
            { afterCol: 4, width: 30 },
            { afterCol: 6, width: 30 }
        ]);
    });
});

group('B. migrate.js 常量 — DEFAULT_ROWS/DEFAULT_COLS = 8', () => {
    test('DEFAULT_ROWS = 8', () => assertEq(DEFAULT_ROWS, 8));
    test('DEFAULT_COLS = 8', () => assertEq(DEFAULT_COLS, 8));
});

group('C. migrate.js — aisles 钳制逻辑', () => {
    test('无 aisles → 默认空数组(与 state.js 的 3 条默认不同;migrate 仅做清洗)', () => {
        const r = migrateConfig({ rows: 8, cols: 8, seats: Array(64).fill(null) });
        assertEq(r.aisles, []);
    });

    test('合法 aisles → 保留 afterCol + width(规范化整数)', () => {
        const r = migrateConfig({
            rows: 8, cols: 8, seats: Array(64).fill(null),
            aisles: [
                { afterCol: '2', width: '30' },
                { afterCol: 4, width: 30 },
                { afterCol: 6, width: 30 }
            ]
        });
        assertEq(r.aisles, [
            { afterCol: 2, width: 30 },
            { afterCol: 4, width: 30 },
            { afterCol: 6, width: 30 }
        ]);
    });

    test('越界 afterCol → 过滤掉(afterCol >= cols)', () => {
        const r = migrateConfig({
            rows: 8, cols: 8, seats: Array(64).fill(null),
            aisles: [{ afterCol: 7 }, { afterCol: 8 }, { afterCol: 9 }, { afterCol: 6, width: 30 }]
        });
        // 8 列时合法 afterCol ∈ [0,7];afterCol=7 合法(width 缺省 → 50),
        // afterCol=8/9 越界 → 过滤
        assertEq(r.aisles, [
            { afterCol: 7, width: 50 },
            { afterCol: 6, width: 30 }
        ]);
    });

    test('非法 aisles(字符串 / null) → 默认 []', () => {
        const r1 = migrateConfig({ rows: 8, cols: 8, seats: Array(64).fill(null), aisles: 'invalid' });
        assertEq(r1.aisles, []);
        const r2 = migrateConfig({ rows: 8, cols: 8, seats: Array(64).fill(null), aisles: null });
        assertEq(r2.aisles, []);
    });
});

group('D. migrate.js — 默认 8×8 fallback', () => {
    test('rows 非法 → 默认 8', () => {
        const r = migrateConfig({ rows: -1, cols: 8, seats: Array(64).fill(null) });
        assertEq(r.rows, 8);
    });
    test('cols 非法 → 默认 8', () => {
        const r = migrateConfig({ rows: 8, cols: 999, seats: Array(64).fill(null) });
        assertEq(r.cols, 8);
    });
    test('空配置 → 全默认 8×8', () => {
        const r = migrateConfig({});
        assertEq(r.rows, 8);
        assertEq(r.cols, 8);
        assertEq(r.seats.length, 64);
    });
});

// === 收尾 ===
console.log('\n' + '='.repeat(60));
console.log(`总计: ${__passed__} 通过, ${__failed__} 失败`);
if (__failed__ > 0) {
    console.log('\n失败明细:');
    __failures__.forEach(f => {
        console.log(`  - [${f.name || f.group}] ${f.error.message}`);
    });
    process.exit(1);
} else {
    console.log('✅ 全部通过');
    process.exit(0);
}