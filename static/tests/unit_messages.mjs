// =====================================================================
// tests/unit_messages.mjs
//
// Node ESM 单元测试 — modules/messages.js(P2 #3/#4 i18n 雏形集中层)
//
// 覆盖:
//   A. 静态常量字符串的逐字一致性
//   B. 函数式参数化的输出格式与原硬编码字符串逐字对齐(byte-for-byte)
//   C. 完整性 — 防止 keys 漏定义被 undefined 调用
//
// 运行:  node static/tests/unit_messages.mjs
// 退出码:0 = 全部通过;非 0 = 有失败。
// =====================================================================

// messages.js 是纯模块,无浏览器全局依赖,可直接静态 import
import { MESSAGES } from '../modules/messages.js';

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

// === 测试 ===

group('A. messages.js — 静态常量字符串', () => {
    test('走道/分组键存在且为字符串', () => {
        assertEq(typeof MESSAGES.AISLE_EXISTS, 'string');
        assertEq(MESSAGES.AISLE_EXISTS, '该位置已存在走道！');
        assertEq(typeof MESSAGES.GROUP_NAME_REQUIRED, 'string');
        assertEq(MESSAGES.GROUP_NAME_REQUIRED, '请输入分组名称');
        assertEq(typeof MESSAGES.GROUP_NAME_EXISTS, 'string');
        assertEq(MESSAGES.GROUP_NAME_EXISTS, '分组名称已存在');
        assertEq(typeof MESSAGES.CONFIRM_DELETE_GROUP, 'string');
    });

    test('学生/配对键存在', () => {
        assertEq(typeof MESSAGES.STUDENT_NAME_REQUIRED, 'string');
        assertEq(MESSAGES.STUDENT_NAME_REQUIRED, '请输入学生姓名');
        assertEq(typeof MESSAGES.STUDENT_NAME_EXISTS_NEW, 'string');
        assertEq(MESSAGES.STUDENT_NAME_EXISTS_NEW, '该学生已存在');
        assertEq(typeof MESSAGES.STUDENT_NAME_EXISTS_EDIT, 'string');
        assertEq(MESSAGES.STUDENT_NAME_EXISTS_EDIT, '该姓名已存在');
        assertEq(typeof MESSAGES.PAIR_SELECT_TWO_DIFFERENT, 'string');
        assertEq(MESSAGES.PAIR_SELECT_TWO_DIFFERENT, '请选择两位不同的学生');
        assertEq(typeof MESSAGES.PAIR_ALREADY_EXISTS, 'string');
        assertEq(MESSAGES.PAIR_ALREADY_EXISTS, '该配对已存在');
    });

    test('导出/重置/导入键存在', () => {
        assertEq(typeof MESSAGES.EXPORT_FAILED, 'string');
        assertEq(MESSAGES.EXPORT_FAILED, '导出图片失败，请重试！');
        assertEq(typeof MESSAGES.CONFIRM_RESET_SEATS, 'string');
        assertEq(MESSAGES.CONFIRM_RESET_SEATS, '确定要重置所有座位吗？');
        assertEq(typeof MESSAGES.ROW_COL_RANGE, 'string');
        assertEq(MESSAGES.ROW_COL_RANGE, '行数和列数必须在1-20之间！');
        assertEq(typeof MESSAGES.CONFIRM_CLEAR_ALL, 'string');
        assertEq(MESSAGES.CONFIRM_CLEAR_ALL, '确定要清除所有数据吗？此操作不可撤销！');
        assertEq(typeof MESSAGES.ALL_DATA_CLEARED, 'string');
        assertEq(MESSAGES.ALL_DATA_CLEARED, '所有数据已清除！');
        assertEq(typeof MESSAGES.STORAGE_CORRUPT, 'string');
        assertEq(typeof MESSAGES.IMPORT_SUCCESS, 'string');
        assertEq(MESSAGES.IMPORT_SUCCESS, '配置导入成功！');
        assertEq(typeof MESSAGES.CONFIG_NAME_EXISTS, 'string');
        assertEq(MESSAGES.CONFIG_NAME_EXISTS, '该名称已存在！');
    });

    test('批量键存在', () => {
        assertEq(typeof MESSAGES.BATCH_SELECT_STUDENTS_FIRST, 'string');
        assertEq(MESSAGES.BATCH_SELECT_STUDENTS_FIRST, '请先选择学生');
        assertEq(typeof MESSAGES.BATCH_SELECT_GROUP_FIRST, 'string');
        assertEq(MESSAGES.BATCH_SELECT_GROUP_FIRST, '请选择要分配的分组');
        assertEq(typeof MESSAGES.ALL_STUDENTS_SEATED, 'string');
        assertEq(MESSAGES.ALL_STUDENTS_SEATED, '所有学生都已安排座位');
        assertEq(typeof MESSAGES.NO_EMPTY_SEATS, 'string');
        assertEq(MESSAGES.NO_EMPTY_SEATS, '没有空座位可分配');
    });

    test('随机排座 — NO_STUDENTS_YET 与 NO_STUDENTS_YET_WARN 都存在且后者无感叹号', () => {
        assertEq(typeof MESSAGES.NO_STUDENTS_YET, 'string');
        assertEq(MESSAGES.NO_STUDENTS_YET, '请先导入学生名单！');
        assertEq(typeof MESSAGES.NO_STUDENTS_YET_WARN, 'string');
        assertEq(MESSAGES.NO_STUDENTS_YET_WARN, '请先导入学生名单');
        assert(MESSAGES.NO_STUDENTS_YET_WARN.length < MESSAGES.NO_STUDENTS_YET.length,
            'NO_STUDENTS_YET_WARN 应比 NO_STUDENTS_YET 短(去掉末尾感叹号)');
    });
});

group('B. messages.js — 函数式参数化', () => {
    test('CONFIRM_DELETE_STUDENT(name) → 含名字的正确文案', () => {
        const s = MESSAGES.CONFIRM_DELETE_STUDENT('张三');
        assertEq(s, '确定要删除学生 张三 吗？');
    });

    test('STUDENT_ALREADY_SEATED(name) → 含名字', () => {
        const s = MESSAGES.STUDENT_ALREADY_SEATED('李四');
        assertEq(s, '学生 李四 已经被安排座位了！');
    });

    test('CONFIRM_DELETE_CONFIG(name) → 中文方括号包名字', () => {
        const s = MESSAGES.CONFIRM_DELETE_CONFIG('我的配置');
        assertEq(s, '确定删除配置「我的配置」吗？');
    });

    test('CONFIRM_BATCH_DELETE(count) → 含数字', () => {
        const s = MESSAGES.CONFIRM_BATCH_DELETE(5);
        assertEq(s, '确定要删除选中的 5 名学生吗？');
    });

    test('CONFIRM_QUICK_RANDOM(count) → 含数字', () => {
        const s = MESSAGES.CONFIRM_QUICK_RANDOM(12);
        assertEq(s, '确定要将 12 名未安排的学生随机入座吗？');
    });

    test('IMPORT_FAILED(error) → 含错误文本', () => {
        const s = MESSAGES.IMPORT_FAILED(new Error('JSON parse error'));
        assertEq(s, '导入配置失败: Error: JSON parse error');
    });

    test('CONFIRM_REDUCE_AISLES(count, cols) → 中文顿号分隔', () => {
        const s = MESSAGES.CONFIRM_REDUCE_AISLES(2, [3, 7]);
        assertEq(s, '列数缩减将导致 2 个走道被移除（位于第 3、7 列后），是否继续？');
    });

    test('CONFIRM_CLOUD_WINS(count, names) → 三段(标题/列表/说明)', () => {
        const s = MESSAGES.CONFIRM_CLOUD_WINS(2, ['配置A', '配置B']);
        assert(/^检测到 2 个配置/.test(s), '首行含数量');
        assert(s.includes('配置A、配置B'), '中间行顿号分隔 names');
        assert(s.includes('点「确定」'), '说明含点确定');
        assert(s.includes('点「取消」'), '说明含点取消');
    });

    test('AISLE_COL_RANGE(cols) → 含动态上限', () => {
        const s = MESSAGES.AISLE_COL_RANGE(10);
        assertEq(s, '列数必须在1到9之间！');
    });

    test('CONFIRM_RANDOM_MODE(mode) → 三个内置 mode 的中文标签', () => {
        assertEq(MESSAGES.CONFIRM_RANDOM_MODE('random'), '确定要执行「完全随机」排座吗？');
        assertEq(MESSAGES.CONFIRM_RANDOM_MODE('mixed'), '确定要执行「男女同桌」排座吗？');
        assertEq(MESSAGES.CONFIRM_RANDOM_MODE('samegender'), '确定要执行「男女不同桌」排座吗？');
        // 未知 mode 回退到原始字符串
        assertEq(MESSAGES.CONFIRM_RANDOM_MODE('unknown'), '确定要执行「unknown」排座吗？');
    });

    test('RANDOM_WARNING_INCOMPLETE_SWAP(count, attempts) → 与原字面量对齐', () => {
        const s = MESSAGES.RANDOM_WARNING_INCOMPLETE_SWAP(3, 200);
        assertEq(s, '未能完全保证换位:仍 3 名学生在原座位(超过 200 次尝试)');
    });

    test('RANDOM_WARNING_NOT_SEATED(count) → 与原字面量对齐(供 unit_random_arrange.mjs 复用)', () => {
        const s = MESSAGES.RANDOM_WARNING_NOT_SEATED(6);
        assertEq(s, '6 名学生未入座(座位不足)');
        assert(/^6 名学生未入座/.test(s), '被 unit test 正则匹配');
    });
});

group('C. messages.js — 完整性(防止 keys 漏定义被 undefined 调用)', () => {
    test('所有键都是 string 或 function(无 undefined)', () => {
        const REQUIRED = [
            'AISLE_COL_RANGE', 'AISLE_EXISTS',
            'GROUP_NAME_REQUIRED', 'GROUP_NAME_EXISTS', 'CONFIRM_DELETE_GROUP',
            'STUDENT_NAME_REQUIRED', 'STUDENT_NAME_EXISTS_NEW', 'STUDENT_NAME_EXISTS_EDIT',
            'CONFIRM_DELETE_STUDENT', 'STUDENT_ALREADY_SEATED',
            'PAIR_SELECT_TWO_DIFFERENT', 'PAIR_ALREADY_EXISTS',
            'EXPORT_FAILED', 'CONFIRM_RESET_SEATS', 'ROW_COL_RANGE', 'CONFIRM_REDUCE_AISLES',
            'CONFIRM_CLEAR_ALL', 'ALL_DATA_CLEARED',
            'CONFIRM_DELETE_CONFIG', 'CONFIG_NAME_EXISTS', 'CONFIRM_CLOUD_WINS',
            'STORAGE_CORRUPT', 'IMPORT_SUCCESS', 'IMPORT_FAILED',
            'BATCH_SELECT_STUDENTS_FIRST', 'BATCH_SELECT_GROUP_FIRST',
            'CONFIRM_BATCH_DELETE', 'ALL_STUDENTS_SEATED', 'NO_EMPTY_SEATS',
            'CONFIRM_QUICK_RANDOM', 'NO_STUDENTS_YET', 'NO_STUDENTS_YET_WARN',
            'CONFIRM_RANDOM_MODE', 'RANDOM_WARNING_INCOMPLETE_SWAP', 'RANDOM_WARNING_NOT_SEATED'
        ];
        const missing = REQUIRED.filter(k => typeof MESSAGES[k] !== 'string' && typeof MESSAGES[k] !== 'function');
        assertEq(missing.length, 0, `缺失 keys: ${missing.join(', ') || '(无)'}`);
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