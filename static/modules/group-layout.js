// =====================================================================
// modules/group-layout.js
//
// 「按组聚座」的座位块规划（纯几何，无 DOM / 无全局状态，可 Node ESM 单测）。
//
// 目标：分组之后，让**每一组**按自己的实际人数收拢成最紧凑的一片座位，
//       而不是按「最大组人数」给所有组套同一个矩形块。
//
// 「最紧凑」的判定（v1.4.8 起）：
//   1. 主目标 = 该组所有座位占据的「总行数 + 总列数」最小（题面要求）；
//   2. 同分时优先空位最少（外接矩形面积最小）；
//   3. 仍同分时优先「更窄 / 更多行」—— 6 人稳定得到 3 行 × 2 列，
//      与题面给出的 (1,1)(1,2)(2,1)(2,2)(3,1)(3,2) 一致。
//
// 做法：
//   1. 逐组（按调用方给的顺序）在全表枚举候选矩形 (r0,c0,bh,bw)：
//      bw ∈ 1..min(cols,n)，bh 从 ceil(n/bw) 起、最多再放宽 2 行
//      （给「块内有未分组学生占座」留余量），矩形必须完整落在座位表内。
//   2. 矩形内按 row-major 取前 n 个**可用**座位（跳过 blocked / 已分配），
//      用这 n 个座位真实的外接矩形算紧凑代价：
//          score = 1000·(rows+cols) + 10·area + holes + 极小·位置序号
//      位置项只用外接矩形左上角打破平局 ⇒ 整体仍「从左到右、从上到下」铺开。
//   3. 取代价最小的落点。若所有矩形都装不下 n 个可用座位（未分组学生占得太散），
//      允许「块内 + 就近补位」：补位按到块中心的距离挑，保证不丢人，
//      layout.kind 标为 sequential 表示退化。
//   4. 未参与重排的学生（blocked）原地不动；容量不足直接 ok=false。
//
// 座位索引约定：row-major，index = row * cols + col（与主文件一致）。
// =====================================================================

function toPositiveInt(value) {
    const num = Math.floor(Number(value));
    return Number.isFinite(num) && num > 0 ? num : 0;
}

/** 一组座位下标的外接矩形（含空洞数）。 */
function boundingBox(cells, cols) {
    if (!cells.length) {
        return { r0: 0, c0: 0, rows: 0, cols: 0, area: 0, holes: 0 };
    }
    let rMin = Infinity, rMax = -Infinity, cMin = Infinity, cMax = -Infinity;
    for (let k = 0; k < cells.length; k++) {
        const r = Math.floor(cells[k] / cols);
        const c = cells[k] % cols;
        if (r < rMin) rMin = r;
        if (r > rMax) rMax = r;
        if (c < cMin) cMin = c;
        if (c > cMax) cMax = c;
    }
    const rows = rMax - rMin + 1;
    const colCount = cMax - cMin + 1;
    const area = rows * colCount;
    return {
        r0: rMin, c0: cMin,
        rows: rows, cols: colCount,
        area: area, holes: area - cells.length
    };
}

/**
 * n 人在空教室里能达到的最紧凑矩形（供 UI 摘要 / 单测使用）。
 * 代价与 planGroupSeatSlots 的落点评分同源：
 *   1000·(行数+列数) + 10·外接面积 + 空位数。
 * 遍历 bw 从小到大 + 严格小于 ⇒ 同代价自动保留「更窄（行数更多）」的那个。
 * @param {number} size
 * @param {number} rows
 * @param {number} cols
 * @returns {{bh:number,bw:number,span:number,area:number}|null}
 */
export function chooseCompactShape(size, rows, cols) {
    const n = Math.floor(Number(size) || 0);
    const R = toPositiveInt(rows);
    const C = toPositiveInt(cols);
    if (n <= 0 || !R || !C) return null;

    let best = null;
    for (let bw = 1; bw <= Math.min(C, n); bw++) {
        const bh = Math.ceil(n / bw);
        if (bh > R) continue;              // 更宽的 bw 会降 bh，继续往后找
        const span = bh + bw;
        const area = bh * bw;
        const cost = span * 1000 + area * 10 + (area - n);
        if (!best || cost < best.cost) best = { bh: bh, bw: bw, span: span, area: area, cost: cost };
    }
    return best ? { bh: best.bh, bw: best.bw, span: best.span, area: best.area } : null;
}

/**
 * 为 n 人找全局最紧凑的落点。
 * @returns {{score:number,cells:number[],spill:number,box:object|null,r0:number,c0:number,bh:number,bw:number}}
 */
function findBestPlacement(n, R, C, used, isBlocked, extraRows) {
    const maxBw = Math.min(C, n);
    let best = null;

    for (let bw = 1; bw <= maxBw; bw++) {
        const bhMin = Math.ceil(n / bw);
        const bhMax = Math.min(R, bhMin + extraRows);
        for (let bh = bhMin; bh <= bhMax; bh++) {
            for (let r0 = 0; r0 + bh <= R; r0++) {
                for (let c0 = 0; c0 + bw <= C; c0++) {
                    const cells = [];
                    for (let r = r0; r < r0 + bh && cells.length < n; r++) {
                        for (let c = c0; c < c0 + bw && cells.length < n; c++) {
                            const idx = r * C + c;
                            if (isBlocked(idx) || used[idx]) continue;
                            cells.push(idx);
                        }
                    }
                    const spill = n - cells.length;
                    let box = null;
                    let score;
                    if (spill === 0) {
                        box = boundingBox(cells, C);
                        score = (box.rows + box.cols) * 1000
                            + box.area * 10
                            + box.holes
                            + (box.r0 * C + box.c0) * 0.001;
                    } else {
                        // 退化候选：任何装得满的落点都优先于装不满的
                        score = 1e9 + spill * 1e6
                            + (bh + bw) * 1000
                            + (r0 * C + c0) * 0.001;
                    }
                    if (!best || score < best.score) {
                        best = {
                            score: score, cells: cells, spill: spill, box: box,
                            r0: r0, c0: c0, bh: bh, bw: bw
                        };
                    }
                }
            }
        }
    }
    return best || {
        score: Infinity, cells: [], spill: n, box: null,
        r0: 0, c0: 0, bh: 0, bw: 0
    };
}

/** 块内坐不下时，按到块中心的距离就近补位（保证不丢人、尽量仍聚在一起）。 */
function appendNearbyCells(cells, n, choice, R, C, used, isBlocked) {
    const taken = new Set(cells);
    const centerR = choice.r0 + (choice.bh - 1) / 2;
    const centerC = choice.c0 + (choice.bw - 1) / 2;
    const pool = [];
    for (let i = 0; i < R * C; i++) {
        if (isBlocked(i) || used[i] || taken.has(i)) continue;
        const dr = Math.floor(i / C) - centerR;
        const dc = (i % C) - centerC;
        pool.push({ idx: i, dist: dr * dr + dc * dc });
    }
    pool.sort(function (a, b) { return a.dist - b.dist || a.idx - b.idx; });
    for (let k = 0; k < pool.length && cells.length < n; k++) cells.push(pool[k].idx);
}

/**
 * 规划各分组的座位槽位（每组按自身人数取最紧凑矩形）。
 *
 * @param {number[]} sizes   各组人数（与调用方的分组顺序一一对应，可含 0）
 * @param {number} rows      座位行数
 * @param {number} cols      座位列数
 * @param {boolean[]} [blocked] 长度 rows*cols，true 表示该座位已被占住（不参与分配）
 * @returns {{
 *   ok: boolean,
 *   reason?: 'geometry'|'capacity',
 *   need?: number, free?: number,
 *   slots: number[][],          // 与 sizes 等长；slots[i] = 第 i 组按顺序应坐的座位下标
 *   blocks: Array<{groupIndex:number, r0:number, c0:number, rows:number, cols:number}>,
 *   layout: {kind:'compact'|'sequential',
 *            shapes: Array<{groupIndex:number,size:number,rows:number,cols:number,span:number}>,
 *            groupCount:number}
 * }}
 */
export function planGroupSeatSlots(sizes, rows, cols, blocked) {
    const R = toPositiveInt(rows);
    const C = toPositiveInt(cols);
    const groups = (Array.isArray(sizes) ? sizes : []).map(function (v) {
        const n = Math.floor(Number(v) || 0);
        return n > 0 ? n : 0;
    });
    const emptyResult = { ok: false, slots: [], blocks: [], layout: null };

    if (!R || !C || groups.length === 0) {
        return Object.assign({}, emptyResult, { reason: 'geometry' });
    }

    const totalSeats = R * C;
    const isBlocked = function (i) {
        return !!(blocked && blocked[i]);
    };

    let free = 0;
    for (let i = 0; i < totalSeats; i++) {
        if (!isBlocked(i)) free++;
    }
    const need = groups.reduce(function (a, b) { return a + b; }, 0);
    if (need > free) {
        return Object.assign({}, emptyResult, { reason: 'capacity', need: need, free: free });
    }

    const used = new Array(totalSeats).fill(false);
    const slots = groups.map(function () { return []; });
    const blocks = [];
    const shapes = [];
    let degraded = false;

    const activeIndices = [];
    groups.forEach(function (n, i) { if (n > 0) activeIndices.push(i); });

    // 座位表很大时少放宽一行，控制枚举量（按钮点击仍应在毫秒级完成）
    const extraRows = totalSeats > 200 ? 1 : 2;

    for (let a = 0; a < activeIndices.length; a++) {
        const gi = activeIndices[a];
        const n = groups[gi];
        const choice = findBestPlacement(n, R, C, used, isBlocked, extraRows);
        const cells = choice.cells.slice();

        if (cells.length < n) {
            degraded = true;
            appendNearbyCells(cells, n, choice, R, C, used, isBlocked);
        }
        // 兜底：容量检查已保证够用，这里只防御极端情况，绝不丢人
        if (cells.length < n) {
            const taken = new Set(cells);
            for (let i = 0; i < totalSeats && cells.length < n; i++) {
                if (isBlocked(i) || used[i] || taken.has(i)) continue;
                cells.push(i);
            }
        }

        cells.forEach(function (idx) { used[idx] = true; });
        slots[gi] = cells;
        const box = boundingBox(cells, C);
        blocks.push({
            groupIndex: gi, r0: box.r0, c0: box.c0,
            rows: box.rows, cols: box.cols
        });
        shapes.push({
            groupIndex: gi, size: n,
            rows: box.rows, cols: box.cols,
            span: box.rows + box.cols
        });
    }

    return {
        ok: true,
        slots: slots,
        blocks: blocks,
        layout: {
            kind: degraded ? 'sequential' : 'compact',
            shapes: shapes,
            groupCount: activeIndices.length
        }
    };
}

/**
 * 便捷工具：把座位下标数组转成 {row, col}（1 基，便于测试/调试断言）。
 * @param {number} index
 * @param {number} cols
 */
export function seatIndexOf(index, cols) {
    const C = toPositiveInt(cols);
    if (!C) return { row: 0, col: 0 };
    return { row: Math.floor(index / C) + 1, col: (index % C) + 1 };
}
