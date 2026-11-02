// =====================================================================
// tests/unit_zone.mjs
//
// Node ESM 单元测试 — modules/zone.js（教室九宫格区域 + 区域偏好换座）
//
// 覆盖:
//   A. 区域定义 — 9 个区域、名称与行列档位
//   B. bandIndex — 1 行/列归中、2 列归左右、常规三等分
//   C. seatZone — 8×8 / 3×3 / 1×N / 越界
//   D. buildZoneMap — 9 个 key 恒定、并集覆盖全部座位、互不重叠
//   E. studentZonePrefs — 非法值归一为空
//   F. zoneStats — 倾向达成数 / 避开命中数 / 未满足清单
//   G. optimizeZones — 能把学生换进倾向区域、换出避开区域
//   H. optimizeZones 硬约束 — guard 返回 false 时不换；占座集合不变（不丢人）
//   I. optimizeZones 边界 — 空输入 / 全部已满足 / 座位不足
//
// 运行: node static/tests/unit_zone.mjs
// 退出码: 0 = 全部通过
// =====================================================================

const zoneMod = await import('../modules/zone.js');
const {
    ZONE_IDS, ZONE_DEFS, isZoneId, zoneName, bandIndex, seatZone,
    buildZoneMap, studentZonePrefs, zoneCost, zoneStats, optimizeZones,
} = zoneMod;

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

function assertDeepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error((msg || '结构不相等') + `\n  期望 ${b}\n  实际 ${a}`);
}

// ── 造数据的小工具 ─────────────────────────────────────────────
function mkStudents(n) {
    const list = [];
    for (let i = 0; i < n; i++) {
        list.push({ id: 's' + (i + 1), name: '学生' + (i + 1), rank: i + 1, zonePref: '', zoneAvoid: '' });
    }
    return list;
}

function seatsOf(students) {
    const seats = students.map(function (s) { return s.id; });
    while (seats.length < students.length) seats.push(null);
    return seats;
}

function seatOfStudent(seats, id) {
    for (let i = 0; i < seats.length; i++) if (seats[i] === id) return i;
    return -1;
}

console.log('unit_zone — 教室九宫格区域');

// ═══════════ A. 区域定义 ═══════════
test('A1 共 9 个区域，顺序为 前左…后右', function () {
    assertEqual(ZONE_IDS.length, 9);
    assertDeepEqual(ZONE_IDS, [
        'front-left', 'front-center', 'front-right',
        'mid-left', 'mid-center', 'mid-right',
        'back-left', 'back-center', 'back-right',
    ]);
});

test('A2 区域名称是中文方位词', function () {
    assertEqual(zoneName('front-left'), '前左');
    assertEqual(zoneName('mid-center'), '中中');
    assertEqual(zoneName('back-right'), '后右');
    assertEqual(ZONE_DEFS.length, 9);
    assertEqual(ZONE_DEFS[0].rowBand, 0);
    assertEqual(ZONE_DEFS[8].colBand, 2);
});

test('A3 isZoneId 拒绝非法值', function () {
    assert(isZoneId('front-left'));
    assert(!isZoneId(''));
    assert(!isZoneId(null));
    assert(!isZoneId('top-left'));
    assert(!isZoneId(0));
});

// ═══════════ B. bandIndex ═══════════
test('B1 3 档等分：8 行 → 前3/中3/后2', function () {
    const bands = [];
    for (let r = 0; r < 8; r++) bands.push(bandIndex(r, 8));
    assertDeepEqual(bands, [0, 0, 0, 1, 1, 1, 2, 2]);
});

test('B2 3×3 恰好一一对应', function () {
    assertDeepEqual([0, 1, 2].map(function (i) { return bandIndex(i, 3); }), [0, 1, 2]);
});

test('B3 只有 1 行/列 → 归「中」', function () {
    assertEqual(bandIndex(0, 1), 1);
});

test('B4 2 行/列 → 前/后（左/右），不产生中间档', function () {
    assertEqual(bandIndex(0, 2), 0);
    assertEqual(bandIndex(1, 2), 2);
});

test('B5 20 行也不会越界', function () {
    assertEqual(bandIndex(0, 20), 0);
    assertEqual(bandIndex(19, 20), 2);
    assertEqual(bandIndex(10, 20), 1);
});

// ═══════════ C. seatZone ═══════════
test('C1 8×8：第 0 座 = 前左，第 63 座 = 后右', function () {
    assertEqual(seatZone(0, 8, 8), 'front-left');
    assertEqual(seatZone(7, 8, 8), 'front-right');
    assertEqual(seatZone(56, 8, 8), 'back-left');
    assertEqual(seatZone(63, 8, 8), 'back-right');
    assertEqual(seatZone(27, 8, 8), 'mid-center');   // 第 3 行第 3 列（0 基）
});

test('C2 3×3：每个座位正好落在对应方位', function () {
    const expect = [
        'front-left', 'front-center', 'front-right',
        'mid-left', 'mid-center', 'mid-right',
        'back-left', 'back-center', 'back-right',
    ];
    const actual = [];
    for (let i = 0; i < 9; i++) actual.push(seatZone(i, 3, 3));
    assertDeepEqual(actual, expect);
});

test('C3 1 行 8 列：只有一排，行档统一归「中」', function () {
    for (let i = 0; i < 8; i++) {
        assert(seatZone(i, 1, 8).indexOf('mid-') === 0, '第 ' + i + ' 座应归「中」这一排档');
    }
});

test('C4 8 行 1 列：全部是「中」列', function () {
    for (let r = 0; r < 8; r++) {
        assert(seatZone(r, 8, 1).indexOf('-center') > 0, '第 ' + r + ' 行应在中列');
    }
});

test('C5 越界 / 非法参数返回空串', function () {
    assertEqual(seatZone(64, 8, 8), '');
    assertEqual(seatZone(-1, 8, 8), '');
    assertEqual(seatZone(0, 0, 8), '');
    assertEqual(seatZone(0, 8, 0), '');
});

// ═══════════ D. buildZoneMap ═══════════
test('D1 9 个 key 恒定，并集 = 全部座位，无重叠', function () {
    const rows = 6, cols = 7;
    const map = buildZoneMap(rows, cols);
    assertDeepEqual(Object.keys(map).sort(), ZONE_IDS.slice().sort());

    const seen = new Set();
    let total = 0;
    ZONE_IDS.forEach(function (id) {
        map[id].forEach(function (idx) {
            assert(!seen.has(idx), '座位 ' + idx + ' 被两个区域重复收录');
            seen.add(idx);
            total++;
        });
    });
    assertEqual(total, rows * cols, '区域并集应覆盖全部座位');
});

test('D2 每个非空区域内的座位都属于该区域', function () {
    const rows = 5, cols = 5;
    const map = buildZoneMap(rows, cols);
    ZONE_IDS.forEach(function (id) {
        map[id].forEach(function (idx) {
            assertEqual(seatZone(idx, rows, cols), id);
        });
    });
});

// ═══════════ E. studentZonePrefs ═══════════
test('E1 非法值统一归一为空', function () {
    assertDeepEqual(studentZonePrefs({ zonePref: 'front-left', zoneAvoid: 'back-right' }),
        { prefer: 'front-left', avoid: 'back-right' });
    assertDeepEqual(studentZonePrefs({ zonePref: 'xxx', zoneAvoid: null }),
        { prefer: '', avoid: '' });
    assertDeepEqual(studentZonePrefs(null), { prefer: '', avoid: '' });
});

test('E2 zoneCost：倾向不满足 +2，避开命中 +3，可叠加', function () {
    const p = { prefer: 'front-left', avoid: 'back-right' };
    assertEqual(zoneCost(p, 'front-left'), 0);
    assertEqual(zoneCost(p, 'mid-center'), 2);
    assertEqual(zoneCost(p, 'back-right'), 5);
    assertEqual(zoneCost({ prefer: '', avoid: '' }, 'back-right'), 0);
});

// ═══════════ F. zoneStats ═══════════
test('F1 统计达成 / 未达成', function () {
    const students = mkStudents(4);
    students[0].zonePref = 'front-left';
    students[1].zonePref = 'back-right';
    students[2].zoneAvoid = 'mid-center';
    // 3×3：s1 在 0(前左) 达成；s2 在 1(前中) 未达成；s3 在 4(中中) 命中避开；s4 在 8
    const seats = ['s1', 's2', null, null, 's3', null, null, null, 's4'];
    const st = zoneStats(seats, students, 3, 3);
    assertEqual(st.prefTotal, 2);
    assertEqual(st.prefMet, 1);
    assertEqual(st.avoidTotal, 1);
    assertEqual(st.avoidHit, 1);
    assertEqual(st.total, 3);
    assertEqual(st.met, 1);
    assertEqual(st.unmet.length, 2);
    assertDeepEqual(st.unmet.map(function (u) { return u.kind; }).sort(), ['avoid', 'prefer']);
});

test('F2 区域计数：多少人想在 / 想避开 / 实际坐', function () {
    const students = mkStudents(3);
    students[0].zonePref = 'front-left';
    students[1].zonePref = 'front-left';
    students[2].zoneAvoid = 'front-left';
    // 3×3 的前排三座（下标 0/1/2）
    const seats = ['s1', 's2', 's3', null, null, null, null, null, null];
    const st = zoneStats(seats, students, 3, 3);
    assertEqual(st.counts['front-left'].prefer, 2);
    assertEqual(st.counts['front-left'].avoid, 1);
    // 3×3 的「前左」只有 1 个座位（下标 0），上面坐的是 s1
    assertEqual(st.counts['front-left'].seated, 1);
    assertEqual(st.counts['front-center'].seated, 1);
});

test('F3 空座位 / 未知学生不报错', function () {
    const st = zoneStats([null, 'ghost'], [], 1, 2);
    assertEqual(st.total, 0);
    assertEqual(st.unmet.length, 0);
});

// ═══════════ G. optimizeZones 基本能力 ═══════════
test('G1 把学生换进倾向区域', function () {
    // 2 行 2 列：前左 / 前右 / 后左 / 后右
    const students = mkStudents(4);
    students[0].zonePref = 'back-right';    // 学生1 想坐后右（下标 3）
    const seats = ['s1', 's2', 's3', 's4']; // 现在在前左
    const res = optimizeZones(seats, students, 2, 2);
    const at = seatOfStudent(seats, 's1');
    assertEqual(seatZone(at, 2, 2), 'back-right', 's1 应被换到后右');
    assert(res.moved >= 1, '至少发生一次交换');
});

test('G2 把学生换出避开区域', function () {
    const students = mkStudents(4);
    students[0].zoneAvoid = 'front-left';
    const seats = ['s1', 's2', 's3', 's4'];
    optimizeZones(seats, students, 2, 2);
    const at = seatOfStudent(seats, 's1');
    assert(seatZone(at, 2, 2) !== 'front-left', 's1 不应还在被避开的左前区');
});

test('G3 两个学生互相想要对方的区域 → 一次交换双赢', function () {
    const students = mkStudents(2);
    students[0].zonePref = 'front-right';
    students[1].zonePref = 'front-left';
    const seats = ['s1', 's2', null, null];
    optimizeZones(seats, students, 2, 2);
    assertEqual(seats[0], 's2', '前左应换成 s2');
    assertEqual(seats[1], 's1', '前右应换成 s1');
});

test('G4 不抢已经满足的人：优化后总代价不升', function () {
    const students = mkStudents(4);
    students[0].zonePref = 'front-right';
    students[1].zonePref = 'front-left';   // 已在左侧，已满足
    const seats = ['s2', 's1', 's3', 's4'];  // s1 在左(达成), s2 在中
    const before = zoneStats(seats, students, 1, 4).met;
    optimizeZones(seats, students, 1, 4);
    const after = zoneStats(seats, students, 1, 4).met;
    assert(after >= before, '达成数不应下降（' + before + ' → ' + after + '）');
});

// ═══════════ H. 硬约束 ═══════════
test('H1 guard 返回 false ⇒ 一次都不换', function () {
    const students = mkStudents(3);
    students[0].zonePref = 'front-right';
    const seats = ['s1', 's2', 's3'];
    const res = optimizeZones(seats, students, 1, 3, { guard: function () { return false; } });
    assertEqual(res.moved, 0);
    assertDeepEqual(seats, ['s1', 's2', 's3']);
});

test('H2 guard 只放行指定交换', function () {
    const students = mkStudents(4);
    students[0].zonePref = 'back-right';     // 目标座位下标 3
    const seats = ['s1', 's2', 's3', 's4'];
    // 只允许 s1 与 s4（座位 0 ↔ 3）交换
    const res = optimizeZones(seats, students, 2, 2, {
        guard: function (a, b) { return (a === 0 && b === 3) || (a === 3 && b === 0); },
    });
    assertEqual(res.moved, 1);
    assertEqual(seatOfStudent(seats, 's1'), 3);
});

test('H3 占座集合不变：不丢人不添人', function () {
    const students = mkStudents(6);
    students.forEach(function (s, i) { s.zonePref = ZONE_IDS[(i * 4) % 9]; });
    const seats = students.map(function (s) { return s.id; });
    optimizeZones(seats, students, 2, 3);
    const occupied = seats.filter(Boolean).sort();
    assertDeepEqual(occupied, students.map(function (s) { return s.id; }).sort());
    assertEqual(seats.length, 6, '数组长度不变');
});

test('H4 未入座学生不参与、也不报错', function () {
    const students = mkStudents(3);
    students[2].zonePref = 'front-left';    // 这名学生没有座位
    const seats = ['s1', 's2'];
    const res = optimizeZones(seats, students, 1, 2);
    assertEqual(res.moved, 0);
    assertEqual(seats.length, 2);
});

// ═══════════ I. 边界 ═══════════
test('I1 空输入安全返回', function () {
    assertEqual(optimizeZones([], [], 3, 3).moved, 0);
    assertEqual(optimizeZones(null, null, 3, 3).moved, 0);
    assertEqual(optimizeZones(['s1'], [], 1, 1).moved, 0);
});

test('I2 全部已满足 ⇒ 不动', function () {
    const students = mkStudents(2);
    students[0].zonePref = 'front-left';
    students[1].zonePref = 'front-right';
    const seats = ['s1', 's2'];
    const res = optimizeZones(seats, students, 1, 2);
    assertEqual(res.moved, 0);
    assertDeepEqual(seats, ['s1', 's2']);
});

test('I3 没设区域的学生 ⇒ 完全不动', function () {
    const students = mkStudents(4);
    const seats = ['s3', 's1', 's4', 's2'];
    const res = optimizeZones(seats, students, 1, 4);
    assertEqual(res.moved, 0);
    assertDeepEqual(seats, ['s3', 's1', 's4', 's2']);
});

test('I4 9 个区域都有人想去且能各就各位', function () {
    // 3×3，9 名学生各自想坐一个不同区域 ⇒ 应全部达成
    const students = mkStudents(9);
    students.forEach(function (s, i) { s.zonePref = ZONE_IDS[i]; });
    const seats = ['s9', 's8', 's7', 's6', 's5', 's4', 's3', 's2', 's1'];
    optimizeZones(seats, students, 3, 3);
    const st = zoneStats(seats, students, 3, 3);
    assertEqual(st.prefMet, 9, '9 个倾向应全部达成');
});

// ═══════════ 汇总 ═══════════
console.log('');
if (failures.length === 0) {
    console.log(`全部通过（${passed} 项）`);
    process.exit(0);
} else {
    console.log(`通过 ${passed} / 失败 ${failures.length}`);
    failures.forEach(function (f) {
        console.log('  ✗ ' + f.name);
        console.log('    ' + (f.error && f.error.stack ? f.error.stack.split('\n').slice(0, 3).join('\n    ') : f.error));
    });
    process.exit(1);
}
