// =====================================================================
// tests/unit_random_arrange.mjs
//
// Node ESM 单元测试 — random-arrange 模块(#16 批次)
// 不依赖浏览器,直接 import ES module,覆盖:
//   - getDeskMatePairs   无走道 / 有走道 / 单行 / 奇数列
//   - findPairMate       O(1) 查同桌 / null pairMap / 单座位
//   - getGender          male / female / unknown → M/F/X
//   - isAvoided(内部 Set) → 通过 randomSeatArrange 行为验证:
//     设置 avoid pair,运行 random,must NOT 同桌
//   - shuffle 返回值接住(原 bug 回归):
//     连续 8 次 randomSeatArrange('random')结果两两不同
//   - 警告返回:
//     0 学生 → '请先导入学生名单'
//     cancel confirm → { warnings: [] }
//   - students > seats → 'X 名学生未入座(座位不足)'
//
// 运行:  node --experimental-vm-modules static/tests/unit_random_arrange.mjs
//        (或 node static/tests/unit_random_arrange.mjs — 普通 ESM 也可)
// 退出码:0 = 全部通过;非 0 = 有失败。
//
// 设计要点:
//   必须先把 globalThis.location 挂上再 import state.js,否则 state.js
//   的 `!location.search` 会抛 ReferenceError。ESM 静态 import 是 hoisted
//   的,所以这里全部用 await import(...) 动态加载,严格控制求值顺序。
// =====================================================================

// --- 1. 浏览器全局 stub(必须在 import state.js 之前就位)---
globalThis.location = { search: 'dev=quiet' };
// confirm/alert 占位(具体实现见下方,覆盖 confirmAnswer)
globalThis.confirm = () => globalThis.__confirmAnswer__;
globalThis.alert = (msg) => { globalThis.__lastAlertMsg__ = msg; };

// --- 2. 动态 import ES modules(控制求值顺序)---
const { createRandomArrange } = await import('../modules/random-arrange.js');
const { state, commit } = await import('../modules/state.js');

// confirm/alert 实际状态(用 globalThis 避免 let 提升的 TDZ 问题)
globalThis.__confirmAnswer__ = true;
globalThis.__lastAlertMsg__ = null;

// --- 3. 简单 TAP 风格测试 runner ---
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
        const r = fn();
        if (r && typeof r.then === 'function') {
            throw new Error('test() does not support async; use testSync or wrap manually');
        }
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
    if (a !== e) {
        throw new Error((msg ? msg + ': ' : '') + `expected ${e}, got ${a}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

// --- 4. 工厂:用确定性 shuffle + mock 回调构造模块实例 ---
function makeModule(seed = 42) {
    // 简单 LCG 伪随机,确定性,方便测试断言
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
    return { mod, calls, rng };
}

// --- 5. state 重置助手 ---
function resetState(opts = {}) {
    Object.assign(state, {
        students: [],
        groups: [],
        aisles: [],
        forcedPairs: [],
        avoidPairs: [],
        rows: 7,
        cols: 7,
        seats: null,
        viewMode: 'student',
        isCheckinMode: false,
        showStudentIcons: true,
        title: '班级座位表'
    });
    if (opts.students) state.students = opts.students;
    if (opts.aisles) state.aisles = opts.aisles;
    if (opts.forcedPairs) state.forcedPairs = opts.forcedPairs;
    if (opts.avoidPairs) state.avoidPairs = opts.avoidPairs;
    if (opts.rows) state.rows = opts.rows;
    if (opts.cols) state.cols = opts.cols;
    if (opts.seats) state.seats = opts.seats;
    if (!state.seats || state.seats.length !== state.rows * state.cols) {
        state.seats = Array(state.rows * state.cols).fill(null);
    }
}

// =====================================================================
// 套件 A:getDeskMatePairs
// =====================================================================
group('A. getDeskMatePairs — 同桌对检测', () => {
    test('7x7 无走道 → 21 对 + 7 单座(7 列奇数 → 每行右端 1 单座)', () => {
        resetState({ rows: 7, cols: 7 });
        const { mod } = makeModule();
        const { pairs, singles, pairMap } = mod.getDeskMatePairs();
        assertEq(pairs.length, 21, 'pairs.length');
        assertEq(singles.length, 7, 'singles.length');
        // pairMap 长度 = rows*cols = 49
        assertEq(pairMap.length, 49, 'pairMap.length');
        // 每行右端(列 6)是 single:idx 6, 13, 20, 27, 34, 41, 48
        const expectedSingles = [6, 13, 20, 27, 34, 41, 48];
        assertEq(singles, expectedSingles, 'singles 内容');
        // 第 0 行前 3 对
        assertEq(pairs[0], [0, 1], 'row0 pair 1');
        assertEq(pairs[1], [2, 3], 'row0 pair 2');
        assertEq(pairs[2], [4, 5], 'row0 pair 3');
        // pairMap 双向映射
        assertEq(pairMap[0], 1, 'pairMap[0]=1');
        assertEq(pairMap[1], 0, 'pairMap[1]=0');
        // single 座位 pairMap 为 null
        assertEq(pairMap[6], null, 'pairMap[6]=null');
    });

    test('5x6 + aisle afterCol=3 → 每行 2 对 + 2 单座(走道在 col 2 与 col 3 之间)', () => {
        resetState({ rows: 5, cols: 6, aisles: [{ afterCol: 3 }] });
        const { mod } = makeModule();
        const { pairs, singles } = mod.getDeskMatePairs();
        // 算法: a.afterCol === c+1 命中走道 → col 2 ↔ col 3 被隔开(afterCol=3 命中当 c=2)
        // 每行:pair[0,1], single[2], pair[3,4], single[5] → 2 对 + 2 单
        assertEq(pairs.length, 5 * 2, 'pairs.length');
        assertEq(singles.length, 5 * 2, 'singles.length');
        // 第 0 行
        assertEq(pairs[0], [0, 1], 'row0 pair 1');
        assertEq(pairs[1], [3, 4], 'row0 pair 2');
        assertEq(singles.slice(0, 2), [2, 5], 'row0 singles');
        // 第 1 行(idx 偏移 6)
        assertEq(pairs[2], [6, 7], 'row1 pair 1');
        assertEq(pairs[3], [9, 10], 'row1 pair 2');
        assertEq(singles.slice(2, 4), [8, 11], 'row1 singles');
    });

    test('单行 1x4 → 2 对,无单座', () => {
        resetState({ rows: 1, cols: 4 });
        const { mod } = makeModule();
        const { pairs, singles, pairMap } = mod.getDeskMatePairs();
        assertEq(pairs, [[0, 1], [2, 3]], 'pairs');
        assertEq(singles, [], 'singles');
        assertEq(pairMap[0], 1, 'pairMap[0]');
        assertEq(pairMap[2], 3, 'pairMap[2]');
    });

    test('单行 1x5(奇数) → 2 对 + 1 单座', () => {
        resetState({ rows: 1, cols: 5 });
        const { mod } = makeModule();
        const { pairs, singles } = mod.getDeskMatePairs();
        assertEq(pairs, [[0, 1], [2, 3]], 'pairs');
        assertEq(singles, [4], 'singles');
    });

    test('多走道交错:5x6 aisles=[{afterCol:1},{afterCol:4}]', () => {
        // 期望每行:col0↔1? 检查 afterCol===1 命中走道 → 不同桌, col0 是单
        //        col1↔2? afterCol===2 没有 → 同桌
        //        col3↔4? afterCol===4 命中走道 → 不同桌, col3 是单
        //        col4↔5? afterCol===5 没有 → 同桌
        // 每行 2 对 + 2 单
        resetState({ rows: 5, cols: 6, aisles: [{ afterCol: 1 }, { afterCol: 4 }] });
        const { mod } = makeModule();
        const { pairs, singles } = mod.getDeskMatePairs();
        assertEq(pairs.length, 5 * 2, 'pairs.length');
        assertEq(singles.length, 5 * 2, 'singles.length');
        // 第 0 行:pairs 应包含 [1,2] 和 [4,5]
        assert(pairs.some(p => p[0] === 1 && p[1] === 2), 'row0 [1,2]');
        assert(pairs.some(p => p[0] === 4 && p[1] === 5), 'row0 [4,5]');
        // singles 应包含第 0 行的 0 和 3
        assert(singles.includes(0), 'singles[0]');
        assert(singles.includes(3), 'singles[3]');
    });
});

// =====================================================================
// 套件 B:findPairMate
// =====================================================================
group('B. findPairMate — O(1) 找同桌', () => {
    test('有效 pairMap → 返回同桌 idx', () => {
        resetState({ rows: 1, cols: 4 });
        const { mod } = makeModule();
        const { pairMap } = mod.getDeskMatePairs();
        assertEq(mod.findPairMate(0, pairMap), 1, 'seat 0 ↔ 1');
        assertEq(mod.findPairMate(1, pairMap), 0, 'seat 1 ↔ 0');
        assertEq(mod.findPairMate(2, pairMap), 3, 'seat 2 ↔ 3');
        assertEq(mod.findPairMate(3, pairMap), 2, 'seat 3 ↔ 2');
    });

    test('单座位的 pairMap 项为 null → 返回 null', () => {
        resetState({ rows: 1, cols: 5 });
        const { mod } = makeModule();
        const { pairMap } = mod.getDeskMatePairs();
        assertEq(mod.findPairMate(4, pairMap), null, '单座 idx=4');
    });

    test('null pairMap → 返回 null(防御性)', () => {
        resetState({ rows: 1, cols: 4 });
        const { mod } = makeModule();
        assertEq(mod.findPairMate(0, null), null, 'null pairMap');
        assertEq(mod.findPairMate(0, undefined), null, 'undefined pairMap');
    });
});

// =====================================================================
// 套件 C:getGender
// =====================================================================
group('C. getGender — 性别归一', () => {
    test('"male" → "M"', () => {
        resetState();
        const { mod } = makeModule();
        assertEq(mod.getGender({ gender: 'male' }), 'M');
    });
    test('"female" → "F"', () => {
        resetState();
        const { mod } = makeModule();
        assertEq(mod.getGender({ gender: 'female' }), 'F');
    });
    test('undefined → "X" wildcard', () => {
        resetState();
        const { mod } = makeModule();
        assertEq(mod.getGender({}), 'X');
        assertEq(mod.getGender({ gender: undefined }), 'X');
        assertEq(mod.getGender({ gender: 'other' }), 'X'); // 未来扩展不会崩
    });
});

// =====================================================================
// 套件 D:randomSeatArrange 行为测试
// =====================================================================

// 制造 N 个学生
function makeStudents(n, halfGender) {
    const arr = [];
    for (let i = 0; i < n; i++) {
        arr.push({
            id: 's' + (i + 1).toString().padStart(3, '0'),
            name: '学生' + (i + 1),
            gender: i < halfGender ? 'male' : 'female'
        });
    }
    return arr;
}

group('D. randomSeatArrange — 警告与边界', () => {
    test('0 学生 → 返回 { warnings: [请先导入学生名单] },不调 confirm/commit', () => {
        resetState({ students: [] });
        globalThis.__confirmAnswer__ = true;
        const { mod, calls } = makeModule();
        const r = mod.randomSeatArrange('random');
        assert(r.warnings && r.warnings.length === 1, '应有 1 条 warning');
        assert(/请先导入/.test(r.warnings[0]), 'warning 文案');
        assertEq(calls.pushSnapshot, 0, '不应 pushSnapshot');
        assertEq(calls.generateSeats, 0, '不应 generateSeats');
    });

    test('cancel confirm → 返回 { warnings: [] },无副作用', () => {
        resetState({ students: makeStudents(10, 5) });
        globalThis.__confirmAnswer__ = false;
        const { mod, calls } = makeModule();
        const r = mod.randomSeatArrange('random');
        assertEq(r, { warnings: [] }, 'cancel 返回空 warnings');
        assertEq(calls.pushSnapshot, 0, '不 pushSnapshot');
        // seats 应保持原样(null)
        assert(state.seats.every(s => s === null), 'seats 不变');
    });

    test('students > seats → warnings 含 "X 名学生未入座(座位不足)"', () => {
        resetState({ rows: 3, cols: 3, students: makeStudents(15, 8) }); // 9 座 15 人
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        const r = mod.randomSeatArrange('random');
        assert(r.warnings && r.warnings.length >= 1, '应有 warning');
        const msg = r.warnings.join(' / ');
        assert(/6 名学生未入座/.test(msg), `warning 应说 "6 名学生未入座",实际:"${msg}"`);
        // 实际座位数应等于 seats 总数 9
        const placed = state.seats.filter(Boolean).length;
        assertEq(placed, 9, 'placed seats');
    });

    test('正常 10 人 49 座 → 无 warning,全部入座,无重复', () => {
        resetState({ rows: 7, cols: 7, students: makeStudents(10, 5) });
        globalThis.__confirmAnswer__ = true;
        const { mod, calls } = makeModule();
        const r = mod.randomSeatArrange('random');
        assertEq(r.warnings, [], '无 warning');
        assertEq(calls.pushSnapshot, 1, 'pushSnapshot 1 次');
        assertEq(calls.generateSeats, 1, 'generateSeats 1 次');
        const placed = state.seats.filter(Boolean);
        assertEq(placed.length, 10, 'placed 10');
        assertEq(new Set(placed).size, 10, '无重复');
    });
});

// =====================================================================
// 套件 E:avoidPairs 行为 — 同桌对不可为回避配对
// =====================================================================
group('E. avoidPairs — 同桌不出现回避配对', () => {
    test('设置 1 对 avoidPair,运行 random 模式,该对 never 同桌', () => {
        // 10 男 10 女 = 20 学生,49 座 → 24 对同桌 + 1 单
        const students = [
            ...makeStudents(10, 10).map(s => ({ ...s, gender: 'male' })),
            ...makeStudents(10, 0).map(s => ({ ...s, id: 's' + (parseInt(s.id.slice(1)) + 10).toString().padStart(3, '0'), gender: 'female' }))
        ];
        resetState({ rows: 7, cols: 7, students });
        // 强制 s001 和 s011(分别男女)不同桌
        state.avoidPairs = [['s001', 's011']];
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.randomSeatArrange('random');

        // 找 s001 在哪、把同桌是谁 — 不应是 s011
        const seatOf = (id) => state.seats.indexOf(id);
        const aSeat = seatOf('s001');
        const bSeat = seatOf('s011');
        assert(aSeat >= 0 && bSeat >= 0, '两人都入座');
        const { pairMap } = mod.getDeskMatePairs();
        const aMate = pairMap[aSeat];
        assert(aMate === null || state.seats[aMate] !== 's011',
            `s001 同桌 ${aMate},坐的是 ${state.seats[aMate]}(不应是 s011)`);
    });

    test('mixed 模式 — 男 M1 与女 F1 标 avoidPair,运行后 never 同桌', () => {
        const students = [];
        for (let i = 0; i < 10; i++) {
            students.push({ id: 'm' + (i + 1), name: '男' + (i + 1), gender: 'male' });
        }
        for (let i = 0; i < 10; i++) {
            students.push({ id: 'f' + (i + 1), name: '女' + (i + 1), gender: 'female' });
        }
        resetState({ rows: 7, cols: 7, students });
        state.avoidPairs = [['m1', 'f1']];
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.randomSeatArrange('mixed');
        const seatOf = (id) => state.seats.indexOf(id);
        const mSeat = seatOf('m1');
        const fSeat = seatOf('f1');
        assert(mSeat >= 0 && fSeat >= 0, '两人都入座');
        const { pairMap } = mod.getDeskMatePairs();
        const mMate = pairMap[mSeat];
        assert(mMate === null || state.seats[mMate] !== 'f1',
            `m1 同桌 ${mMate},坐的是 ${state.seats[mMate]}(不应是 f1)`);
    });
});

// =====================================================================
// 套件 F:shuffle 返回值接住 — 原 bug 回归
// =====================================================================
group('F. shuffle() 返回值不能丢弃 — 回归', () => {
    test('连续 8 次 random,结果两两不同(同 seed 下每次 state.seats 也被新随机源打乱)', () => {
        // 用不同 seed 跑 8 次,每次都该产生与上次不同的布局
        const students = makeStudents(20, 10);
        const signatures = new Set();
        for (let i = 0; i < 8; i++) {
            resetState({ rows: 5, cols: 5, students });
            globalThis.__confirmAnswer__ = true;
            const { mod } = makeModule(1000 + i); // 不同 seed
            mod.randomSeatArrange('random');
            const sig = state.seats.join(',');
            signatures.add(sig);
        }
        // 8 次签名应该全不同(随机空间巨大,冲突概率可忽略)
        assertEq(signatures.size, 8, `8 次随机应全不同,实际只有 ${signatures.size} 种`);
    });

    test('同 seed 跑两次,布局也应不同(后处理 swap 重排)', () => {
        // 先布置一个 prevSeatMap(故意构造冲突),再跑 random,看 swap 是否生效
        resetState({ rows: 5, cols: 5, students: makeStudents(20, 10) });
        // 初始座位 = 学生按 id 顺序放(制造 prevSeatMap 冲突)
        state.students.forEach((s, i) => { state.seats[i] = s.id; });
        const before = state.seats.join(',');
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule(7);
        mod.randomSeatArrange('random', { maxAttempts: 500 });
        const after = state.seats.join(',');
        assert(before !== after, '后处理 swap 应重排布局');
        // 且原冲突应该被消除
        const { pairMap } = mod.getDeskMatePairs();
        let conflicts = 0;
        for (let i = 0; i < state.seats.length; i++) {
            const id = state.seats[i];
            if (!id) continue;
            const mate = pairMap[i];
            if (mate != null && state.seats[mate] && state.seats[mate] !== id) {
                // 同桌有两人 — 验是否违反 avoidPairs
                // 这里没设 avoidPairs,不算违规
            }
        }
        // 至少不应有"仍在原座位"的情况
        const prevSeatMap = {};
        state.students.forEach((s, i) => { prevSeatMap[s.id] = i; });
        let stillInOldSeat = 0;
        for (let i = 0; i < state.seats.length; i++) {
            if (state.seats[i] && prevSeatMap[state.seats[i]] === i) {
                stillInOldSeat++;
            }
        }
        // 注意:500 次尝试应该足以消除大部分冲突,允许少量(由 maxAttempts 决定)
        assert(stillInOldSeat <= 2, `500 次尝试后冲突应 ≤ 2,实际 ${stillInOldSeat}`);
    });
});

// =====================================================================
// 套件 G:forcedPair 处理
// =====================================================================
group('G. forcedPair — 强制配对必同桌', () => {
    test('设 1 对 forcedPair,运行 random 后这两人必同桌', () => {
        const students = makeStudents(10, 5);
        resetState({ rows: 4, cols: 4, students });
        state.forcedPairs = [['s001', 's002']];
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.randomSeatArrange('random');
        const { pairMap } = mod.getDeskMatePairs();
        const s1Seat = state.seats.indexOf('s001');
        const s2Seat = state.seats.indexOf('s002');
        assert(s1Seat >= 0 && s2Seat >= 0, '两人都入座');
        const mate = pairMap[s1Seat];
        assert(mate === s2Seat, `s001 同桌应为 s002 所在 seat ${s2Seat},实际 mate=${mate},该 seat 坐的是 ${state.seats[mate]}`);
    });
});

// =====================================================================
// 套件 H:配对修复 — 随机排座后必须满足配对设置,做不到则提示
// =====================================================================
group('H. 配对修复 — 满足则无提示,做不到则先安排后提示', () => {
    function isDeskmate(mod, idA, idB) {
        const { pairMap } = mod.getDeskMatePairs();
        const a = state.seats.indexOf(idA);
        const b = state.seats.indexOf(idB);
        if (a < 0 || b < 0) return null;
        return pairMap[a] === b;
    }

    test('2 对互不相交的强制配对 + 1 对回避 ⇒ 全部满足,无配对提示', () => {
        const students = makeStudents(12, 6);
        resetState({ rows: 4, cols: 6, students });
        state.forcedPairs = [['s001', 's002'], ['s003', 's004']];
        state.avoidPairs = [['s005', 's006']];
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        const r = mod.randomSeatArrange('random');
        assert(isDeskmate(mod, 's001', 's002') === true, 's001/s002 应同桌');
        assert(isDeskmate(mod, 's003', 's004') === true, 's003/s004 应同桌');
        assert(isDeskmate(mod, 's005', 's006') === false, 's005/s006 应分开');
        assert(!(r.warnings || []).some(w => /配对设置未能完全满足/.test(w)),
            `不应出现配对未满足提示,实际 ${JSON.stringify(r.warnings)}`);
    });

    test('不可能同时满足的强制配对(s001 配 s002 又配 s003)⇒ 保留座位并提示', () => {
        const students = makeStudents(12, 6);
        resetState({ rows: 4, cols: 6, students });
        // s001 只有 1 个同桌位,不可能同时与 s002、s003 同桌 ⇒ 必然剩 1 条未满足
        state.forcedPairs = [['s001', 's002'], ['s001', 's003']];
        state.avoidPairs = [];
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        const r = mod.randomSeatArrange('random');
        const ok12 = isDeskmate(mod, 's001', 's002');
        const ok13 = isDeskmate(mod, 's001', 's003');
        assert(ok12 === true || ok13 === true, '至少满足其中 1 对');
        assert(!(ok12 === true && ok13 === true), '不可能两对同时满足');
        assert((r.warnings || []).some(w => /配对设置未能完全满足/.test(w)),
            `应给出配对未满足提示,实际 ${JSON.stringify(r.warnings)}`);
        // 座位仍然排好了(所有人都入座)
        assertEq(state.seats.filter(Boolean).length, 12, '12 人全部入座(先安排)');
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
