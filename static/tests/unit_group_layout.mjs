// =====================================================================
// tests/unit_group_layout.mjs
//
// Node ESM 单元测试 — modules/group-layout.js（按组聚座 / 每组最紧凑矩形）
//
// 覆盖（v1.4.8 起的核心是「按组人数各自取最紧凑」，不再是全班统一块）:
//   A. chooseCompactShape — 主目标「总行数 + 总列数」最小；6 人 → 3行×2列
//   B. 题面示例 — 6 人一组精确落在 (1,1)(1,2)(2,1)(2,2)(3,1)(3,2)
//   C. 逐组独立 — 各组 span 等于该组人数的理论最优 span；形状彼此不同
//   D. 通用不变量 — 人数不丢、座位不重叠、块外接矩形无空洞、row-major 填座
//   E. 顺序无关 — 增删 / 改序别组后，本组形状不变
//   F. blocked — 未分组学生占座被跳过，仍能坐满且不被挪动
//   G. 失败路径 — 容量不足 / 几何非法 / 0 人组
//   H. 小教室退化 — 极端布局仍不丢人
//
// 运行: node static/tests/unit_group_layout.mjs
// 退出码: 0 = 全部通过
// =====================================================================

const { chooseCompactShape, planGroupSeatSlots, seatIndexOf } = await import('../modules/group-layout.js');

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

/** 一组座位的外接矩形（1 基坐标） */
function checkCompact(slotList, cols) {
    const cells = slotList.map(function (i) { return seatIndexOf(i, cols); });
    const rows = cells.map(function (c) { return c.row; });
    const colVals = cells.map(function (c) { return c.col; });
    const rMin = Math.min.apply(null, rows);
    const rMax = Math.max.apply(null, rows);
    const cMin = Math.min.apply(null, colVals);
    const cMax = Math.max.apply(null, colVals);
    const usedRows = rMax - rMin + 1;
    const usedCols = cMax - cMin + 1;
    return {
        rowsUsed: usedRows,
        colsUsed: usedCols,
        span: usedRows + usedCols,
        area: usedRows * usedCols,
        r0: rMin - 1, c0: cMin - 1
    };
}

function assertNoOverlap(plan, sizes, label) {
    const all = [];
    plan.slots.forEach(function (list, i) {
        assertEqual(list.length, sizes[i], (label || '') + ' 第 ' + i + ' 组人数');
        list.forEach(function (idx) { all.push(idx); });
    });
    assertEqual(new Set(all).size, all.length, (label || '') + ' 座位不可重复');
    return all;
}

console.log('\n=== A. chooseCompactShape（按人数取最紧凑）===');

test('6 人 → 3行×2列（题面示例，行+列=5）', () => {
    const s = chooseCompactShape(6, 8, 8);
    assert(s, '应能选出形状');
    assertEqual(s.bh + 'x' + s.bw, '3x2');
    assertEqual(s.span, 5);
});

test('常见人数都取到「行+列」最小的矩形', () => {
    const cases = [
        [1, '1x1', 2], [2, '2x1', 3], [3, '3x1', 4], [4, '2x2', 4],
        [5, '3x2', 5], [6, '3x2', 5], [7, '4x2', 6], [8, '4x2', 6],
        [9, '3x3', 6], [10, '5x2', 7], [12, '4x3', 7]
    ];
    cases.forEach(function (c) {
        const s = chooseCompactShape(c[0], 8, 8);
        assert(s, c[0] + ' 人应有可行形状');
        assertEqual(s.bh + 'x' + s.bw, c[1], c[0] + ' 人形状');
        assertEqual(s.span, c[2], c[0] + ' 人的最小行列和');
    });
});

test('同等行列和下空位更少者优先（7 人取 4×2 而非 3×3）', () => {
    const s = chooseCompactShape(7, 8, 8);
    assertEqual(s.bh + 'x' + s.bw, '4x2');
    assertEqual(s.area - 7, 1, '只应有 1 个空位');
});

test('教室放不下 / 参数非法 → null', () => {
    assertEqual(chooseCompactShape(5, 2, 2), null);
    assertEqual(chooseCompactShape(0, 8, 8), null);
    assertEqual(chooseCompactShape(6, 0, 8), null);
});

console.log('\n=== B. 题面示例：6 人一组 ===');

test('6 人精确占据 (1,1)(1,2)(2,1)(2,2)(3,1)(3,2)', () => {
    const plan = planGroupSeatSlots([6], 8, 8);
    assertEqual(plan.ok, true);
    assertDeepEqual(plan.slots[0], [0, 1, 8, 9, 16, 17]);
    assertEqual(plan.layout.kind, 'compact');
    assertEqual(plan.blocks[0].rows + 'x' + plan.blocks[0].cols, '3x2');
});

test('6 人 6 组 / 8×8：全部 3×2、互不重叠、按从左到右铺开', () => {
    const sizes = [6, 6, 6, 6, 6, 6];
    const plan = planGroupSeatSlots(sizes, 8, 8);
    assertEqual(plan.ok, true);
    assertNoOverlap(plan, sizes);
    assertEqual(plan.blocks.length, 6);
    plan.blocks.forEach(function (b, i) {
        assertEqual(b.rows + 'x' + b.cols, '3x2', '第 ' + i + ' 组形状');
    });
    assertEqual(plan.blocks[0].r0, plan.blocks[1].r0, '前两个块应同排');
    assert(plan.blocks[1].c0 > plan.blocks[0].c0, '第二块在第一块右侧');
});

console.log('\n=== C. 逐组独立（核心：不再统一块形状）===');

test('[6,4,2]：每组 span = 该组人数的最优 span，且三种形状各不相同', () => {
    const sizes = [6, 4, 2];
    const plan = planGroupSeatSlots(sizes, 8, 8);
    assertEqual(plan.ok, true);
    assertNoOverlap(plan, sizes);
    const shapes = [];
    plan.slots.forEach(function (list, i) {
        const info = checkCompact(list, 8);
        const ideal = chooseCompactShape(sizes[i], 8, 8);
        assertEqual(info.span, ideal.span, '第 ' + i + ' 组应达到最优行列和');
        assertEqual(info.area, list.length, '第 ' + i + ' 组外接矩形不应有空洞');
        shapes.push(info.rowsUsed + 'x' + info.colsUsed);
    });
    assertDeepEqual(shapes, ['3x2', '2x2', '2x1']);
    assertEqual(new Set(shapes).size, 3, '各组形状不应被统一成一个矩形');
});

test('[6,4]：小组不再被套进大组的块（4 人必须是 2×2，而不是 2×3）', () => {
    const plan = planGroupSeatSlots([6, 4], 8, 8);
    const info = checkCompact(plan.slots[1], 8);
    assertEqual(info.rowsUsed + 'x' + info.colsUsed, '2x2');
    assertEqual(info.span, 4);
});

test('多组混合人数：每组都达到理论最优 span', () => {
    const cases = [
        [[5, 3, 7, 2], 10, 10],
        [[8, 6, 4], 10, 10],
        [[7, 7, 7, 7, 6, 6], 8, 8],
        [[9, 5, 2, 8], 10, 10],
        [[3, 3, 3, 3, 3, 3], 8, 8]
    ];
    cases.forEach(function (c) {
        const sizes = c[0], R = c[1], C = c[2];
        const plan = planGroupSeatSlots(sizes, R, C);
        assertEqual(plan.ok, true, JSON.stringify(sizes) + ' 应可规划');
        assertNoOverlap(plan, sizes, JSON.stringify(sizes));
        plan.slots.forEach(function (list, i) {
            const info = checkCompact(list, C);
            const ideal = chooseCompactShape(sizes[i], R, C);
            assertEqual(info.span, ideal.span,
                JSON.stringify(sizes) + ' 第 ' + i + ' 组(' + sizes[i] + '人) span');
        });
    });
});

console.log('\n=== D. 通用不变量 ===');

test('座位全在块内、块内 row-major 填座（空位只留在末尾）', () => {
    const sizes = [6, 4, 2, 5];
    const plan = planGroupSeatSlots(sizes, 10, 10);
    plan.blocks.forEach(function (b) {
        const list = plan.slots[b.groupIndex];
        const rect = [];
        for (let r = 0; r < b.rows; r++) {
            for (let c = 0; c < b.cols; c++) rect.push((b.r0 + r) * 10 + (b.c0 + c));
        }
        assert(b.rows * b.cols >= list.length, '外接矩形必须装得下本组');
        assertDeepEqual(list, rect.slice(0, list.length));
        list.forEach(function (idx) {
            assert(idx >= 0 && idx < 100, '座位下标越界');
        });
    });
});

test('人数恰好填满矩形时外接矩形无空洞（6 人 3×2）', () => {
    const plan = planGroupSeatSlots([6], 10, 10);
    assertEqual(plan.blocks[0].rows * plan.blocks[0].cols, 6);
});

test('layout.shapes 逐组给出人数与实际收拢形状', () => {
    const plan = planGroupSeatSlots([6, 4, 2], 8, 8);
    assertEqual(plan.layout.kind, 'compact');
    assertEqual(plan.layout.groupCount, 3);
    assertDeepEqual(plan.layout.shapes, [
        { groupIndex: 0, size: 6, rows: 3, cols: 2, span: 5 },
        { groupIndex: 1, size: 4, rows: 2, cols: 2, span: 4 },
        { groupIndex: 2, size: 2, rows: 2, cols: 1, span: 3 }
    ]);
});

console.log('\n=== E. 顺序 / 增删无关 ===');

test('后面追加分组，不改变前面各组的最优形状', () => {
    const a = planGroupSeatSlots([6, 4], 10, 10);
    const b = planGroupSeatSlots([6, 4, 3, 2], 10, 10);
    assertDeepEqual(a.blocks.slice(0, 2).map(x => [x.rows, x.cols]),
        b.blocks.slice(0, 2).map(x => [x.rows, x.cols]));
});

test('组人数顺序颠倒后，形状随人数走而不是随位置走', () => {
    const a = planGroupSeatSlots([6, 2], 10, 10);
    const b = planGroupSeatSlots([2, 6], 10, 10);
    assertEqual(a.blocks[0].rows + 'x' + a.blocks[0].cols, '3x2');
    assertEqual(b.blocks[0].rows + 'x' + b.blocks[0].cols, '2x1');
    assertEqual(b.blocks[1].rows + 'x' + b.blocks[1].cols, '3x2');
});

console.log('\n=== F. 未分组学生占座（blocked）===');

test('blocked 座位被跳过，所有人仍坐下且不被挪动', () => {
    const sizes = [6, 4, 2];
    const blocked = new Array(64).fill(false);
    [0, 1, 8, 9, 20].forEach(function (i) { blocked[i] = true; });
    const plan = planGroupSeatSlots(sizes, 8, 8, blocked);
    assertEqual(plan.ok, true);
    const all = assertNoOverlap(plan, sizes);
    assert(all.every(function (i) { return !blocked[i]; }), '不得占用 blocked 座位');
    assertEqual(all.length, 12);
});

test('一整列被占时仍能找到紧凑块（放宽块高度吸收空洞）', () => {
    const sizes = [6, 4, 2];
    const blocked = new Array(64).fill(false);
    for (let r = 0; r < 8; r++) blocked[r * 8] = true;
    const plan = planGroupSeatSlots(sizes, 8, 8, blocked);
    assertEqual(plan.ok, true);
    const all = assertNoOverlap(plan, sizes);
    assert(all.every(function (i) { return !blocked[i]; }));
});

console.log('\n=== G. 失败路径 / 边界 ===');

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

test('含 0 人的组：槽位为空、不产生块、不影响其他组', () => {
    const plan = planGroupSeatSlots([4, 0, 4], 8, 8);
    assertEqual(plan.ok, true);
    assertDeepEqual(plan.slots[1], []);
    assertEqual(plan.slots[0].length, 4);
    assertEqual(plan.slots[2].length, 4);
    assertEqual(plan.blocks.length, 2);
    assertEqual(plan.layout.groupCount, 2);
});

console.log('\n=== H. 小教室 / 退化布局 ===');

test('3×3 放 4 组各 2 人：全部紧凑、不丢人（旧算法会退化成顺序连续排）', () => {
    const sizes = [2, 2, 2, 2];
    const plan = planGroupSeatSlots(sizes, 3, 3);
    assertEqual(plan.ok, true);
    assertEqual(plan.layout.kind, 'compact');
    assertEqual(assertNoOverlap(plan, sizes).length, 8);
    plan.slots.forEach(function (list) {
        const info = checkCompact(list, 3);
        assertEqual(info.span, 3, '2 人的最优行列和应为 3');
        assertEqual(info.area, 2);
    });
});

test('极窄教室也不丢人（1 行多列）', () => {
    const sizes = [3, 2];
    const plan = planGroupSeatSlots(sizes, 1, 8);
    assertEqual(plan.ok, true);
    assertEqual(assertNoOverlap(plan, sizes).length, 5);
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
