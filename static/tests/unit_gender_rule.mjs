// =====================================================================
// tests/unit_gender_rule.mjs
//
// Node ESM 单元测试 — random-arrange 模块的「性别规则」能力
//
// 覆盖:
//   A. findGenderViolations — 男女同桌 / 男女不同桌 的违规检测口径
//   B. adjustGenderRuleInGroups — 只在同组座位区内互换,绝不跨区挪人
//   C. adjustGenderRuleInGroups — 可达成时消掉全部违规;不可达成时保留原样
//   D. rotateGroupSeats({ genderMode }) — 先轮换、后组内性别调整,轮换语义不变
//   E. 边界 — 空座 / 性别未知 / 未开启规则 / 未分组学生
//
// 运行: node static/tests/unit_gender_rule.mjs
// 退出码: 0 = 全部通过
// =====================================================================

// --- 1. 浏览器全局 stub(必须在 import state.js 之前就位)---
globalThis.location = { search: 'dev=quiet' };
globalThis.confirm = () => globalThis.__confirmAnswer__;
globalThis.alert = (msg) => { globalThis.__lastAlertMsg__ = msg; };

// --- 2. 动态 import(控制求值顺序)---
const { createRandomArrange } = await import('../modules/random-arrange.js');
const { state } = await import('../modules/state.js');

globalThis.__confirmAnswer__ = true;

// --- 3. 迷你 runner ---
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

// --- 4. 工厂(确定性 shuffle)---
function makeModule(seed = 7) {
    let s = seed >>> 0;
    const rng = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
    function deterministicShuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    const calls = { pushSnapshot: 0, generateSeats: 0 };
    const mod = createRandomArrange({
        helpers: { shuffle: deterministicShuffle },
        callbacks: {
            onPushSnapshot: () => { calls.pushSnapshot++; },
            onGenerateSeats: () => { calls.generateSeats++; }
        }
    });
    return { mod, calls };
}

// --- 5. 场景构造 ---
// 布局:rows × cols 网格,无走道 ⇒ 同桌对 = (0,1) (2,3) (4,5) ...
// genders: 长度 = 学生数 的字符串,'M' / 'F' / 'X'(未知)
// groupSizes: 每个分组的人数(学生按分组顺序连续入座)
function setup(opts) {
    const rows = opts.rows || 2;
    const cols = opts.cols || 6;
    const genders = opts.genders || '';
    const ungrouped = opts.ungrouped || 0;
    // 未指定分组时,把全部学生当成一个分组(便于只测性别规则、不关心分组的场景)
    const groupSizes = opts.groupSizes && opts.groupSizes.length
        ? opts.groupSizes
        : (genders.length - ungrouped > 0 ? [genders.length - ungrouped] : []);

    const groups = groupSizes.map((n, i) => ({
        id: 'g' + (i + 1),
        name: '第' + (i + 1) + '组',
        color: '#C' + i
    }));

    const students = [];
    let k = 0;
    const genderOf = (i) => {
        const ch = genders[i] || 'X';
        return ch === 'M' ? 'male' : (ch === 'F' ? 'female' : '');
    };
    const region = {};   // groupId → [start, end)
    let cursor = 0;
    groupSizes.forEach((n, i) => {
        const start = cursor;
        for (let j = 0; j < n; j++) {
            students.push({
                id: 's' + (k + 1),
                name: '学生' + (k + 1),
                groupId: groups[i].id,
                gender: genderOf(k)
            });
            k++;
            cursor++;
        }
        region[groups[i].id] = [start, cursor];
    });
    const ungroupedSeats = [];
    for (let u = 0; u < ungrouped; u++) {
        students.push({
            id: 'u' + (u + 1),
            name: '无分组' + (u + 1),
            groupId: null,
            gender: genderOf(k)
        });
        ungroupedSeats.push(cursor);
        k++;
        cursor++;
    }

    const seats = Array(rows * cols).fill(null);
    for (let i = 0; i < students.length; i++) seats[i] = students[i].id;

    Object.assign(state, {
        students: students,
        groups: groups,
        aisles: [],
        forcedPairs: [],
        avoidPairs: [],
        rows: rows,
        cols: cols,
        seats: seats,
        viewMode: 'student',
        isCheckinMode: false,
        isGroupMode: false,
        showStudentIcons: true
    });
    return { groups, students, region, ungroupedSeats };
}

// 座位 → 区域(仅按座位下标均分,模拟「小组座位区」)
function areaOfFactory(regionSize) {
    return function (idx) { return Math.floor(idx / regionSize); };
}

function idsInRange(from, to) {
    return state.seats.slice(from, to).filter(Boolean).sort();
}

function placedCount() {
    return state.seats.filter(Boolean).length;
}

function hasDuplicate() {
    const seen = new Set();
    for (const id of state.seats) {
        if (!id) continue;
        if (seen.has(id)) return true;
        seen.add(id);
    }
    return false;
}

// =====================================================================
// 套件 A:违规检测口径
// =====================================================================
group('A. findGenderViolations — 检测口径', () => {
    test('男女同桌:同性同桌 ⇒ 违规;异性同桌 ⇒ 合规', () => {
        setup({ rows: 1, cols: 4, genders: 'MMFF' });
        const { mod } = makeModule();
        const g = mod.buildGenderMap();
        assertEq(mod.findGenderViolations('mixed', g, null), [[0, 1], [2, 3]], '两对同性');
        assertEq(mod.findGenderViolations('samegender', g, null), [], '同性别模式全合规');
    });

    test('男女不同桌:异性同桌 ⇒ 违规;同性同桌 ⇒ 合规', () => {
        setup({ rows: 1, cols: 4, genders: 'MFMF' });
        const { mod } = makeModule();
        const g = mod.buildGenderMap();
        assertEq(mod.findGenderViolations('samegender', g, null), [[0, 1], [2, 3]], '两对异性');
        assertEq(mod.findGenderViolations('mixed', g, null), [], '混性别模式全合规');
    });

    test('一侧空座 / 性别未知 ⇒ 不判定', () => {
        setup({ rows: 1, cols: 6, genders: 'MFX' });   // 座位 0,1 有人,其余空
        const { mod } = makeModule();
        const g = mod.buildGenderMap();
        assertEq(mod.findGenderViolations('samegender', g, null), [[0, 1]], '只有 0/1 这对被判定');
        // 把 1 号换成性别未知 ⇒ 不再判定
        state.students[1].gender = '';
        const g2 = mod.buildGenderMap();
        assertEq(mod.findGenderViolations('samegender', g2, null), [], '性别未知 ⇒ 跳过');
    });
});

// =====================================================================
// 套件 B:组内调整 —— 硬约束「绝不跨区挪人」
// =====================================================================
group('B. adjustGenderRuleInGroups — 只在同区互换', () => {
    test('调整后每个座位区内的学生集合不变(没人被挪到别的小组区域)', () => {
        // 区 0 = 座位 0..5(4 男 2 女),区 1 = 座位 6..11(2 男 4 女)
        setup({ rows: 2, cols: 6, genders: 'MMMMFF' + 'FFMMFF' });
        const { mod } = makeModule();
        const before0 = idsInRange(0, 6);
        const before1 = idsInRange(6, 12);
        const r = mod.adjustGenderRuleInGroups({
            mode: 'samegender',
            areaOf: areaOfFactory(6),
            shuffle: (a) => a
        });
        assertEq(idsInRange(0, 6), before0, '区 0 成员集合不变');
        assertEq(idsInRange(6, 12), before1, '区 1 成员集合不变');
        assertEq(placedCount(), 12, '占座总数不变');
        assert(!hasDuplicate(), '无重复占座');
        assertEq(r.remaining, [], '4男2女 / 2男4女 ⇒ 两区都能排成同性同桌');
    });

    test('奇数男女比 ⇒ 尽力达成,剩余保留原样(不硬凑)', () => {
        // 每区 3 男 3 女 ⇒ 每区最多 2 桌同性 + 1 桌异性
        setup({ rows: 2, cols: 6, genders: 'MMMFFF' + 'MMMFFF' });
        const { mod } = makeModule();
        const r = mod.adjustGenderRuleInGroups({
            mode: 'samegender',
            areaOf: areaOfFactory(6),
            shuffle: (a) => a
        });
        assertEq(r.remaining.length, 2, '两区各剩 1 桌无法达成');
        assertEq(idsInRange(0, 6), ['s1', 's2', 's3', 's4', 's5', 's6'], '区 0 成员集合仍不变');
        assertEq(idsInRange(6, 12), ['s10', 's11', 's12', 's7', 's8', 's9'], '区 1 成员集合仍不变');
    });

    test('区域外的座位(不属于任何小组座位区)不参与调整', () => {
        setup({ rows: 2, cols: 6, genders: 'MFMFMF' + 'MFMFMF' });
        const { mod } = makeModule();
        // areaOf 只认 0..5,其余返回 -1 ⇒ 区 1 完全不动
        const r = mod.adjustGenderRuleInGroups({
            mode: 'samegender',
            areaOf: (idx) => (idx < 6 ? 0 : -1),
            shuffle: (a) => a
        });
        assertEq(idsInRange(6, 12), ['s10', 's11', 's12', 's7', 's8', 's9'], '区外座位未被调整');
        // 区外 3 桌保持原样 + 区内 3男3女 最多只能排成 2 桌同性(必剩 1 桌)
        assertEq(r.remaining.length, 4, '区外 3 桌 + 区内剩 1 桌');
    });

    test('未开启规则(mode 非法)⇒ 不改动任何座位', () => {
        setup({ rows: 2, cols: 6, genders: 'MFMFMF' + 'MFMFMF' });
        const { mod } = makeModule();
        const before = state.seats.slice();
        const r = mod.adjustGenderRuleInGroups({
            mode: 'random',
            areaOf: areaOfFactory(6),
            shuffle: (a) => a
        });
        assertEq(r, { fixed: 0, remaining: [] }, '返回空结果');
        assertEq(state.seats, before, '座位完全不变');
    });
});

// =====================================================================
// 套件 C:组内调整 —— 与配对设置共存
// =====================================================================
group('C. adjustGenderRuleInGroups — 不破坏已满足的配对设置', () => {
    test('已同桌的强制配对不会被拆散', () => {
        setup({ rows: 1, cols: 4, genders: 'MMFF' });
        // s1(s1)/s2 已在 (0,1) 同桌且同性 ⇒ 强制配对已满足,不应被拆
        state.forcedPairs = [['s1', 's2']];
        const { mod } = makeModule();
        mod.adjustGenderRuleInGroups({
            mode: 'mixed',
            areaOf: () => 0,
            shuffle: (a) => a
        });
        assert(state.seats[0] === 's1' && state.seats[1] === 's2',
            '强制配对仍在同桌,实际: ' + JSON.stringify(state.seats));
    });

    test('调整不会制造新的回避同桌', () => {
        setup({ rows: 2, cols: 6, genders: 'MMMFFF' + 'MMMFFF' });
        state.avoidPairs = [['s1', 's3'], ['s1', 's4'], ['s2', 's3'], ['s2', 's4']];
        const { mod } = makeModule();
        mod.adjustGenderRuleInGroups({
            mode: 'samegender',
            areaOf: areaOfFactory(6),
            shuffle: (a) => a
        });
        const dm = mod.getDeskMatePairs();
        state.avoidPairs.forEach((p) => {
            const a = state.seats.indexOf(p[0]);
            const b = state.seats.indexOf(p[1]);
            assert(mod.findPairMate(a, dm.pairMap) !== b,
                `回避配对 ${p.join('-')} 不应同桌`);
        });
    });
});

// =====================================================================
// 套件 D:轮换 + 性别规则 —— 先轮换、后组内调整
// =====================================================================
group('D. rotateGroupSeats({ genderMode }) — 轮换优先 + 组内调整', () => {
    test('轮换语义不变:各组学生仍整体落在目标小组座位区', () => {
        // 2 组各 6 人;区 0 = 0..5,区 1 = 6..11
        setup({ rows: 2, cols: 6, groupSizes: [6, 6], genders: 'MMMFFF' + 'MMMFFF' });
        const { mod } = makeModule();
        const before0 = idsInRange(0, 6);   // g1 成员(s1..s6 顺序取决于 sort)
        const before1 = idsInRange(6, 12);  // g2 成员
        globalThis.__confirmAnswer__ = true;
        const r = mod.rotateGroupSeats(1, { genderMode: 'samegender' });
        // 轮换: g1 → 区 1, g2 → 区 0
        assertEq(idsInRange(6, 12).sort(), before0, 'g1 成员整体进入区 1');
        assertEq(idsInRange(0, 6).sort(), before1, 'g2 成员整体进入区 0');
        assertEq(placedCount(), 12, '占座总数不变');
        assert(!hasDuplicate(), '无重复占座');
        assert(r.gender && r.gender.remaining.length <= 2, '每区最多剩 1 桌未达成');
    });

    test('可完全达成时 ⇒ 无性别类 warning,remaining 为空', () => {
        // 2 组各 6 人,组内 4 男 2 女 / 2 男 4 女 ⇒ 组内可排成全同性同桌
        setup({ rows: 2, cols: 6, groupSizes: [6, 6], genders: 'MMMMFF' + 'FFMMFF' });
        const { mod } = makeModule();
        globalThis.__confirmAnswer__ = true;
        const r = mod.rotateGroupSeats(1, { genderMode: 'samegender' });
        assertEq(r.gender.remaining, [], '不应有剩余违规');
        const genderWarn = (r.warnings || []).filter((w) => /男女/.test(w));
        assertEq(genderWarn, [], '不应出现性别类 warning:' + r.warnings.join('/'));
    });

    test('无法完全达成时 ⇒ 保留原样 + 给出提示(且仍不跨区)', () => {
        setup({ rows: 2, cols: 6, groupSizes: [6, 6], genders: 'MMMFFF' + 'MMMFFF' });
        const { mod } = makeModule();
        globalThis.__confirmAnswer__ = true;
        const r = mod.rotateGroupSeats(1, { genderMode: 'samegender' });
        const genderWarn = (r.warnings || []).filter((w) => /男女不同桌/.test(w));
        assert(genderWarn.length === 1, '应有 1 条性别未达成提示,实际:' + r.warnings.join('/'));
        assert(/2 桌/.test(genderWarn[0]), '提示里应包含未达成桌数:' + genderWarn[0]);
        // 关键:不能为了达成性别规则把人挪到别的小组区域
        const in0 = new Set(idsInRange(0, 6));
        ['s7', 's8', 's9', 's10', 's11', 's12'].forEach((id) => assert(in0.has(id), id + ' 应留在区 0'));
    });

    test('未传 genderMode ⇒ 不做性别调整(行为与改动前一致)', () => {
        setup({ rows: 2, cols: 6, groupSizes: [6, 6], genders: 'MFMFMF' + 'MFMFMF' });
        const { mod } = makeModule();
        globalThis.__confirmAnswer__ = true;
        const r = mod.rotateGroupSeats(1);
        assertEq(r.gender, null, '不应产生性别调整结果');
        assertEq((r.warnings || []).filter((w) => /男女/.test(w)), [], '不应有性别提示');
    });

    test('无分组学生不参与性别调整(座位区外)', () => {
        setup({
            rows: 2, cols: 8,
            groupSizes: [6, 6], genders: 'MMMFFF' + 'MMMFFF' + 'MF',
            ungrouped: 2
        });
        const { mod } = makeModule();
        const beforeUngrouped = idsInRange(12, 14);
        globalThis.__confirmAnswer__ = true;
        mod.rotateGroupSeats(1, { genderMode: 'samegender' });
        assertEq(idsInRange(12, 14), beforeUngrouped, '无分组学生原地不动');
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
