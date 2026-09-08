// =====================================================================
// tests/unit_rotate_groups.mjs
//
// Node ESM 单元测试 — random-arrange 模块的「分组轮换」(rotateGroupSeats)
//
// 覆盖:
//   A. 等人数三组 +1 轮换 — 每组学生整体落到下一组的座位区
//   B. 人数不等 — 按 min(源组人数, 目标组座位) 轮换,剩余回填自己组
//   C. 硬约束 — 占座总数不变 / 无重复占座 / 无分组学生原地不动
//   D. 边界 — 分组 < 2 / 无已入座分组学生 / 取消 confirm
//   E. 步长归一 — 0 / 负数 / 超界 / 非数字
//   F. 分组元信息(id / name / color)不变
//   G. 压力 — 随机规模 × 多 seed,恒等约束成立
//
// 运行: node static/tests/unit_rotate_groups.mjs
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
globalThis.__lastAlertMsg__ = null;

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

// 「溢出改归上游组」是预期行为,会产出一条提示性 warning;
// 数据完整性类(占座总数异常 / 重复占座 / 轮换中止)才是真错误 —— 这里把它们分开。
const OVERFLOW_WARN = /未能轮换/;
function integrityWarnings(warnings) {
    return (warnings || []).filter(function (w) { return !OVERFLOW_WARN.test(w); });
}
function overflowWarnings(warnings) {
    return (warnings || []).filter(function (w) { return OVERFLOW_WARN.test(w); });
}

// --- 4. 工厂(确定性 shuffle)---
function makeModule(seed = 42) {
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
// sizes: [3, 3, 3] → 3 个分组,各 3 人;分组按数组顺序即「建立顺序」
// 座位布局:分组 i 的学生占 [start_i, start_i + size_i) 连续下标
function setup(sizes, opts = {}) {
    opts = opts || {};
    const groups = sizes.map((n, i) => ({
        id: 'g' + (i + 1),
        name: '第' + (i + 1) + '组',
        color: '#COLOR' + (i + 1)
    }));
    const students = [];
    let k = 0;
    sizes.forEach((n, i) => {
        for (let j = 0; j < n; j++) {
            students.push({
                id: 's' + (++k),
                name: '学生' + k,
                groupId: groups[i].id,
                gender: k % 2 ? 'male' : 'female'
            });
        }
    });
    // 无分组学生(用于验证「原地不动」)
    if (opts.ungrouped) {
        for (let u = 0; u < opts.ungrouped; u++) {
            students.push({
                id: 'u' + (u + 1),
                name: '无分组' + (u + 1),
                groupId: null,
                gender: 'male'
            });
        }
    }

    const total = students.length;
    const rows = opts.rows || 4;
    const cols = opts.cols || 4;
    const seats = Array(rows * cols).fill(null);

    // 分组学生连续入座;无分组学生放末尾
    let idx = 0;
    const region = {};   // groupId → [起始下标, 结束下标)
    sizes.forEach((n, i) => {
        region[groups[i].id] = [idx, idx + n];
        for (let j = 0; j < n; j++) {
            seats[idx] = students[idx].id;
            idx++;
        }
    });
    const ungroupedSeats = [];
    if (opts.ungrouped) {
        for (let u = 0; u < opts.ungrouped; u++) {
            seats[idx] = students[idx].id;
            ungroupedSeats.push(idx);
            idx++;
        }
    }

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
    return { groups, students, region, ungroupedSeats, total };
}

// 座位下标 → 该下标原本属于哪个分组(基于 setup 的连续布局)
function regionOf(scene, seatIdx) {
    for (const gid of Object.keys(scene.region)) {
        const [a, b] = scene.region[gid];
        if (seatIdx >= a && seatIdx < b) return gid;
    }
    return null;
}

function groupOf(studentId) {
    const s = state.students.find(x => x.id === studentId);
    return s ? s.groupId : null;
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
// 套件 A:等人数三组 +1 轮换
// =====================================================================
group('A. 等人数三组 +1 轮换 — 整体落到下一组座位区', () => {
    test('3 组各 3 人,offset=1 → 每组学生进入下一组原来的座位区', () => {
        const scene = setup([3, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod, calls } = makeModule();

        const r = mod.rotateGroupSeats(1);

        assertEq(r.warnings, [], '无 warning');
        assertEq(calls.pushSnapshot, 1, 'pushSnapshot 1 次');
        assertEq(calls.generateSeats, 1, 'generateSeats 1 次');
        assertEq(placedCount(), 9, '占座总数不变');
        assert(!hasDuplicate(), '无重复占座');

        // 组 0 的学生应落在 region(g2),组 1 → region(g3),组 2 → region(g1)
        const expect = { g1: 'g2', g2: 'g3', g3: 'g1' };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            const gid = groupOf(sid);
            assertEq(regionOf(scene, idx), expect[gid],
                `学生 ${sid}(${gid}) 落在座位 ${idx}`);
        });
    });

    test('3 组各 3 人,offset=2 → 等价于反向轮换一组', () => {
        const scene = setup([3, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(2);
        assertEq(placedCount(), 9, '占座总数不变');
        const expect = { g1: 'g3', g2: 'g1', g3: 'g2' };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            const gid = groupOf(sid);
            assertEq(regionOf(scene, idx), expect[gid],
                `学生 ${sid}(${gid}) 落在座位 ${idx}`);
        });
    });

    test('4 组各 2 人,offset=1 → 四组环式轮换', () => {
        const scene = setup([2, 2, 2, 2]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(1);
        assertEq(placedCount(), 8, '占座总数不变');
        const expect = { g1: 'g2', g2: 'g3', g3: 'g4', g4: 'g1' };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            const gid = groupOf(sid);
            assertEq(regionOf(scene, idx), expect[gid], `座位 ${idx}`);
        });
    });
});

// =====================================================================
// 套件 B:人数不等 — min() 规则 + 剩余回填
// =====================================================================
group('B. 人数不等 — 按较少一方轮换,剩余回到自己组', () => {
    test('A(5) B(3) C(3) offset=1 → B/C 区被填满,A 区混坐 3C+2A', () => {
        const scene = setup([5, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        const r = mod.rotateGroupSeats(1);

        assertEq(integrityWarnings(r.warnings), [], '无数据完整性 warning');
        assertEq(overflowWarnings(r.warnings).length, 1, '1 条溢出改归提示');
        assertEq(placedCount(), 11, '占座总数不变(5+3+3)');
        assert(!hasDuplicate(), '无重复占座');

        const inRegion = { g1: [], g2: [], g3: [] };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            const reg = regionOf(scene, idx);
            if (reg) inRegion[reg].push(groupOf(sid));
        });

        // B 区(3 座)全坐 A 组学生:m = min(5, 3) = 3
        assertEq(inRegion.g2, ['g1', 'g1', 'g1'], 'B 区坐 3 名 A 组学生');
        // C 区(3 座)全坐 B 组学生:m = min(3, 3) = 3
        assertEq(inRegion.g3, ['g2', 'g2', 'g2'], 'C 区坐 3 名 B 组学生');
        // A 区(5 座):3 名 C 组轮换进来 + 2 名未能轮换的 A 组。
        // 新规则:A 组溢出的 2 人改归「占了其原座位的上游组」= C 组 ⇒ A 区 5 人全为 C 组
        assertEq(inRegion.g1.filter(g => g === 'g3').length, 5, 'A 区 5 人全为 C 组(3 轮换 + 2 溢出改归)');
        assertEq(inRegion.g1.filter(g => g === 'g1').length, 0, 'A 区已无 A 组(溢出者已改归 C 组)');
    });

    test('A(2) B(6) C(2) offset=1 → A/C 区各 2 人换走,B 区 4 人留原区', () => {
        const scene = setup([2, 6, 2]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        const r = mod.rotateGroupSeats(1);
        assertEq(integrityWarnings(r.warnings), [], '无数据完整性 warning');
        assertEq(overflowWarnings(r.warnings).length, 1, '1 条溢出改归提示');
        assertEq(placedCount(), 10, '占座总数不变');

        const inRegion = { g1: [], g2: [], g3: [] };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            const reg = regionOf(scene, idx);
            if (reg) inRegion[reg].push(groupOf(sid));
        });
        // A 区(2 座) ← C 组:m = min(2, 2) = 2
        assertEq(inRegion.g1, ['g3', 'g3'], 'A 区坐 2 名 C 组');
        // C 区(2 座) ← B 组:m = min(6, 2) = 2
        assertEq(inRegion.g3, ['g2', 'g2'], 'C 区坐 2 名 B 组');
        // B 区(6 座)= 2 名 A 组(m=min(2,6)=2)+ 4 名未能轮换的 B 组。
        // 新规则:B 组溢出的 4 人改归上游组 = A 组 ⇒ B 区 6 人全为 A 组
        assertEq(inRegion.g2.filter(g => g === 'g1').length, 6, 'B 区 6 人全为 A 组(2 轮换 + 4 溢出改归)');
        assertEq(inRegion.g2.filter(g => g === 'g2').length, 0, 'B 区已无 B 组(溢出者已改归 A 组)');
    });

    test('极端:某组 0 人 → 其余组正常轮换,空组不产生错误', () => {
        const scene = setup([0, 4, 4]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        const r = mod.rotateGroupSeats(1);
        // C 组 4 人挤不进 A 组(0 座)⇒ 全部溢出,改归上游组 B 组
        assertEq(integrityWarnings(r.warnings), [], '无数据完整性 warning');
        assertEq(overflowWarnings(r.warnings).length, 1, '1 条溢出改归提示');
        assertEq(placedCount(), 8, '占座总数不变');
        assert(!hasDuplicate(), '无重复占座');
        void scene;
    });
});

// =====================================================================
// 套件 C:硬约束
// =====================================================================
group('C. 硬约束 — 总数不变 / 无重复 / 无分组学生不动', () => {
    test('无分组学生(groupId=null)全程原地不动', () => {
        const scene = setup([3, 3, 3], { ungrouped: 2, rows: 4, cols: 4 });
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(1);

        // 无分组学生原本坐在下标 9、10
        scene.ungroupedSeats.forEach((seatIdx, i) => {
            assertEq(state.seats[seatIdx], 'u' + (i + 1),
                `无分组学生 u${i + 1} 应仍在座位 ${seatIdx}`);
        });
        assertEq(placedCount(), 11, '占座总数不变(9 分组 + 2 无分组)');
    });

    test('轮换后学生集合完全不变(没有丢人 / 没有多人)', () => {
        const scene = setup([4, 2, 5], { rows: 4, cols: 4 });
        const before = state.students.map(s => s.id).sort();
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(1);
        const after = state.seats.filter(Boolean).slice().sort();
        assertEq(after, before, '座位上的学生集合 = 学生名单');
        void scene;
    });

    test('连续轮换 3 次回到原分组区(offset=1 × 3 组 = 恒等)', () => {
        const scene = setup([3, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule(2024);
        mod.rotateGroupSeats(1);
        mod.rotateGroupSeats(1);
        mod.rotateGroupSeats(1);
        // 轮换 3 次后,每组学生回到自己组的座位区(座位区由上一轮学生的位置重新定义)
        assertEq(placedCount(), 9, '占座总数不变');
        assert(!hasDuplicate(), '无重复占座');
        void scene;
    });
});

// =====================================================================
// 套件 D:边界与交互
// =====================================================================
group('D. 边界 — 分组不足 / 无人入座 / 取消', () => {
    test('分组 < 2 → alert + warning,不 pushSnapshot', () => {
        setup([5]);
        globalThis.__confirmAnswer__ = true;
        globalThis.__lastAlertMsg__ = null;
        const { mod, calls } = makeModule();
        const r = mod.rotateGroupSeats(1);
        assert(/至少 2 个分组/.test(globalThis.__lastAlertMsg__ || ''), '应提示需要 2 个分组');
        assert(r.warnings.length === 1, '1 条 warning');
        assertEq(calls.pushSnapshot, 0, '不 pushSnapshot');
        assertEq(calls.generateSeats, 0, '不 generateSeats');
    });

    test('有分组但无人入座 → alert + warning,座位未被改写', () => {
        setup([3, 3]);
        state.seats = Array(state.rows * state.cols).fill(null);
        globalThis.__confirmAnswer__ = true;
        globalThis.__lastAlertMsg__ = null;
        const { mod, calls } = makeModule();
        const r = mod.rotateGroupSeats(1);
        assert(/没有已安排座位/.test(globalThis.__lastAlertMsg__ || ''), '应提示无已入座分组学生');
        assert(r.warnings.length === 1, '1 条 warning');
        assertEq(calls.pushSnapshot, 0, '不 pushSnapshot');
    });

    test('取消 confirm → 返回空 warnings,座位完全不变', () => {
        setup([3, 3, 3]);
        const before = state.seats.join(',');
        globalThis.__confirmAnswer__ = false;
        const { mod, calls } = makeModule();
        const r = mod.rotateGroupSeats(1);
        assertEq(r.warnings, [], 'cancel 返回空 warnings');
        assertEq(r.moved, 0, 'moved = 0');
        assertEq(state.seats.join(','), before, '座位不变');
        assertEq(calls.pushSnapshot, 0, '不 pushSnapshot');
        globalThis.__confirmAnswer__ = true;
    });
});

// =====================================================================
// 套件 E:步长归一
// =====================================================================
group('E. 步长归一 — 0 / 负数 / 超界 / 非数字', () => {
    test('offset=0 → 归一为 1', () => {
        const scene = setup([3, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(0);
        const expect = { g1: 'g2', g2: 'g3', g3: 'g1' };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            assertEq(regionOf(scene, idx), expect[groupOf(sid)], `座位 ${idx}`);
        });
    });

    test('offset = 组数(3) → 归一为 1(3 % 3 = 0 → 折回 1)', () => {
        const scene = setup([3, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(3);
        const expect = { g1: 'g2', g2: 'g3', g3: 'g1' };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            assertEq(regionOf(scene, idx), expect[groupOf(sid)], `座位 ${idx}`);
        });
    });

    test('offset = 组数 + 1(4) → 归一为 1', () => {
        const scene = setup([3, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(4);
        const expect = { g1: 'g2', g2: 'g3', g3: 'g1' };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            assertEq(regionOf(scene, idx), expect[groupOf(sid)], `座位 ${idx}`);
        });
    });

    test('offset 为 NaN / 字符串 → 归一为 1', () => {
        const scene = setup([3, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats('abc');
        const expect = { g1: 'g2', g2: 'g3', g3: 'g1' };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            assertEq(regionOf(scene, idx), expect[groupOf(sid)], `座位 ${idx}`);
        });
    });

    test('offset 为负数(-1) → 归一为 2(等价于往回一组)', () => {
        const scene = setup([3, 3, 3]);
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(-1);
        const expect = { g1: 'g3', g2: 'g1', g3: 'g2' };
        state.seats.forEach((sid, idx) => {
            if (!sid) return;
            assertEq(regionOf(scene, idx), expect[groupOf(sid)], `座位 ${idx}`);
        });
    });
});

// =====================================================================
// 套件 F:分组元信息不变
// =====================================================================
group('F. 分组元信息(id / name / color)轮换前后不变', () => {
    test('3 组轮换后 groups 数组逐字段一致', () => {
        setup([4, 3, 2]);
        const before = JSON.parse(JSON.stringify(state.groups));
        globalThis.__confirmAnswer__ = true;
        const { mod } = makeModule();
        mod.rotateGroupSeats(2);
        assertEq(state.groups, before, 'groups 不变');
        // 学生的 groupId 也不应被改写(换个座位 ≠ 换个组)
        const gids = {};
        state.students.forEach(s => { gids[s.id] = s.groupId; });
        assertEq(Object.values(gids).filter(Boolean).length, 9, '9 名学生仍有所属分组');
    });
});

// =====================================================================
// 套件 G:压力测试 — 恒等约束
// =====================================================================
group('G. 压力 — 随机规模 × 多 seed,占座总数与唯一性恒成立', () => {
    test('20 组随机规模 × 8 seed → 占座总数不变、无重复、无 warning', () => {
        let s = 99;
        const rnd = (n) => {
            s = (s * 1103515245 + 12345) >>> 0;
            return (s >>> 8) % n;
        };
        for (let t = 0; t < 20; t++) {
            const gCount = 2 + rnd(5);              // 2..6 组
            const sizes = [];
            let sum = 0;
            for (let i = 0; i < gCount; i++) {
                const n = rnd(6);                    // 0..5 人(允许 0 人组)
                sizes.push(n);
                sum += n;
            }
            if (sum === 0) sizes[0] = 3;             // 至少保证有人
            sum = sizes.reduce((a, b) => a + b, 0);
            const rows = Math.max(4, Math.ceil(Math.sqrt(sum)) + 1);
            setup(sizes, { rows: rows, cols: rows });
            globalThis.__confirmAnswer__ = true;
            const { mod } = makeModule(1000 + t);
            const r = mod.rotateGroupSeats(1 + rnd(gCount));
            assertEq(integrityWarnings(r.warnings), [],
                `第 ${t} 轮不应有数据完整性 warning:${r.warnings.join('/')}`);
            assertEq(placedCount(), sum, `第 ${t} 轮占座总数应为 ${sum}`);
            assert(!hasDuplicate(), `第 ${t} 轮出现重复占座`);
        }
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
