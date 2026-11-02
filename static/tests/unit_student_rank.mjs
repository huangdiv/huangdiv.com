// =====================================================================
// tests/unit_student_rank.mjs
//
// Node ESM 单元测试 — modules/student-rank.js(学生排名 / 均衡分组)
//
// 覆盖:
//   A. parseRankValue / normalizeRank — 数值解析与规整
//   B. compareByRank / sortByRank — 排名升序、缺失排最后、稳定
//   C. rankOrderIndices — 升序/降序、空值恒排最后、同值稳定
//   D. isCadreStudent — 按标签识别班委
//   E. planBalancedGroupAssignment — 蛇形分轮(1-6 正序 / 7-12 逆序 / 13-18 正序)
//   F. 均衡 — 无信息时严格按排名顺序；有性别/班委时各组更均衡
//   G. 边界 — 0 学生 / 组数越界 / 学生数非组数整数倍
//
// 运行: node static/tests/unit_student_rank.mjs
// 退出码: 0 = 全部通过
// =====================================================================

const {
    parseRankValue,
    normalizeRank,
    rankOf,
    compareByRank,
    sortByRank,
    rankOrderIndices,
    isCadreStudent,
    normalizeGroupCount,
    planBalancedGroupAssignment
} = await import('../modules/student-rank.js');

// --- 迷你 runner ---
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
    try {
        fn();
        __passed__++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        __failed__++;
        __failures__.push({ name: `${__current__} > ${name}`, error: e });
        console.log(`  ✗ ${name}`);
        console.log(`      ${e.message}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertDeepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || 'assertDeepEqual'}: expected ${b}, got ${a}`);
}

function mkStudent(i, extra) {
    return Object.assign({ id: 's' + i, name: '学生' + i, rank: i, gender: '', tags: [] }, extra || {});
}

// ───────────────────────── A. 解析与规整 ─────────────────────────
group('A. parseRankValue / normalizeRank', () => {
    test('数字直接返回', () => {
        assertEqual(parseRankValue(3), 3);
        assertEqual(parseRankValue(0), 0);
    });
    test('数字字符串', () => {
        assertEqual(parseRankValue('12'), 12);
        assertEqual(parseRankValue(' 7 '), 7);
    });
    test('带中文前后缀也能取数', () => {
        assertEqual(parseRankValue('第3名'), 3);
        assertEqual(parseRankValue('排名 15'), 15);
    });
    test('空白 / 非数字 → null', () => {
        assertEqual(parseRankValue(''), null);
        assertEqual(parseRankValue('   '), null);
        assertEqual(parseRankValue(null), null);
        assertEqual(parseRankValue(undefined), null);
        assertEqual(parseRankValue('优秀'), null);
    });
    test('normalizeRank 夹到 >= 1 整数', () => {
        assertEqual(normalizeRank(3), 3);
        assertEqual(normalizeRank('4'), 4);
        assertEqual(normalizeRank(0), 1);
        assertEqual(normalizeRank(-2), 1);
        assertEqual(normalizeRank('abc', 5), 5);
        assertEqual(normalizeRank(null, 6), 6);
    });
    test('rankOf 缺失 → Infinity', () => {
        assertEqual(rankOf({ rank: 3 }), 3);
        assertEqual(rankOf({ rank: '3' }), 3);
        assertEqual(rankOf({}), Number.POSITIVE_INFINITY);
        assertEqual(rankOf(null), Number.POSITIVE_INFINITY);
    });
});

// ───────────────────────── B. 排序 ─────────────────────────
group('B. compareByRank / sortByRank', () => {
    test('升序', () => {
        const list = [mkStudent(3), mkStudent(1), mkStudent(2)];
        assertDeepEqual(sortByRank(list).map(s => s.rank), [1, 2, 3]);
    });
    test('缺失排名排最后', () => {
        const list = [{ id: 'a', rank: 2 }, { id: 'b' }, { id: 'c', rank: 1 }];
        assertDeepEqual(sortByRank(list).map(s => s.id), ['c', 'a', 'b']);
    });
    test('同排名保持原顺序(稳定)', () => {
        const list = [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }, { id: 'c', rank: 1 }];
        assertDeepEqual(sortByRank(list).map(s => s.id), ['a', 'b', 'c']);
    });
    test('不改动入参', () => {
        const list = [mkStudent(2), mkStudent(1)];
        sortByRank(list);
        assertDeepEqual(list.map(s => s.rank), [2, 1]);
    });
    test('compareByRank 两个缺失不返回 NaN', () => {
        const r = compareByRank({}, {});
        assertEqual(r, 0);
    });
});

// ───────────────────────── C. 依据列排序 ─────────────────────────
group('C. rankOrderIndices', () => {
    test('升序:小值排前', () => {
        assertDeepEqual(rankOrderIndices([30, 10, 20], 'asc'), [1, 2, 0]);
    });
    test('降序:大值排前', () => {
        assertDeepEqual(rankOrderIndices([30, 10, 20], 'desc'), [0, 2, 1]);
    });
    test('空值恒排最后(升序)', () => {
        assertDeepEqual(rankOrderIndices([5, null, 1], 'asc'), [2, 0, 1]);
    });
    test('空值恒排最后(降序)', () => {
        assertDeepEqual(rankOrderIndices([5, null, 9], 'desc'), [2, 0, 1]);
    });
    test('同值保持原始顺序', () => {
        assertDeepEqual(rankOrderIndices([5, 5, 5], 'asc'), [0, 1, 2]);
        assertDeepEqual(rankOrderIndices([5, 5, 5], 'desc'), [0, 1, 2]);
    });
});

// ───────────────────────── D. 班委识别 ─────────────────────────
group('D. isCadreStudent', () => {
    test('班长 / 学习委员 / 课代表', () => {
        assert(isCadreStudent({ tags: [{ label: '班长' }] }), '班长');
        assert(isCadreStudent({ tags: [{ label: '学习委员' }] }), '学习委员');
        assert(isCadreStudent({ tags: [{ label: '英语课代表' }] }), '课代表');
        assert(isCadreStudent({ tags: [{ label: 'monitor' }] }), 'monitor');
    });
    test('普通标签不算班委', () => {
        assert(!isCadreStudent({ tags: [{ label: '体育' }] }), '体育');
        assert(!isCadreStudent({ tags: [{ label: '进步' }] }), '进步');
        assert(!isCadreStudent({ tags: [] }), '空标签');
        assert(!isCadreStudent({}), '无标签字段');
        assert(!isCadreStudent(null), 'null');
    });
});

// ───────────────────────── E. 蛇形分轮 ─────────────────────────
group('E. planBalancedGroupAssignment — 蛇形顺序', () => {
    test('18 人 6 组:1-6 正序 / 7-12 逆序 / 13-18 正序', () => {
        const students = [];
        for (let i = 1; i <= 18; i++) students.push(mkStudent(i));
        const plan = planBalancedGroupAssignment(students, 6);
        assertEqual(plan.groupCount, 6);
        const map = new Map(plan.assignments.map(a => [a.studentId, a.groupIndex]));
        // 第 1 批:学生 1..6 → 组 0..5
        for (let i = 1; i <= 6; i++) assertEqual(map.get('s' + i), i - 1, '第1批 s' + i);
        // 第 2 批:学生 7..12 → 组 5..0
        for (let i = 7; i <= 12; i++) assertEqual(map.get('s' + i), 12 - i, '第2批 s' + i);
        // 第 3 批:学生 13..18 → 组 0..5
        for (let i = 13; i <= 18; i++) assertEqual(map.get('s' + i), i - 13, '第3批 s' + i);
    });
    test('每组人数相等(18 人 6 组 → 每组 3 人)', () => {
        const students = [];
        for (let i = 1; i <= 18; i++) students.push(mkStudent(i));
        const plan = planBalancedGroupAssignment(students, 6);
        assertDeepEqual(plan.stats.map(s => s.count), [3, 3, 3, 3, 3, 3]);
    });
    test('入参乱序也按排名排队', () => {
        const students = [mkStudent(9), mkStudent(1), mkStudent(5)];
        const plan = planBalancedGroupAssignment(students, 3);
        const map = new Map(plan.assignments.map(a => [a.studentId, a.groupIndex]));
        assertEqual(map.get('s1'), 0);
        assertEqual(map.get('s5'), 1);
        assertEqual(map.get('s9'), 2);
    });
    test('排名缺失的学生排在最后', () => {
        const students = [{ id: 'x', name: 'x' }, { id: 'y', name: 'y', rank: 1 }];
        const plan = planBalancedGroupAssignment(students, 2);
        const map = new Map(plan.assignments.map(a => [a.studentId, a.groupIndex]));
        assertEqual(map.get('y'), 0);
        assertEqual(map.get('x'), 1);
    });
});

// ───────────────────────── F. 均衡效果 ─────────────────────────
group('F. planBalancedGroupAssignment — 性别 / 班委均衡', () => {
    test('无性别信息时严格保持排名顺序', () => {
        const students = [];
        for (let i = 1; i <= 6; i++) students.push(mkStudent(i));
        const plan = planBalancedGroupAssignment(students, 6);
        const map = new Map(plan.assignments.map(a => [a.studentId, a.groupIndex]));
        for (let i = 1; i <= 6; i++) assertEqual(map.get('s' + i), i - 1);
    });

    test('一批内男女各半时仍每组 1 男 1 女或 0/0(不额外失衡)', () => {
        // 12 人 6 组:排名 1-6 全男,7-12 全女
        const students = [];
        for (let i = 1; i <= 6; i++) students.push(mkStudent(i, { gender: 'male' }));
        for (let i = 7; i <= 12; i++) students.push(mkStudent(i, { gender: 'female' }));
        const plan = planBalancedGroupAssignment(students, 6);
        // 第 1 批 6 男 → 每组 1 男;第 2 批 6 女 → 每组 1 女 ⇒ 每组 1 男 1 女
        plan.stats.forEach((s, i) => {
            assertEqual(s.male, 1, '组' + i + ' 男');
            assertEqual(s.female, 1, '组' + i + ' 女');
        });
    });

    test('交错性别时各组性别差不超过 1', () => {
        // 交替男女,共 12 人 6 组
        const students = [];
        for (let i = 1; i <= 12; i++) {
            students.push(mkStudent(i, { gender: i % 2 === 1 ? 'male' : 'female' }));
        }
        const plan = planBalancedGroupAssignment(students, 6);
        plan.stats.forEach((s, i) => {
            assert(Math.abs(s.male - s.female) <= 1, '组' + i + ' 性别差过大: ' + s.male + '/' + s.female);
            assertEqual(s.count, 2, '组' + i + ' 人数');
        });
        // 总男 6 / 总女 6,每组 2 人 ⇒ 均衡时每组应恰为 1 男 1 女
        const totalMale = plan.stats.reduce((sum, s) => sum + s.male, 0);
        const totalFemale = plan.stats.reduce((sum, s) => sum + s.female, 0);
        assertEqual(totalMale, 6);
        assertEqual(totalFemale, 6);
    });

    test('班委尽量分散到不同组', () => {
        // 4 组 8 人,前 4 人是班委
        const students = [];
        for (let i = 1; i <= 8; i++) students.push(mkStudent(i, {
            tags: i <= 4 ? [{ label: '班长' }] : []
        }));
        const plan = planBalancedGroupAssignment(students, 4);
        const totalCadre = plan.stats.reduce((sum, s) => sum + s.cadre, 0);
        assertEqual(totalCadre, 4);
        // 理想:每组 1 名班委;至少不能全挤在一组
        plan.stats.forEach((s, i) => {
            assert(s.cadre <= 1, '组' + i + ' 班委过多: ' + s.cadre);
        });
    });

    test('人数不整除时最后一批少人,且总数不丢', () => {
        const students = [];
        for (let i = 1; i <= 14; i++) students.push(mkStudent(i));
        const plan = planBalancedGroupAssignment(students, 4);
        assertEqual(plan.assignments.length, 14);
        const ids = new Set(plan.assignments.map(a => a.studentId));
        assertEqual(ids.size, 14);
        // 4 批:4 正序 / 4 逆序 / 4 正序 / 2 逆序(落到第 4、3 组) ⇒ 3,3,4,4
        assertDeepEqual(plan.stats.map(s => s.count), [3, 3, 4, 4]);
        // 人数差不超过 1,不会出现某组被塞爆
        const counts = plan.stats.map(s => s.count);
        assert(Math.max(...counts) - Math.min(...counts) <= 1, '组间人数差应 <= 1');
    });
});

// ───────────────────────── G. 边界 ─────────────────────────
group('G. 边界', () => {
    test('空学生列表 → 0 组', () => {
        const plan = planBalancedGroupAssignment([], 4);
        assertEqual(plan.groupCount, 0);
        assertDeepEqual(plan.assignments, []);
    });
    test('组数超过学生数 → 钳到学生数', () => {
        const plan = planBalancedGroupAssignment([mkStudent(1), mkStudent(2)], 9);
        assertEqual(plan.groupCount, 2);
        assertDeepEqual(plan.stats.map(s => s.count), [1, 1]);
    });
    test('组数 0 / 负数 / 非数字 → 至少 1 组', () => {
        assertEqual(normalizeGroupCount(0, 5), 1);
        assertEqual(normalizeGroupCount(-3, 5), 1);
        assertEqual(normalizeGroupCount('abc', 5), 1);
        assertEqual(normalizeGroupCount(3, 0), 0);
    });
    test('1 组 → 所有人同组', () => {
        const plan = planBalancedGroupAssignment([mkStudent(1), mkStudent(2), mkStudent(3)], 1);
        assertEqual(plan.groupCount, 1);
        plan.assignments.forEach(a => assertEqual(a.groupIndex, 0));
        assertEqual(plan.stats[0].count, 3);
    });
});

// ───────────────────────── 汇总 ─────────────────────────
console.log('\n========================================');
console.log(`通过 ${__passed__} / 失败 ${__failed__}`);
if (__failed__ > 0) {
    console.log('\n失败项:');
    __failures__.forEach(f => console.log(`  - ${f.name || f.group}: ${f.error.message}`));
    process.exit(1);
}
