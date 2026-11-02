// =====================================================================
// tests/unit_group_layout.mjs
//
// Node ESM 单元测试 — modules/group-layout.js（按组聚座 / 座位块规划）
//
// 覆盖:
//   A. chooseBlockShape — 6 人 6 组 → 2×3 或 3×2；40 人 6 组 → 2×4
//   B. planGroupSeatSlots — 每组座位连成矩形块、互不重叠、总人数不丢
//   C. 形状约束 — 组实际占用的行数 / 列数之差 <= 2
//   D. 容量不足 / 几何非法 — ok=false 且给出原因
//   E. 被占座位（blocked）— 跳过仍能坐满
//   F. 无法铺块时退化为「顺序连续排」
//   G. 边界 — 空数组 / 全 0 组
//
// 运行: node static/tests/unit_group_layout.mjs
// 退出码: 0 = 全部通过
// =====================================================================

const { chooseBlockShape, planGroupSeatSlots, seatIndexOf } = await import('../modules/group-layout.js');

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

// 检查一组座位是否「连成一片」：占用区域为 rowsUsed × colsUsed 的矩形，
// 且内部没有空洞（按块式布局逐行填，允许最后一行不满）。
function checkCompact(slotList, cols) {
    const cells = slotList.map(function (i) { return seatIndexOf(i, cols); });
    const rows = cells.map(function (c) { return c.row; });
    const colVals = cells.map(function (c) { return c.col; });
    const rMin = Math.min.apply(null, rows);
    const rMax = Math.max.apply(null, rows);
    const cMin = Math.min.apply(null, colVals);
    const cMax = Math.max.apply(null, colVals);
    return {
        rowsUsed: rMax - rMin + 1,
        colsUsed: cMax - cMin + 1,
        span: (rMax - rMin + 1) * (cMax - cMin + 1),
        rMin: rMin, rMax: rMax, cMin: cMin, cMax: cMax
    };
}

console.log('\n=== A. chooseBlockShape ===');

test('6 组各 6 人 / 8×8 → 2 行 3 列 或 3 行 2 列', () => {
    const shape = chooseBlockShape([6, 6, 6, 6, 6, 6], 8, 8);
    assert(shape, '应能选出块尺寸');
    const pair = shape.bh + 'x' + shape.bw;
    assert(pair === '2x3' || pair === '3x2', '期望 2x3 或 3x2，实际 ' + pair);
    assertEqual(shape.needRows <= 8, true, '总行数应放得下');
});

test('6 组各 7 人（40 人 6 组）/ 8×8 → 2 行 4 列', () => {
    const shape = chooseBlockShape([7, 7, 7, 7, 6, 6], 8, 8);
    assertEqual(shape.bh + 'x' + shape.bw, '2x4');
});

test('块内空位优先于形状：18 人 6 组 → 每块恰好 3 座', () => {
    const shape = chooseBlockShape([3, 3, 3, 3, 3, 3], 8, 8);
    assertEqual(shape.bh * shape.bw, 3, '块容量应等于组人数');
});

test('组数多到放不下时返回 null', () => {
    const shape = chooseBlockShape([5], 2, 2);
    assertEqual(shape, null);
});

console.log('\n=== B. planGroupSeatSlots 基本正确性 ===');

test('6 组 × 6 人 / 8×8：每组 6 座、互不重叠、总数 36', () => {
    const sizes = [6, 6, 6, 6, 6, 6];
    const plan = planGroupSeatSlots(sizes, 8, 8);
    assertEqual(plan.ok, true);
    assertEqual(plan.layout.kind, 'block');
    assertEqual(plan.slots.length, 6, '槽位数应与组数一致');
    const all = [];
    plan.slots.forEach(function (list, i) {
        assertEqual(list.length, sizes[i], '第 ' + i + ' 组座位数应等于人数');
        list.forEach(function (idx) { all.push(idx); });
    });
    assertEqual(new Set(all).size, 36, '座位不应重复');
    all.forEach(function (idx) {
        assert(idx >= 0 && idx < 64, '座位下标越界: ' + idx);
    });
});

test('每组座位连成一片，且行列差 <= 2', () => {
    const sizes = [6, 6, 6, 6, 6, 6];
    const plan = planGroupSeatSlots(sizes, 8, 8);
    plan.slots.forEach(function (list, i) {
        const info = checkCompact(list, 8);
        assertEqual(info.span, list.length, '第 ' + i + ' 组占用区域有空洞');
        assert(Math.abs(info.rowsUsed - info.colsUsed) <= 2,
            '第 ' + i + ' 组行列差 ' + Math.abs(info.rowsUsed - info.colsUsed) + ' > 2');
    });
});

test('组块之间不重叠且顺序为「从左到右、从上到下」', () => {
    const sizes = [6, 6, 6, 6, 6, 6];
    const plan = planGroupSeatSlots(sizes, 8, 8);
    assertEqual(plan.blocks.length, 6);
    const first = plan.blocks[0];
    const second = plan.blocks[1];
    assertEqual(first.r0, second.r0, '前两个块应在同一行带');
    assert(second.c0 > first.c0, '第二个块应在第一个块右侧');
    // 每个块的座位恰好落在自己的矩形范围内
    plan.blocks.forEach(function (b) {
        const list = plan.slots[b.groupIndex];
        list.forEach(function (idx) {
            const pos = seatIndexOf(idx, 8);
            assert(pos.row >= b.r0 + 1 && pos.row <= b.r0 + b.rows,
                '座位超出块的行范围');
            assert(pos.col >= b.c0 + 1 && pos.col <= b.c0 + b.cols,
                '座位超出块的列范围');
        });
    });
});

test('块内按逐行（row-major）填座', () => {
    const plan = planGroupSeatSlots([6, 6, 6, 6, 6, 6], 8, 8);
    const block = plan.blocks[0];
    const expect = [];
    for (let r = 0; r < block.rows; r++) {
        for (let c = 0; c < block.cols; c++) {
            expect.push((block.r0 + r) * 8 + (block.c0 + c));
        }
    }
    // 第一个块占满 6 个座位（块容量 = 组人数）⇒ 槽位序列应与逐行展开完全一致
    assertEqual(block.rows * block.cols, 6, '此用例假定块容量恰好等于组人数');
    assertDeepEqual(plan.slots[0], expect);
});

console.log('\n=== C. 人数不均 / 大班 ===');

test('人数不均（7,7,7,7,6,6）：每组都能坐满且不重叠', () => {
    const sizes = [7, 7, 7, 7, 6, 6];
    const plan = planGroupSeatSlots(sizes, 8, 8);
    const used = new Set();
    plan.slots.forEach(function (list, i) {
        assertEqual(list.length, sizes[i]);
        list.forEach(function (idx) {
            assert(!used.has(idx), '座位重复');
            used.add(idx);
        });
    });
    assertEqual(used.size, 40);
});

test('大班 48 人 6 组 / 8×8：仍能全部落座', () => {
    const sizes = [8, 8, 8, 8, 8, 8];
    const plan = planGroupSeatSlots(sizes, 8, 8);
    assertEqual(plan.ok, true);
    const used = new Set();
    plan.slots.forEach(function (l) { l.forEach(function (i) { used.add(i); }); });
    assertEqual(used.size, 48);
});

console.log('\n=== D. 失败路径 ===');

test('座位不够 → ok=false, reason=capacity', () => {
    const plan = planGroupSeatSlots([10, 10, 10], 3, 3);
    assertEqual(plan.ok, false);
    assertEqual(plan.reason, 'capacity');
    assertEqual(plan.need, 30);
    assertEqual(plan.free, 9);
});

test('几何非法 → ok=false, reason=geometry', () => {
    assertEqual(planGroupSeatSlots([1], 0, 5).reason, 'geometry');
    assertEqual(planGroupSeatSlots([1], 5, 0).reason, 'geometry');
    assertEqual(planGroupSeatSlots([], 5, 5).reason, 'geometry');
});

console.log('\n=== E. 已被占住的座位（未分组学生）===');

test('blocked 座位被跳过，所有人仍能坐下', () => {
    const sizes = [6, 6];
    const blocked = new Array(64).fill(false);
    blocked[0] = true;                 // 占住 (1,1) —— 正好在第一个块的起点
    blocked[1] = true;
    const plan = planGroupSeatSlots(sizes, 8, 8, blocked);
    assertEqual(plan.ok, true);
    const all = [];
    plan.slots.forEach(function (l) { l.forEach(function (i) { all.push(i); }); });
    assertEqual(all.length, 12);
    assert(all.indexOf(0) < 0, '被占座位不应被分配');
    assert(all.indexOf(1) < 0, '被占座位不应被分配');
    assertEqual(new Set(all).size, 12);
});

console.log('\n=== F. 退化布局 ===');

test('铺不下块时退化为顺序连续排（仍一组一段）', () => {
    const sizes = [2, 2, 2, 2];
    const plan = planGroupSeatSlots(sizes, 3, 3);
    assertEqual(plan.ok, true);
    assertEqual(plan.layout.kind, 'sequential');
    const all = [];
    plan.slots.forEach(function (l) { l.forEach(function (i) { all.push(i); }); });
    assertEqual(all.length, 8);
    // 顺序排：第 1 组 = [0,1]，第 2 组 = [2,3] ...（跳过 blocked 无）
    assertDeepEqual(plan.slots[0], [0, 1]);
    assertDeepEqual(plan.slots[1], [2, 3]);
});

console.log('\n=== G. 边界 ===');

test('含 0 人的组：槽位为空数组，不影响其他组', () => {
    const plan = planGroupSeatSlots([4, 0, 4], 8, 8);
    assertEqual(plan.ok, true);
    assertDeepEqual(plan.slots[1], []);
    assertEqual(plan.slots[0].length, 4);
    assertEqual(plan.slots[2].length, 4);
    assertEqual(plan.blocks.length, 2, '0 人组不应产生块');
});

test('单个分组 → 块占满可用区域的第一片', () => {
    const plan = planGroupSeatSlots([5], 8, 8);
    assertEqual(plan.ok, true);
    assertEqual(plan.slots[0].length, 5);
    const info = checkCompact(plan.slots[0], 8);
    assert(Math.abs(info.rowsUsed - info.colsUsed) <= 2);
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
