// =====================================================================
// tests/unit_pair_links.mjs
//
// Node ESM 单元测试 — modules/pair-links.js
//   A. pairKey / validateForcedPair —— 一人只能有一组强制同桌
//   B. sanitizeForcedPairs / sanitizePairs —— 老配置与手改 JSON 兜底
//   C. buildLaneMap —— 空隙带推导（含单列、单行、走道）
//   D. planPairLinks —— 强制连线全画、回避只在已同桌时画
//   E. 核心不变量：所有路径都不进入任何座位矩形、不出教室边界
//   F. 与 random-arrange 的同桌映射交叉验证（避免两处定义漂移）
//
// 运行: node static/tests/unit_pair_links.mjs
// =====================================================================

// state.js 顶层读 location.search；Node 下必须先打桩（与 unit_random_arrange 同款）
globalThis.location = { search: 'dev=quiet' };
globalThis.confirm = () => true;
globalThis.alert = () => {};

const {
    pairKey, validateForcedPair, sanitizeForcedPairs, sanitizePairs,
    buildLaneMap, planPairLinks
} = await import('../modules/pair-links.js');
const { createRandomArrange } = await import('../modules/random-arrange.js');
const { state } = await import('../modules/state.js');

let passed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failures.push({ name, error: e }); console.log('  ✗ ' + name + ' — ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function assertEqual(a, b, msg) {
    if (a !== b) throw new Error((msg || '值不相等') + `（期望 ${b}，实际 ${a}）`);
}
function assertDeepEqual(a, b, msg) {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) throw new Error((msg || '结构不相等') + `\n  期望 ${y}\n  实际 ${x}`);
}

// ─── 固定几何：4 行 × 6 列，座位 100×60，gap 10，padding 24 ───
const ROWS = 4, COLS = 6, SW = 100, SH = 60, GAP = 10, PAD = 24;
const WIDTH = PAD * 2 + COLS * SW + (COLS - 1) * GAP;      // 698
const HEIGHT = PAD * 2 + ROWS * SH + (ROWS - 1) * GAP;     // 318
const RECTS = [];
for (let i = 0; i < ROWS * COLS; i++) {
    const r = Math.floor(i / COLS), c = i % COLS;
    RECTS.push({
        left: PAD + c * (SW + GAP),
        top: PAD + r * (SH + GAP),
        width: SW,
        height: SH
    });
}
function deskmateMap(aisles) {
    const m = new Array(ROWS * COLS).fill(null);
    const set = new Set((aisles || []).map(a => a.afterCol));
    for (let r = 0; r < ROWS; r++) {
        let c = 0;
        while (c < COLS) {
            const idx = r * COLS + c;
            if (c + 1 < COLS && !set.has(c + 1)) {
                m[idx] = idx + 1; m[idx + 1] = idx; c += 2;
            } else { c += 1; }
        }
    }
    return m;
}
const DM = deskmateMap([]);
function seatsOf(pairsOfIdx, n) {
    const seats = new Array(n || ROWS * COLS).fill(null);
    Object.keys(pairsOfIdx || {}).forEach(id => { seats[Number(id)] = pairsOfIdx[id]; });
    return seats;
}
function insideAnyRect(x, y) {
    const eps = 0.25;
    return RECTS.some(r =>
        x > r.left + eps && x < r.left + r.width - eps &&
        y > r.top + eps && y < r.top + r.height - eps);
}
function samplePath(points) {
    for (let s = 0; s < points.length - 1; s++) {
        const [x1, y1] = points[s], [x2, y2] = points[s + 1];
        for (let k = 0; k <= 60; k++) {
            const t = k / 60;
            const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
            if (insideAnyRect(x, y)) {
                throw new Error(`线段 ${s} 在 (${x.toFixed(1)},${y.toFixed(1)}) 穿过座位内部`);
            }
            if (x < -1 || y < -1 || x > WIDTH + 1 || y > HEIGHT + 1) {
                throw new Error(`路径点 (${x.toFixed(1)},${y.toFixed(1)}) 越出教室`);
            }
        }
    }
}

console.log('\n=== A. 强制同桌唯一性校验 ===');

test('A1 pairKey 无序', () => {
    assertEqual(pairKey('a', 'b'), pairKey('b', 'a'));
    assert(pairKey('a', 'b') !== pairKey('a', 'c'));
});
test('A2 空列表可添加', () => {
    const r = validateForcedPair([], 's1', 's2');
    assert(r.ok); assertEqual(r.reason, '');
});
test('A3 自己不能和自己同桌', () => {
    assertEqual(validateForcedPair([], 's1', 's1').reason, 'self');
    assertEqual(validateForcedPair([], '', 's1').reason, 'self');
});
test('A4 完全重复（含反序）判 duplicate', () => {
    assertEqual(validateForcedPair([['s1', 's2']], 's1', 's2').reason, 'duplicate');
    assertEqual(validateForcedPair([['s1', 's2']], 's2', 's1').reason, 'duplicate');
});
test('A5 A 已与别人强制同桌 ⇒ conflict 且给出原搭档', () => {
    const r = validateForcedPair([['s1', 's3']], 's1', 's2');
    assertEqual(r.reason, 'conflict');
    assertEqual(r.conflicts.length, 1);
    assertDeepEqual(r.conflicts[0], {
        ids: ['s1', 's3'], sharedId: 's1', partnerId: 's3', newPartnerId: 's2'
    });
});
test('A6 B 已与别人强制同桌 ⇒ conflict 且 sharedId 是 B', () => {
    const r = validateForcedPair([['s3', 's4']], 's1', 's4');
    assertEqual(r.reason, 'conflict');
    assertEqual(r.conflicts[0].sharedId, 's4');
    assertEqual(r.conflicts[0].partnerId, 's3');
    assertEqual(r.conflicts[0].newPartnerId, 's1');
});
test('A7 两端都撞 ⇒ 返回全部冲突', () => {
    const r = validateForcedPair([['s1', 's3'], ['s2', 's4']], 's1', 's2');
    assertEqual(r.conflicts.length, 2);
});
test('A8 不相关配对可共存（一人一个搭档）', () => {
    assert(validateForcedPair([['s1', 's2']], 's3', 's4').ok);
});

console.log('\n=== B. 清洗兜底 ===');

test('B1 清洗非法/自环/重复/互撞', () => {
    const out = sanitizeForcedPairs([
        ['s1', 's2'],
        ['s2', 's1'],          // 重复
        ['s1', 's3'],          // s1 撞车
        ['s4', 's1'],          // s1 撞车
        ['s3', 's4'],          // 合法
        ['s5', 's5'],          // 自环
        ['s6'],                // 残缺
        null,
        [1, 2]                 // 非字符串
    ]);
    assertDeepEqual(out, [['s1', 's2'], ['s3', 's4']]);
});
test('B2 幂等', () => {
    const once = sanitizeForcedPairs([['s1', 's2'], ['s3', 's4']]);
    assertDeepEqual(sanitizeForcedPairs(once), once);
});
test('B3 回避配对允许一人对应多人，但仍去重', () => {
    const out = sanitizePairs([['s1', 's2'], ['s2', 's1'], ['s1', 's3'], ['s1']]);
    assertDeepEqual(out, [['s1', 's2'], ['s1', 's3']]);
});
test('B4 空/非数组输入不抛错', () => {
    assertDeepEqual(sanitizeForcedPairs(null), []);
    assertDeepEqual(sanitizePairs(undefined), []);
});

console.log('\n=== C. 空隙带 ===');

test('C1 4×6 常规网格：横向 5 条、纵向 7 条走廊', () => {
    const l = buildLaneMap(RECTS, WIDTH, HEIGHT);
    // 行间 3 条 + 上下 padding 2 条
    assertEqual(l.hLanes.length, 5);
    // 列间 5 条 + 左右 padding 2 条
    assertEqual(l.vLanes.length, 7);
    assertEqual(l.gapBand, 10);
    for (let i = 1; i < l.hLanes.length; i++) assert(l.hLanes[i] > l.hLanes[i - 1]);
    for (let i = 1; i < l.vLanes.length; i++) assert(l.vLanes[i] > l.vLanes[i - 1]);
});
test('C2 每条横向走廊都不落在座位矩形内', () => {
    const l = buildLaneMap(RECTS, WIDTH, HEIGHT);
    l.hLanes.forEach(y => RECTS.forEach(r => {
        assert(!(y > r.top && y < r.top + r.height), `走廊 y=${y} 落在座位内`);
    }));
});
test('C3 每条纵向走廊都不落在座位矩形内', () => {
    const l = buildLaneMap(RECTS, WIDTH, HEIGHT);
    l.vLanes.forEach(x => RECTS.forEach(r => {
        assert(!(x > r.left && x < r.left + r.width), `走廊 x=${x} 落在座位内`);
    }));
});
test('C4 单列座位也有左右外圈走廊可用', () => {
    const one = RECTS.filter((_, i) => i % COLS === 0);
    const l = buildLaneMap(one, WIDTH, HEIGHT);
    assert(l.vLanes.length >= 2);
});
test('C5 空矩形不抛错', () => {
    const l = buildLaneMap([], WIDTH, HEIGHT);
    assertDeepEqual(l.hLanes, []);
    assertDeepEqual(l.vLanes, []);
});

console.log('\n=== D. 连线规划 ===');

test('D1 强制配对两人都入座 ⇒ 画 1 条 forced', () => {
    const seats = seatsOf({ 0: 'a', 17: 'b' });
    const r = planPairLinks({ forced: [['a', 'b']], avoid: [], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    assertEqual(r.forcedCount, 1);
    assertEqual(r.links.length, 1);
    assertEqual(r.links[0].kind, 'forced');
    assertDeepEqual(r.links[0].ids, ['a', 'b']);
    assertEqual(r.links[0].fromIdx, 0);
    assertEqual(r.links[0].toIdx, 17);
});
test('D2 有人未入座 ⇒ 不画', () => {
    const seats = seatsOf({ 0: 'a' });
    const r = planPairLinks({ forced: [['a', 'b']], avoid: [], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    assertEqual(r.links.length, 0);
    assertEqual(r.forcedCount, 0);
});
test('D3 回避配对已分开 ⇒ 不画（核心语义）', () => {
    const seats = seatsOf({ 0: 'a', 17: 'b' });
    const r = planPairLinks({ forced: [], avoid: [['a', 'b']], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    assertEqual(r.links.length, 0);
    assertEqual(r.avoidCount, 0);
});
test('D4 回避配对被安排成同桌 ⇒ 画 1 条 avoid + 互斥标记', () => {
    const seats = seatsOf({ 0: 'a', 1: 'b' });
    const r = planPairLinks({ forced: [], avoid: [['a', 'b']], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    assertEqual(r.avoidCount, 1);
    assertEqual(r.links.length, 1);
    assertEqual(r.links[0].kind, 'avoid');
    assert(r.links[0].cross && typeof r.links[0].cross.x === 'number');
});
test('D5 混合：2 强制 + 1 冲突回避 ⇒ 3 条线、两类都有', () => {
    const seats = seatsOf({ 0: 'a', 11: 'b', 12: 'c', 23: 'd', 6: 'e', 7: 'f' });
    const r = planPairLinks({
        forced: [['a', 'b'], ['c', 'd']],
        avoid: [['e', 'f'], ['a', 'c']],
        seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT
    });
    assertEqual(r.forcedCount, 2);
    assertEqual(r.avoidCount, 1);       // ['a','c'] 不是同桌 ⇒ 静默
    assertEqual(r.links.length, 3);
    assertEqual(r.links.filter(l => l.kind === 'forced').length, 2);
    assertEqual(r.links.filter(l => l.kind === 'avoid').length, 1);
});
test('D6 同桌映射随走道变化：走道隔开就不算同桌', () => {
    const dmAisle = deskmateMap([{ afterCol: 1 }]);
    const seats = seatsOf({ 0: 'a', 1: 'b' });
    const r = planPairLinks({ forced: [], avoid: [['a', 'b']], seats, deskmateMap: dmAisle, rects: RECTS, width: WIDTH, height: HEIGHT });
    assertEqual(r.links.length, 0);
});
test('D7 路径是合法 SVG（M + 至少 1 个 L，全为数字）', () => {
    const seats = seatsOf({ 0: 'a', 23: 'b', 6: 'e', 7: 'f' });
    const r = planPairLinks({ forced: [['a', 'b']], avoid: [['e', 'f']], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    r.links.forEach(l => {
        assert(/^M-?\d+(\.\d+)?,-?\d+(\.\d+)?( L-?\d+(\.\d+)?,-?\d+(\.\d+)?)+$/.test(l.d), `非法路径 ${l.d}`);
        assert(l.points.length >= 2);
    });
});

console.log('\n=== E. 不覆盖其他座位（核心不变量）===');

test('E1 跨行跨列长连线不穿过任何座位', () => {
    const seats = seatsOf({ 0: 'a', 23: 'b' });
    const r = planPairLinks({ forced: [['a', 'b']], avoid: [], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    assertEqual(r.links.length, 1);
    samplePath(r.links[0].points);
});
test('E2 同一行、中间隔着 4 个座位的连线不穿过它们', () => {
    const seats = seatsOf({ 0: 'a', 5: 'b' });
    const r = planPairLinks({ forced: [['a', 'b']], avoid: [], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    samplePath(r.links[0].points);
});
test('E3 同一列、隔着 2 个座位的连线绕纵向走廊走', () => {
    const seats = seatsOf({ 2: 'a', 20: 'b' });   // 第 0 行第 2 列 → 第 3 行第 2 列
    const r = planPairLinks({ forced: [['a', 'b']], avoid: [], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    samplePath(r.links[0].points);
});
test('E4 批量 12 组配对的每条线都不穿过座位', () => {
    const seats = new Array(ROWS * COLS).fill(null);
    const forced = [];
    for (let i = 0; i < 12; i++) {
        const a = i, b = ROWS * COLS - 1 - i;
        seats[a] = 'a' + i; seats[b] = 'b' + i;
        forced.push(['a' + i, 'b' + i]);
    }
    const r = planPairLinks({ forced, avoid: [], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    assertEqual(r.links.length, 12);
    r.links.forEach((l, i) => {
        try { samplePath(l.points); }
        catch (e) { throw new Error(`第 ${i} 条: ${e.message}`); }
    });
});
test('E5 回避冲突连线（相邻同桌）也不压住座位', () => {
    const seats = seatsOf({ 0: 'a', 1: 'b' });
    const r = planPairLinks({ forced: [], avoid: [['a', 'b']], seats, deskmateMap: DM, rects: RECTS, width: WIDTH, height: HEIGHT });
    samplePath(r.links[0].points);
    assert(!insideAnyRect(r.links[0].cross.x, r.links[0].cross.y), '互斥标记压在座位上');
});
test('E6 1 行 1 列等极端布局不抛错', () => {
    const one = [{ left: 24, top: 24, width: 100, height: 60 }];
    const r = planPairLinks({
        forced: [['a', 'b']], avoid: [], seats: ['a'], deskmateMap: [null],
        rects: one, width: 148, height: 108
    });
    assertEqual(r.links.length, 0);
});

console.log('\n=== F. 与排座引擎同桌定义交叉验证 ===');

test('F1 无走道：pair-links 用的同桌表与 random-arrange.getDeskMatePairs 一致', () => {
    const original = { rows: state.rows, cols: state.cols, aisles: state.aisles, seats: state.seats };
    state.rows = ROWS; state.cols = COLS; state.aisles = []; state.seats = new Array(ROWS * COLS).fill(null);
    try {
        const dummy = createRandomArrange({ helpers: { shuffle: a => a }, callbacks: {} });
        assertDeepEqual(dummy.getDeskMatePairs().pairMap, DM);
    } finally {
        Object.assign(state, original);
    }
});
test('F2 有走道（第 1、4 列后）：两边同桌表仍一致', () => {
    const aisles = [{ afterCol: 1, width: 30 }, { afterCol: 4, width: 30 }];
    const original = { rows: state.rows, cols: state.cols, aisles: state.aisles, seats: state.seats };
    state.rows = ROWS; state.cols = COLS; state.aisles = aisles; state.seats = new Array(ROWS * COLS).fill(null);
    try {
        const dummy = createRandomArrange({ helpers: { shuffle: a => a }, callbacks: {} });
        assertDeepEqual(deskmateMap(aisles), dummy.getDeskMatePairs().pairMap);
    } finally {
        Object.assign(state, original);
    }
});

console.log(`\n${passed} 项通过，${failures.length} 项失败`);
if (failures.length) {
    failures.forEach(f => console.error(`  ✗ ${f.name}: ${f.error.stack || f.error.message}`));
    process.exit(1);
}
