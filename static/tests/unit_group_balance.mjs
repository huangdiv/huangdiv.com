// =====================================================================
// tests/unit_group_balance.mjs
//
// Node ESM 单元测试 — modules/group-balance.js（分组均衡系数）
//
// 覆盖:
//   A. balanceLevel / roundScore — 等级映射
//   B. 蛇形均衡分组 → 各组接近满分、整体分高、极差小
//   C. 明显失衡（按排名整块切分）→ 分数显著下降
//   D. 性别维度 — 全男组扣分；无性别数据时该维度不参与
//   E. 班委维度 — 班委集中在一组 → 该组扣分
//   F. 空组 / 悬空 groupId / 权重归一化
//   G. 分数边界 0~100
//
// 运行: node static/tests/unit_group_balance.mjs
// 退出码: 0 = 全部通过
// =====================================================================

const { computeGroupBalance, balanceLevel, roundScore, DEFAULT_WEIGHTS } =
    await import('../modules/group-balance.js');
const { planBalancedGroupAssignment } = await import('../modules/student-rank.js');

let passed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ✓ ' + name);
    } catch (e) {
        failures.push({ name, error: e });
        console.log('  ✗ ' + name + ' — ' + e.message);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || '断言失败');
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error((msg || '值不相等') + `（期望 ${expected}，实际 ${actual}）`);
    }
}

function near(actual, expected, tolerance, msg) {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${msg || '数值偏差过大'}（期望 ${expected}±${tolerance}，实际 ${actual}）`);
    }
}

function mkStudent(id, rank, gender, tags) {
    return { id: id, name: '学生' + id, rank: rank, gender: gender || '', tags: tags || [] };
}

function makeGroups(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ id: 'g' + i, name: (i + 1) + '组', color: '#000' });
    return out;
}

console.log('\n=== A. 等级映射 ===');

test('balanceLevel: >=90 good / >=75 fair / <75 poor / null empty', () => {
    assertEqual(balanceLevel(95), 'good');
    assertEqual(balanceLevel(90), 'good');
    assertEqual(balanceLevel(89.9), 'fair');
    assertEqual(balanceLevel(75), 'fair');
    assertEqual(balanceLevel(74.9), 'poor');
    assertEqual(balanceLevel(null), 'empty');
    assertEqual(balanceLevel(undefined), 'empty');
});

test('roundScore: 取整 / null 原样', () => {
    assertEqual(roundScore(93.4), 93);
    assertEqual(roundScore(96.6), 97);
    assertEqual(roundScore(null), null);
});

console.log('\n=== B. 蛇形均衡分组 → 高分 ===');

test('18 人 3 组按蛇形分组：各组排名维度接近满分', () => {
    const students = [];
    for (let i = 1; i <= 18; i++) students.push(mkStudent('s' + i, i));
    const groups = makeGroups(3);
    const plan = planBalancedGroupAssignment(students, 3);
    plan.assignments.forEach(function (a) {
        const s = students.find(function (x) { return x.id === a.studentId; });
        s.groupId = groups[a.groupIndex].id;
    });
    const result = computeGroupBalance(students, groups);
    result.groups.forEach(function (g) {
        assertEqual(g.count, 6);
        assert(g.rankScore > 99, '蛇形分组的排名维度应接近满分，实际 ' + g.rankScore.toFixed(1));
        assert(g.score > 95, '综合分应 > 95，实际 ' + g.score.toFixed(1));
        assertEqual(g.level, 'good');
    });
    assert(result.overall.spread < 5, '各组极差应很小，实际 ' + result.overall.spread.toFixed(1));
});

test('18 人 6 组（题面例子）：各组 3 人，分数都高', () => {
    const students = [];
    for (let i = 1; i <= 18; i++) students.push(mkStudent('s' + i, i));
    const groups = makeGroups(6);
    const plan = planBalancedGroupAssignment(students, 6);
    plan.assignments.forEach(function (a) {
        students.find(function (x) { return x.id === a.studentId; }).groupId = groups[a.groupIndex].id;
    });
    const result = computeGroupBalance(students, groups);
    result.groups.forEach(function (g) {
        assertEqual(g.count, 3);
        assert(g.score > 90, '综合分应 > 90，实际 ' + g.score.toFixed(1));
    });
});

console.log('\n=== C. 明显失衡 → 分数下降 ===');

test('按排名整块切分（1-6 / 7-12 / 13-18）→ 各组排名分很低', () => {
    const students = [];
    for (let i = 1; i <= 18; i++) students.push(mkStudent('s' + i, i));
    const groups = makeGroups(3);
    // 故意按名次整块切：第 1 组全是 1-6 名，第 2 组 7-12，第 3 组 13-18
    students.forEach(function (s) {
        const rank = s.rank;
        s.groupId = groups[rank <= 6 ? 0 : (rank <= 12 ? 1 : 2)].id;
    });
    const result = computeGroupBalance(students, groups);
    result.groups.forEach(function (g) {
        assert(g.rankScore < 55, '整块切分的排名分应明显偏低，实际 ' + g.rankScore.toFixed(1));
        assert(g.level === 'poor', '应判为 poor，实际 ' + g.level);
    });
    assert(result.overall.score < 60, '整体分应 < 60，实际 ' + result.overall.score.toFixed(1));
    assert(result.overall.spread < 1, '三组对称 ⇒ 极差接近 0');
});

test('只有一组被调偏时，该组分最低且被判为最弱组', () => {
    const students = [];
    for (let i = 1; i <= 12; i++) students.push(mkStudent('s' + i, i));
    const groups = makeGroups(3);
    // 1组：1,2,3,4（尖子）  2组：5,7,9,11  3组：6,8,10,12
    [1, 2, 3, 4].forEach(function (r) { students[r - 1].groupId = groups[0].id; });
    [5, 7, 9, 11].forEach(function (r) { students[r - 1].groupId = groups[1].id; });
    [6, 8, 10, 12].forEach(function (r) { students[r - 1].groupId = groups[2].id; });
    const result = computeGroupBalance(students, groups);
    const worst = result.groups[0];
    assert(worst.score < result.groups[1].score, '1组应比2组低');
    assert(worst.score < result.groups[2].score, '1组应比3组低');
    assertEqual(result.overall.weakestGroupId, groups[0].id);
    near(worst.avgRank, 2.5, 1e-9, '1组平均排名');
});

console.log('\n=== D. 性别维度 ===');

test('全男组在男女各半的班里性别分只有 50', () => {
    const students = [
        mkStudent('a1', 1, 'male'), mkStudent('a2', 2, 'male'), mkStudent('a3', 3, 'male'),
        mkStudent('b1', 4, 'female'), mkStudent('b2', 5, 'female'), mkStudent('b3', 6, 'female')
    ];
    const groups = makeGroups(2);
    ['a1', 'a2', 'a3'].forEach(function (id) { students.find(function (s) { return s.id === id; }).groupId = 'g0'; });
    ['b1', 'b2', 'b3'].forEach(function (id) { students.find(function (s) { return s.id === id; }).groupId = 'g1'; });
    const result = computeGroupBalance(students, groups);
    assert(result.available.gender, '应有性别数据');
    near(result.groups[0].genderScore, 50, 0.5, '全男组的性别分');
    near(result.groups[1].genderScore, 50, 0.5, '全女组的性别分');
});

test('每组男女各半 → 性别分 100', () => {
    const students = [
        mkStudent('a1', 1, 'male'), mkStudent('a2', 2, 'female'),
        mkStudent('b1', 3, 'male'), mkStudent('b2', 4, 'female')
    ];
    const groups = makeGroups(2);
    ['a1', 'a2'].forEach(function (id) { students.find(function (s) { return s.id === id; }).groupId = 'g0'; });
    ['b1', 'b2'].forEach(function (id) { students.find(function (s) { return s.id === id; }).groupId = 'g1'; });
    const result = computeGroupBalance(students, groups);
    near(result.groups[0].genderScore, 100, 0.001);
});

test('全班没有性别数据 → 该维度不参与，权重归一给排名', () => {
    const students = [mkStudent('a', 1), mkStudent('b', 2), mkStudent('c', 3), mkStudent('d', 4)];
    const groups = makeGroups(2);
    students[0].groupId = 'g0'; students[1].groupId = 'g0';
    students[2].groupId = 'g1'; students[3].groupId = 'g1';
    const result = computeGroupBalance(students, groups);
    assertEqual(result.available.gender, false);
    assertEqual(result.available.cadre, false);
    assertEqual(result.weights.rank, 1);
    assertEqual(result.weights.gender, 0);
    assertEqual(result.groups[0].genderScore, null);
});

console.log('\n=== E. 班委维度 ===');

test('班委全挤在一组 → 两组都偏离期望（期望每组 1 个）', () => {
    const cadreTag = [{ label: '班长', emoji: '⭐' }];
    const students = [
        mkStudent('a1', 1, '', cadreTag), mkStudent('a2', 2, '', cadreTag),
        mkStudent('b1', 3), mkStudent('b2', 4)
    ];
    const groups = makeGroups(2);
    ['a1', 'a2'].forEach(function (id) { students.find(function (s) { return s.id === id; }).groupId = 'g0'; });
    ['b1', 'b2'].forEach(function (id) { students.find(function (s) { return s.id === id; }).groupId = 'g1'; });
    const result = computeGroupBalance(students, groups);
    assert(result.available.cadre, '应识别到班委');
    assertEqual(result.groups[0].cadre, 2);
    assertEqual(result.groups[1].cadre, 0);
    near(result.groups[0].cadreScore, 0, 0.001, '班委集中 ⇒ 0 分');
    near(result.groups[1].cadreScore, 0, 0.001, '另一组同样偏离期望');
});

test('班委平均分布 → 班委分 100', () => {
    const cadreTag = [{ label: '班长', emoji: '⭐' }];
    const students = [
        mkStudent('a1', 1, '', cadreTag), mkStudent('a2', 2),
        mkStudent('b1', 3, '', cadreTag), mkStudent('b2', 4)
    ];
    const groups = makeGroups(2);
    ['a1', 'a2'].forEach(function (id) { students.find(function (s) { return s.id === id; }).groupId = 'g0'; });
    ['b1', 'b2'].forEach(function (id) { students.find(function (s) { return s.id === id; }).groupId = 'g1'; });
    const result = computeGroupBalance(students, groups);
    near(result.groups[0].cadreScore, 100, 0.001);
});

console.log('\n=== F. 空组 / 悬空引用 / 权重 ===');

test('空分组 → score null、level empty，且不拉低整体分', () => {
    const students = [mkStudent('a', 1), mkStudent('b', 2)];
    const groups = makeGroups(3);
    students[0].groupId = 'g0';
    students[1].groupId = 'g0';
    const result = computeGroupBalance(students, groups);
    assertEqual(result.groups[2].count, 0);
    assertEqual(result.groups[2].score, null);
    assertEqual(result.groups[2].level, 'empty');
    assertEqual(result.overall.groupCount, 1);
    assert(result.overall.score !== null);
});

test('悬空 groupId（分组已删除）不参与统计', () => {
    const students = [mkStudent('a', 1), mkStudent('b', 2)];
    students[0].groupId = 'g_deleted';
    students[1].groupId = 'g0';
    const groups = makeGroups(1);
    const result = computeGroupBalance(students, groups);
    assertEqual(result.overall.studentCount, 1);
    assertEqual(result.groups[0].count, 1);
});

test('自定义权重会被归一化', () => {
    const students = [mkStudent('a', 1), mkStudent('b', 2)];
    const groups = makeGroups(1);
    students.forEach(function (s) { s.groupId = 'g0'; });
    const result = computeGroupBalance(students, groups, { weights: { rank: 2, gender: 1, cadre: 1 } });
    // 无性别/班委数据 ⇒ 只剩排名，归一为 1
    assertEqual(result.weights.rank, 1);
});

test('默认权重常量未被篡改', () => {
    assertEqual(DEFAULT_WEIGHTS.rank, 0.6);
    assertEqual(DEFAULT_WEIGHTS.gender, 0.2);
    assertEqual(DEFAULT_WEIGHTS.cadre, 0.2);
});

console.log('\n=== G. 边界 ===');

test('所有分数都在 0~100 之间', () => {
    const students = [];
    for (let i = 1; i <= 30; i++) students.push(mkStudent('s' + i, i, i % 2 ? 'male' : 'female'));
    const groups = makeGroups(5);
    students.forEach(function (s, i) { s.groupId = groups[i % 5].id; });
    const result = computeGroupBalance(students, groups);
    result.groups.forEach(function (g) {
        assert(g.score >= 0 && g.score <= 100, '分数越界: ' + g.score);
        assert(g.rankScore >= 0 && g.rankScore <= 100);
    });
});

test('空输入不崩', () => {
    const result = computeGroupBalance([], []);
    assertEqual(result.groups.length, 0);
    assertEqual(result.overall.score, null);
    assertEqual(result.overall.weakestGroupId, null);
});

console.log('\n==========================================');
if (failures.length === 0) {
    console.log(`✅ 全部通过：${passed} 条断言组`);
    process.exit(0);
} else {
    console.log(`❌ ${failures.length} 组失败 / ${passed} 组通过`);
    failures.forEach(function (f) {
        console.log('\n--- ' + f.name + ' ---');
        console.log(f.error && f.error.stack ? f.error.stack : String(f.error));
    });
    process.exit(1);
}
