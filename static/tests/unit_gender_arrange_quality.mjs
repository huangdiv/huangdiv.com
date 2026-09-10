// =====================================================================
// tests/unit_gender_arrange_quality.mjs
//
// Node ESM 单元测试 — 「男女不同桌 / 男女同桌」随机排座的**达成率**
//
// 背景:此前 randomSeatArrange 的「每位学生都不在原来座位」换座后处理完全
// 不考虑性别规则,把落座阶段排好的同性别同桌大量拆散 ⇒ 开着开关却经常
// 排不出符合要求的座位。
//
// 覆盖:
//   A. 偶数男女(可完美达成)⇒ 多次重排,违规桌数恒为 0
//   B. 奇数男女(数学上有解:落单人单坐一桌)⇒ 违规桌数恒为 0
//   C. 数学上无解(1 男 1 女同桌)⇒ 保留座位 + 如实提示
//   D. mixed 模式同样达成
//   E. 不变量:占座总数不变、无重复、所有学生都在座
//
// 运行: node static/tests/unit_gender_arrange_quality.mjs
// 退出码: 0 = 全部通过
// =====================================================================

// --- 1. 浏览器全局 stub ---
globalThis.location = { search: 'dev=quiet' };
globalThis.confirm = () => true;
globalThis.alert = () => { };

const { createRandomArrange } = await import('../modules/random-arrange.js');
const { state } = await import('../modules/state.js');

// --- 2. runner ---
let __passed__ = 0;
let __failed__ = 0;
const __failures__ = [];
let __current__ = '';

function group(name, fn) {
    __current__ = name;
    console.log(`\n# ${name}`);
    try { fn(); } catch (e) {
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

function assertTrue(cond, msg) {
    if (!cond) throw new Error(msg || '期望为真');
}
function assertEq(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || ''} (期望 ${expected},实际 ${actual})`);
    }
}

// --- 3. 工厂(真随机 shuffle,便于多次采样)---
function fisherYates(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

const mod = createRandomArrange({
    helpers: { shuffle: fisherYates },
    callbacks: { onPushSnapshot: () => { }, onGenerateSeats: () => { } }
});

// --- 4. 场景构造 ---
// genders: 'M' / 'F' / 'X' 字符串,长度 = 学生数
function setup(opts) {
    const rows = opts.rows, cols = opts.cols;
    const genders = opts.genders;
    const students = [];
    for (let i = 0; i < genders.length; i++) {
        const ch = genders[i];
        students.push({
            id: 's' + (i + 1),
            name: '学生' + (i + 1),
            groupId: null,
            gender: ch === 'M' ? 'male' : (ch === 'F' ? 'female' : '')
        });
    }
    const seats = Array(rows * cols).fill(null);
    for (let i = 0; i < students.length; i++) seats[i] = students[i].id;

    Object.assign(state, {
        students, groups: [], aisles: [],
        forcedPairs: [], avoidPairs: [],
        rows, cols, seats,
        viewMode: 'student', isCheckinMode: false, isGroupMode: false,
        showStudentIcons: true
    });
    return students;
}

function genderMapOf(students) {
    const m = Object.create(null);
    students.forEach(s => {
        m[s.id] = s.gender === 'male' ? 'M' : (s.gender === 'female' ? 'F' : 'X');
    });
    return m;
}

function violations(mode, students) {
    return mod.findGenderViolations(mode, genderMapOf(students), null).length;
}

// 跑 n 次排座,返回 { worst, total, warnSamples }
function repeat(n, cfg, mode) {
    let worst = 0, total = 0, warn = null;
    for (let i = 0; i < n; i++) {
        const students = setup(cfg);
        const r = mod.randomSeatArrange(mode) || {};
        const v = violations(mode, students);
        worst = Math.max(worst, v);
        total += v;
        if (v > 0 && !warn) warn = (r.warnings || []).slice();
        // 不变量:占座总数 = 学生数、无重复、人人有座
        const placed = state.seats.filter(Boolean);
        if (placed.length !== students.length) {
            throw new Error(`第 ${i + 1} 次:占座数 ${placed.length} ≠ 学生数 ${students.length}`);
        }
        if (new Set(placed).size !== placed.length) {
            throw new Error(`第 ${i + 1} 次:出现重复占座`);
        }
    }
    return { worst, total, warn };
}

// --- 5. 用例 ---
group('A. 男女不同桌 — 偶数男女(可完美达成)', () => {
    test('24 人 12M/12F / 6 列 × 4 行 ⇒ 50 次重排 0 违规', () => {
        const r = repeat(50, { rows: 4, cols: 6, genders: 'MFMFMFMFMFMFMFMFMFMFMFMF' }, 'samegender');
        assertEq(r.worst, 0, `最差一次仍有 ${r.worst} 桌违规(累计 ${r.total})`);
    });
    test('40 人 20M/20F / 8 列 × 5 行 ⇒ 30 次重排 0 违规', () => {
        const r = repeat(30, {
            rows: 5, cols: 8,
            genders: 'MFMFMFMFMFMFMFMFMFMFMFMFMFMFMFMFMFMFMFMF'
        }, 'samegender');
        assertEq(r.worst, 0, `最差一次仍有 ${r.worst} 桌违规(累计 ${r.total})`);
    });
    test('性别未知(X)不参与判定 ⇒ 0 违规', () => {
        const r = repeat(30, { rows: 3, cols: 6, genders: 'MMFFXXMMFFXXMMFFXX' }, 'samegender');
        assertEq(r.worst, 0, `最差一次仍有 ${r.worst} 桌违规(累计 ${r.total})`);
    });
});

group('B. 男女不同桌 — 奇数男女(落单人单坐一桌)', () => {
    test('25 人 13M/12F / 26 座 ⇒ 30 次重排 0 违规', () => {
        const r = repeat(30, {
            rows: 4, cols: 7,                       // 28 座,取前 25 ⇒ 末桌单坐
            genders: 'MFMFMFMFMFMFMFMFMFMFMFMFM'
        }, 'samegender');
        assertEq(r.worst, 0, `最差一次仍有 ${r.worst} 桌违规(累计 ${r.total})`);
    });
    test('24 人 8M/16F / 24 座 ⇒ 30 次重排 0 违规', () => {
        const r = repeat(30, {
            rows: 4, cols: 6,
            genders: 'MMFFFFMMFFFFMMFFFFMMFFFF'
        }, 'samegender');
        assertEq(r.worst, 0, `最差一次仍有 ${r.worst} 桌违规(累计 ${r.total})`);
    });
});

group('C. 男女不同桌 — 数学上无解 ⇒ 人人有座 + 如实提示', () => {
    test('2 人 1M/1F 一桌 ⇒ 1 桌违规 + 提示,两人都在座', () => {
        const students = setup({ rows: 1, cols: 2, genders: 'MF' });
        const r = mod.randomSeatArrange('samegender') || {};
        assertEq(violations('samegender', students), 1, '确实无法达成');
        const w = (r.warnings || []).join(' ');
        assertTrue(/未达成/.test(w), `应给出未达成提示,实际 warnings=${JSON.stringify(r.warnings)}`);
        assertEq(state.seats.filter(Boolean).length, 2, '两人仍都在座');
    });
    test('24 人 11M/13F 满座(男数为奇 ⇒ 必然 1 桌违规)⇒ 不丢人 + 提示', () => {
        let worst = 0, warned = 0;
        for (let i = 0; i < 30; i++) {
            const students = setup({
                rows: 4, cols: 6,
                genders: 'MMMMMMMMMMMFFFFFFFFFFFFF'   // 11 M + 13 F
            });
            const r = mod.randomSeatArrange('samegender') || {};
            assertEq(state.seats.filter(Boolean).length, 24, `第 ${i + 1} 次:不应有人无座`);
            worst = Math.max(worst, violations('samegender', students));
            if ((r.warnings || []).some(w => /未达成/.test(w))) warned++;
        }
        assertEq(worst, 1, `奇数男满座时恰好 1 桌违规,实际最差 ${worst}`);
        assertEq(warned, 30, `每次都应给出未达成提示,实际 ${warned}/30`);
    });
});

group('D. 男女同桌(mixed)同样达成', () => {
    test('24 人 12M/12F ⇒ 30 次重排 0 违规', () => {
        const r = repeat(30, { rows: 4, cols: 6, genders: 'MFMFMFMFMFMFMFMFMFMFMFMF' }, 'mixed');
        assertEq(r.worst, 0, `最差一次仍有 ${r.worst} 桌违规(累计 ${r.total})`);
    });
    test('25 人 13M/12F ⇒ 差值 ≤ 1 桌(奇偶必然剩余一人单坐)', () => {
        const r = repeat(30, {
            rows: 4, cols: 7,
            genders: 'MFMFMFMFMFMFMFMFMFMFMFMFM'
        }, 'mixed');
        assertTrue(r.worst <= 1, `最差一次 ${r.worst} 桌违规,超过容差`);
    });
});

group('E. 完全随机模式无回归', () => {
    test('random 模式仍能排满、无重复', () => {
        const students = setup({ rows: 4, cols: 6, genders: 'MFMFMFMFMFMFMFMFMFMFMFMF' });
        const r = mod.randomSeatArrange('random') || {};
        const placed = state.seats.filter(Boolean);
        assertEq(placed.length, students.length, '占座数应等于学生数');
        assertEq(new Set(placed).size, placed.length, '不应有重复占座');
        assertEq((r.warnings || []).filter(w => /未达成/.test(w)).length, 0,
            'random 模式不应报性别规则提示');
    });
});

// --- 6. 汇总 ---
console.log('\n' + '='.repeat(60));
console.log(`总计: ${__passed__ + __failed__} 项,${__passed__} 通过,${__failed__} 失败`);
if (__failed__ > 0) {
    console.log('\n失败详情:');
    __failures__.forEach(f => console.log(`  - ${f.name || f.group}: ${f.error && f.error.message}`));
    process.exit(1);
}
console.log('✅ 全部通过');
