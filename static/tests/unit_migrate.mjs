// =====================================================================
// tests/unit_migrate.mjs
//
// Node ESM 单元测试 — migrate.js 模块(P0-B 批次)
//
// 覆盖场景:
//   A. 空/null/非对象输入 → 安全返回
//   B. v1.0 极旧格式(students 是 string[]) → 转换
//   C. v1.0 老格式(students 无 id) → 补 id
//   D. students.id 碰撞去重
//   E. seats 中的旧姓名引用 → 转换为 id
//   F. v1.2 中间数据(部分新字段) → 补默认
//   G. groups 缺 id / 重复 id / 缺 name / 缺 color → 补全
//   H. aisles 越界过滤(width 钳制 [1, 200] / afterCol 钳制 [0, cols-1])
//   I. rows/cols 越界/非法值 → 钳制 [1, 50] 后默认 7/7
//   J. students[i] 字段补全(checkedIn/gender/tags)
//   K. version 升级到 APP_VERSION
//   L. viewMode 非法值 → 默认 'student'
//
// 运行:  node static/tests/unit_migrate.mjs
// 退出码:0 = 全部通过;非 0 = 有失败。
// =====================================================================

// migrate.js 是纯模块,无浏览器全局依赖,可直接静态 import
import { migrateConfig, APP_VERSION, DEFAULT_ROWS, DEFAULT_COLS } from '../modules/migrate.js';

// === 简单 TAP 风格 runner ===
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
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg ? msg + ': ' : '') + `expected ${e}, got ${a}`);
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

// === 测试工具 ===
function freshConfig(extra = {}) {
    return Object.assign({
        rows: DEFAULT_ROWS,
        cols: DEFAULT_COLS,
        seats: Array(DEFAULT_ROWS * DEFAULT_COLS).fill(null),
        students: [],
        groups: [],
        aisles: [],
        forcedPairs: [],
        avoidPairs: [],
        viewMode: 'student',
        showStudentIcons: true,
        title: '班级座位表',
        version: APP_VERSION
    }, extra);
}

// =====================================================================
// A. 边界:空/null/非对象
// =====================================================================
group('A. 边界输入', () => {
    test('null config → 返回 null', () => {
        assertEq(migrateConfig(null), null);
    });
    test('undefined config → 返回 undefined', () => {
        assertEq(migrateConfig(undefined), undefined);
    });
    test('非对象 config(字符串)→ 安全返回', () => {
        // 不应抛错
        assertEq(migrateConfig('not-a-config'), 'not-a-config');
    });
    test('空对象 {} → 补全所有默认值', () => {
        const r = migrateConfig({});
        assertEq(r.rows, DEFAULT_ROWS, 'rows 默认');
        assertEq(r.cols, DEFAULT_COLS, 'cols 默认');
        assertEq(r.students, [], 'students 默认');
        assertEq(r.groups, [], 'groups 默认');
        assertEq(r.aisles, [], 'aisles 默认');
        assertEq(r.forcedPairs, [], 'forcedPairs 默认');
        assertEq(r.avoidPairs, [], 'avoidPairs 默认');
        assertEq(r.viewMode, 'student', 'viewMode 默认');
        assertEq(r.showStudentIcons, true, 'showStudentIcons 默认');
        assertEq(r.title, '班级座位表', 'title 默认');
        assertEq(r.version, APP_VERSION, 'version 升级');
        assertEq(r.seats.length, DEFAULT_ROWS * DEFAULT_COLS, 'seats 长度');
        assertEq(r.seats.every(s => s === null), true, 'seats 全 null');
    });
});

// =====================================================================
// B. v1.0 极旧格式
// =====================================================================
group('B. v1.0 极旧格式(students 是 string[])', () => {
    test('字符串数组 → 对象数组(带 id/gender/tags/checkedIn)', () => {
        const c = freshConfig({ students: ['张三', '李四', '王五'] });
        const r = migrateConfig(c);
        assertEq(r.students.length, 3);
        assert(r.students.every(s => s.id && s.id.startsWith('s')), '每个学生都有 id');
        assertEq(r.students[0].name, '张三');
        assertEq(r.students[0].gender, '');
        assertEq(r.students[0].tags, []);
        assertEq(r.students[0].checkedIn, false);
        assertEq(r.students[0].groupId, null, 'groupId 默认 null');
    });
});

// =====================================================================
// C. v1.0 老格式(students 无 id)
// =====================================================================
group('C. v1.0 老格式(students 缺 id)', () => {
    test('对象数组但每个无 id → 补 id', () => {
        const c = freshConfig({ students: [{ name: '张三' }, { name: '李四' }] });
        const r = migrateConfig(c);
        assert(r.students.every(s => s.id && s.id.startsWith('s')), '每个学生补 id');
        assertEq(r.students[0].name, '张三');
    });
});

// =====================================================================
// D. students.id 碰撞去重
// =====================================================================
group('D. students.id 碰撞去重', () => {
    test('3 个学生 id 全相同 → 去重', () => {
        const c = freshConfig({
            students: [
                { id: 'dup', name: '甲' },
                { id: 'dup', name: '乙' },
                { id: 'dup', name: '丙' }
            ]
        });
        const r = migrateConfig(c);
        const ids = r.students.map(s => s.id);
        assertEq(new Set(ids).size, 3, '3 个唯一 id');
        // 第一个保留原 id,后续重新生成
        assertEq(ids[0], 'dup', '第一个 id 保留');
        assert(ids[1].startsWith('s') && ids[1] !== 'dup', '第二个 id 重新生成');
        assert(ids[2].startsWith('s') && ids[2] !== 'dup', '第三个 id 重新生成');
    });
});

// =====================================================================
// E. seats 中的旧姓名引用 → 转换为 id
// =====================================================================
group('E. seats 旧姓名引用 → id', () => {
    test('seats 数组存的是姓名而非 id → 转换', () => {
        const c = freshConfig({
            students: [
                { id: 's001', name: '张三' },
                { id: 's002', name: '李四' }
            ],
            rows: 1, cols: 2,
            seats: ['张三', '李四']  // 旧格式:座位存姓名
        });
        const r = migrateConfig(c);
        assertEq(r.seats, ['s001', 's002'], '姓名 → id 转换');
    });

    test('seats 已经存的是 id → 保留不动', () => {
        const c = freshConfig({
            students: [
                { id: 's001', name: '张三' },
                { id: 's002', name: '李四' }
            ],
            rows: 1, cols: 2,
            seats: ['s001', 's002']
        });
        const r = migrateConfig(c);
        assertEq(r.seats, ['s001', 's002']);
    });

    test('seats 中有不存在的姓名 → 置 null', () => {
        const c = freshConfig({
            students: [{ id: 's001', name: '张三' }],
            rows: 1, cols: 2,
            seats: ['张三', '不存在的人']
        });
        const r = migrateConfig(c);
        assertEq(r.seats, ['s001', null], '不存在的姓名 → null');
    });
});

// =====================================================================
// F. v1.2 中间数据(部分字段)
// =====================================================================
group('F. v1.2 中间数据(部分字段)', () => {
    test('有 students 但无 forcedPairs/avoidPairs/aisles/showStudentIcons/viewMode → 全部补默认', () => {
        const c = {
            rows: 5, cols: 5,
            students: [{ id: 's001', name: '张三' }],
            seats: Array(25).fill(null)
        };
        const r = migrateConfig(c);
        assertEq(r.forcedPairs, [], 'forcedPairs 补默认');
        assertEq(r.avoidPairs, [], 'avoidPairs 补默认');
        assertEq(r.aisles, [], 'aisles 补默认');
        assertEq(r.showStudentIcons, true, 'showStudentIcons 默认 true');
        assertEq(r.viewMode, 'student', 'viewMode 默认 student');
        assertEq(r.title, '班级座位表', 'title 默认');
        assertEq(r.version, APP_VERSION, 'version 升级');
    });
});

// =====================================================================
// G. groups 缺 id / 重复 / 缺 name / 缺 color
// =====================================================================
group('G. groups 字段补全', () => {
    test('groups 缺 id → 补', () => {
        const c = freshConfig({ groups: [{ name: '第一组' }] });
        const r = migrateConfig(c);
        assert(r.groups[0].id && r.groups[0].id.startsWith('g'), '补 id');
    });

    test('groups 重复 id → 去重', () => {
        const c = freshConfig({ groups: [
            { id: 'dup', name: 'A' },
            { id: 'dup', name: 'B' }
        ]});
        const r = migrateConfig(c);
        assertEq(new Set(r.groups.map(g => g.id)).size, 2, 'id 唯一');
    });

    test('groups 缺 name/color → 补默认', () => {
        const c = freshConfig({ groups: [{}] });
        const r = migrateConfig(c);
        assertEq(r.groups[0].name, '', 'name 默认');
        assertEq(r.groups[0].color, '#4CAF50', 'color 默认');
    });

    test('groups 存在但不是数组 → 重置为 []', () => {
        const c = freshConfig({ groups: 'invalid' });
        const r = migrateConfig(c);
        assertEq(r.groups, []);
    });
});

// =====================================================================
// H. aisles 过滤与钳制
// =====================================================================
group('H. aisles 过滤与钳制', () => {
    test('afterCol 越界(>= cols)→ 过滤掉', () => {
        const c = freshConfig({
            rows: 5, cols: 5,
            aisles: [
                { afterCol: 3, width: 50 },  // valid
                { afterCol: 10, width: 50 }, // invalid: out of range
                { afterCol: -1, width: 50 }  // invalid: negative
            ]
        });
        const r = migrateConfig(c);
        assertEq(r.aisles.length, 1, '只保留有效的');
        assertEq(r.aisles[0].afterCol, 3);
    });

    test('width 越界(<= 0 或 > 200)→ 钳制到 50', () => {
        const c = freshConfig({
            aisles: [
                { afterCol: 1, width: 0 },    // → 50
                { afterCol: 2, width: -10 },  // → 50
                { afterCol: 3, width: 9999 }, // → 50
                { afterCol: 4, width: 100 }   // → 100 (保留)
            ]
        });
        const r = migrateConfig(c);
        assertEq(r.aisles.length, 4, '4 条都保留(width 默认 50 不算越界)');
        assertEq(r.aisles[0].width, 50);
        assertEq(r.aisles[1].width, 50);
        assertEq(r.aisles[2].width, 50);
        assertEq(r.aisles[3].width, 100);
    });

    test('aisles 不是数组 → 重置 []', () => {
        const c = freshConfig({ aisles: 'invalid' });
        const r = migrateConfig(c);
        assertEq(r.aisles, []);
    });

    test('aisles 元素不是对象 → 过滤掉', () => {
        const c = freshConfig({
            aisles: [
                null,
                'string',
                { afterCol: 1, width: 50 }
            ]
        });
        const r = migrateConfig(c);
        assertEq(r.aisles.length, 1);
    });
});

// =====================================================================
// I. rows/cols 越界/非法
// =====================================================================
group('I. rows/cols 钳制', () => {
    test('rows = 0 → 默认 7', () => {
        const c = freshConfig({ rows: 0, cols: 5 });
        const r = migrateConfig(c);
        assertEq(r.rows, DEFAULT_ROWS);
    });
    test('cols = 0 → 默认 7', () => {
        const c = freshConfig({ rows: 5, cols: 0 });
        const r = migrateConfig(c);
        assertEq(r.cols, DEFAULT_COLS);
    });
    test('rows = 100 (> 50) → 默认 7', () => {
        const c = freshConfig({ rows: 100, cols: 5 });
        const r = migrateConfig(c);
        assertEq(r.rows, DEFAULT_ROWS);
    });
    test('rows/cols 是字符串 → parseInt', () => {
        const c = freshConfig({ rows: '5', cols: '6' });
        const r = migrateConfig(c);
        assertEq(r.rows, 5);
        assertEq(r.cols, 6);
    });
    test('rows/cols 是 NaN(无效字符串)→ 默认 7', () => {
        const c = freshConfig({ rows: 'abc', cols: 'def' });
        const r = migrateConfig(c);
        assertEq(r.rows, DEFAULT_ROWS);
        assertEq(r.cols, DEFAULT_COLS);
    });
});

// =====================================================================
// J. students[i] 字段补全
// =====================================================================
group('J. students[i] 字段补全', () => {
    test('checkedIn/gender/tags 缺失 → 补默认', () => {
        const c = freshConfig({
            students: [
                { id: 's001', name: '甲' },  // 全缺
                { id: 's002', name: '乙', checkedIn: true, gender: 'male', tags: ['x'] },  // 已有
                { id: 's003', name: '丙', gender: null, tags: 'not-array' }  // 异常
            ]
        });
        const r = migrateConfig(c);
        assertEq(r.students[0].checkedIn, false);
        assertEq(r.students[0].gender, '');
        assertEq(r.students[0].tags, []);
        assertEq(r.students[1].checkedIn, true, '保留已有');
        assertEq(r.students[1].gender, 'male');
        assertEq(r.students[1].tags, ['x']);
        assertEq(r.students[2].gender, '', 'null gender → 空字符串');
        assertEq(r.students[2].tags, [], '字符串 tags → []');
    });

    test('students 元素不是对象 → 跳过(不抛错)', () => {
        const c = freshConfig({
            students: [
                null,
                'string',
                { id: 's001', name: 'valid' }
            ]
        });
        const r = migrateConfig(c);
        assert(r.students.length >= 1, '至少保留 valid');
        assert(r.students.some(s => s && s.id === 's001'), 'valid 项保留');
    });

    test('students 是字符串(单值)→ 重置为 []', () => {
        const c = freshConfig({ students: 'invalid' });
        const r = migrateConfig(c);
        assertEq(r.students, []);
    });
});

// =====================================================================
// K. version 升级
// =====================================================================
group('K. version 升级', () => {
    test('任何 version 都升级到 APP_VERSION', () => {
        assertEq(migrateConfig({ version: '1.0' }).version, APP_VERSION);
        assertEq(migrateConfig({ version: '2.0' }).version, APP_VERSION);
        assertEq(migrateConfig({ version: '3.0' }).version, APP_VERSION);
        assertEq(migrateConfig({}).version, APP_VERSION);
    });
});

// =====================================================================
// L. viewMode 非法值
// =====================================================================
group('L. viewMode 非法值', () => {
    test('viewMode = "teacher" → 保留', () => {
        const c = freshConfig({ viewMode: 'teacher' });
        assertEq(migrateConfig(c).viewMode, 'teacher');
    });
    test('viewMode = "student" → 保留', () => {
        const c = freshConfig({ viewMode: 'student' });
        assertEq(migrateConfig(c).viewMode, 'student');
    });
    test('viewMode = "invalid" → 默认 "student"', () => {
        const c = freshConfig({ viewMode: 'invalid' });
        assertEq(migrateConfig(c).viewMode, 'student');
    });
    test('viewMode = undefined → 默认 "student"', () => {
        const c = freshConfig({ viewMode: undefined });
        assertEq(migrateConfig(c).viewMode, 'student');
    });
    test('viewMode = null → 默认 "student"', () => {
        const c = freshConfig({ viewMode: null });
        assertEq(migrateConfig(c).viewMode, 'student');
    });
});

// =====================================================================
// M. seats 长度矫正
// =====================================================================
group('M. seats 长度矫正', () => {
    test('seats 长度与 rows*cols 不匹配 → 重置', () => {
        const c = freshConfig({
            rows: 5, cols: 5,  // 25 seats
            seats: ['s001', 's002']  // 只有 2 项
        });
        const r = migrateConfig(c);
        assertEq(r.seats.length, 25, '重置为 25');
        assertEq(r.seats.every(s => s === null), true, '全部 null');
    });
    test('seats 不是数组 → 创建 rows*cols 全 null 数组', () => {
        const c = freshConfig({ seats: 'invalid' });
        const r = migrateConfig(c);
        assertEq(Array.isArray(r.seats), true);
        assertEq(r.seats.length, DEFAULT_ROWS * DEFAULT_COLS);
    });
});

// =====================================================================
// 收尾
// =====================================================================
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
