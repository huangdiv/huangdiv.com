// =====================================================================
// tests/unit_version_sync.mjs
//
// 版本号一致性守卫(Node ESM 单测,不需要浏览器)
//
// 为什么需要这个测试:
//   GitHub Pages 给静态资源发 `Cache-Control: max-age=600`,
//   而入口脚本 <script type="module" src="seats-generator.js"> 的 URL 不变,
//   于是「发版后十分钟内,用户看到的还是旧代码」—— 曾导致
//   v1.4.3 修好的 bug 在浏览器里"没修复",页面版本号也还是旧的。
//
//   修法是在 HTML 的入口脚本上带查询串 `?v=<版本>`,每次发版 URL 变化。
//   但这要求「三个地方 + 两个静态占位」始终一致,靠人记必然漏:
//     · static/modules/migrate.js  APP_VERSION
//     · static/seats-generator.js   APP_VERSION
//     · static/seats-generator.html 入口脚本 ?v=
//     · static/seats-generator.html #appVersion / #appInfoVersion 的静态兜底文字
//   ⇒ 用本测试把它们钉死。
//
// 覆盖场景:
//   A. 两处 APP_VERSION 完全一致
//   B. 版本号形如 x.y.z
//   C. HTML 入口脚本带 ?v= 且等于 APP_VERSION
//   D. HTML 两处静态兜底版本 = APP_VERSION(JS 还没跑/加载失败时也不显示错版本)
//   E. 入口脚本必须只有一个(防止误加第二个 module 入口)
//
// 运行:  node static/tests/unit_version_sync.mjs
// 退出码:0 = 全部通过;非 0 = 有失败。
// =====================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { APP_VERSION as MIGRATE_VERSION } from '../modules/migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(__dirname, '..');

const htmlSrc = readFileSync(resolve(STATIC_DIR, 'seats-generator.html'), 'utf8');
const appSrc = readFileSync(resolve(STATIC_DIR, 'seats-generator.js'), 'utf8');

// === 简单 TAP 风格 runner(与其它 unit_*.mjs 保持一致) ===
let __passed__ = 0;
let __failed__ = 0;
const __failures__ = [];
let __current__ = '';

function group(name, fn) {
    __current__ = name;
    console.log(`\n# ${name}`);
    try {
        fn();
    } catch (e) {
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
    if (actual !== expected) {
        throw new Error(`${msg}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    }
}

function assertOk(cond, msg) {
    if (!cond) throw new Error(msg);
}

// ---- 从源码里抠版本 ----
function parseAppVersion(src, label) {
    const m = src.match(/const\s+APP_VERSION\s*=\s*'([^']+)'/);
    if (!m) throw new Error(`${label} 里找不到 const APP_VERSION = '...'`);
    return m[1];
}

const APP_VERSION = parseAppVersion(appSrc, 'seats-generator.js');

// ---- 从 HTML 里抠三处信息 ----
function parseScriptTags(src) {
    return Array.from(src.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*>/gi))
        .map((m) => m[0]);
}

function attrOf(tag, name) {
    const m = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
    return m ? m[1] : null;
}

const moduleTags = parseScriptTags(htmlSrc);
const entryTag = moduleTags.find((t) => (attrOf(t, 'src') || '').startsWith('seats-generator.js')) || '';
const entrySrc = attrOf(entryTag, 'src') || '';

function parseFallback(id) {
    const re = new RegExp(`id=["']${id}["'][^>]*>\\s*v?\\s*(\\d+(?:\\.\\d+)*)\\s*<`, 'i');
    const m = htmlSrc.match(re);
    return m ? m[1] : null;
}

// =====================================================================
// A. 两处 APP_VERSION 一致
// =====================================================================
group('A. 两处 APP_VERSION 一致(migrate.js ↔ seats-generator.js)', () => {
    test('A1 完全相等', () => {
        assertEq(APP_VERSION, MIGRATE_VERSION,
            'seats-generator.js 与 modules/migrate.js 的 APP_VERSION 不一致');
    });

    test('A2 形如 x.y.z', () => {
        assertOk(/^\d+\.\d+\.\d+$/.test(APP_VERSION),
            `版本号格式应为 x.y.z，实际 ${JSON.stringify(APP_VERSION)}`);
    });
});

// =====================================================================
// B. HTML 入口脚本必须带 ?v=<APP_VERSION>
// =====================================================================
group('B. 入口脚本带了正确的 ?v=', () => {
    test('B1 只声明一个 module 入口', () => {
        assertEq(moduleTags.length, 1, `module 入口数量应为 1，实际 ${moduleTags.length}`);
    });

    test('B2 src 指向 seats-generator.js', () => {
        assertOk(/^seats-generator\.js(\?|$)/.test(entrySrc),
            `入口脚本 src 异常：${JSON.stringify(entrySrc)}`);
    });

    test('B3 带 v 查询串(缺失会让发版后十分钟内仍是旧代码)', () => {
        assertOk(/[?&]v=/.test(entrySrc),
            `入口脚本缺少 ?v=：${JSON.stringify(entrySrc)}` +
            ' —— GitHub Pages 对 JS 发 max-age=600，必须靠换 URL 破缓存');
    });

    test('B4 v 值 = APP_VERSION', () => {
        const m = entrySrc.match(/[?&]v=([^&]+)/);
        assertEq(m ? m[1] : null, APP_VERSION,
            'HTML 入口脚本的 ?v= 与 APP_VERSION 不同步(改版本号时要一起改)');
    });
});

// =====================================================================
// C. HTML 静态兜底版本(JS 未执行时页面显示的文字)
// =====================================================================
group('C. HTML 里的静态版本兜底文字与 APP_VERSION 一致', () => {
    test('C1 #appVersion', () => {
        const v = parseFallback('appVersion');
        assertOk(v !== null, 'HTML 里找不到 <span id="appVersion">');
        assertEq(v, APP_VERSION, '#appVersion 的静态兜底版本过旧');
    });

    test('C2 #appInfoVersion', () => {
        const v = parseFallback('appInfoVersion');
        assertOk(v !== null, 'HTML 里找不到 <span id="appInfoVersion">');
        assertEq(v, APP_VERSION, '#appInfoVersion 的静态兜底版本过旧');
    });
});

// === 汇总 ===
console.log(`\n通过 ${__passed__} 项，失败 ${__failed__} 项。`);
if (__failed__ > 0) {
    console.log('\n失败详情:');
    for (const f of __failures__) {
        console.log(`  - ${f.name || f.group}: ${f.error.message}`);
    }
    process.exit(1);
}
console.log(`全部通过（${__passed__} 项）`);
