// =====================================================================
// modules/group-layout.js
//
// 「按组聚座」的座位块规划（纯几何，无 DOM / 无全局状态，可 Node ESM 单测）。
//
// 目标：分组之后，让同一个组的学生在座位表上**连成一片**，
//       而不是散落各处 —— 老师讲课时可以整组走动、整组讨论。
//
// 做法：
//   1. 为每组挑一个统一的矩形「座位块」bh 行 × bw 列。
//      候选块必须能装下最大的组（bh·bw >= maxSize），并且按
//      「每行能放 floor(cols/bw) 个块」铺开时，总行数放得下整张座位表。
//      在可行候选里按代价函数取最优：
//         代价 = 4·(块内空位)          // 越贴合组人数越好
//              + 形状惩罚               // 组实际占用的行数/列数之差，
//                                       // 超过 2 的部分重罚（题面要求）
//              + 0.5·占用总行数         // 越紧凑越好（别把座位摊到 10 排）
//              + 0.4·右侧剩余列数       // 贴着左边、少留空列
//      代价相近时优先「更宽」的块 —— 教室通常是横向的，
//      6 人 6 组会稳定得到 2 行 × 3 列（另一解 3 行 × 2 列同样合法）。
//   2. 把块按「从左到右、从上到下」的顺序分配给各分组，
//      块内按**逐行**（row-major）填座，学生的先后由调用方按排名给定。
//   3. 若块内有座位已被「不参与本次重排」的学生占住，跳过该座，
//      本组多出来的学生在最后按全表顺序补位（保证不丢人）。
//   4. 只有在真的找不到可行块时（例如组数远多于座位），才退化为
//      「顺序连续排」：每组占一段连续座位，仍然是聚在一起的。
//
// 座位索引约定：row-major，index = row * cols + col（与主文件一致）。
// =====================================================================

function toPositiveInt(value) {
    const num = Math.floor(Number(value));
    return Number.isFinite(num) && num > 0 ? num : 0;
}

/**
 * 为组大小挑选统一的座位块尺寸。
 * @param {number[]} sizes      各组人数（>0 的才参与）
 * @param {number} rows
 * @param {number} cols
 * @returns {{bh:number,bw:number,perBand:number,bands:number,needRows:number}|null}
 */
export function chooseBlockShape(sizes, rows, cols) {
    const R = toPositiveInt(rows);
    const C = toPositiveInt(cols);
    const list = (Array.isArray(sizes) ? sizes : [])
        .map(function (v) { return Math.max(0, Math.floor(Number(v) || 0)); })
        .filter(function (v) { return v > 0; });
    if (!R || !C || list.length === 0) return null;

    const maxSize = Math.max.apply(null, list);
    const groupCount = list.length;
    let best = null;

    for (let bh = 1; bh <= R; bh++) {
        for (let bw = 1; bw <= C; bw++) {
            if (bh * bw < maxSize) continue;
            const perBand = Math.floor(C / bw);
            if (perBand < 1) continue;
            const bands = Math.ceil(groupCount / perBand);
            const needRows = bands * bh;
            if (needRows > R) continue;

            // 组「实际占用」的行列数（按逐行填），用来判断形状是否规整
            const rowsUsed = Math.min(bh, Math.ceil(maxSize / bw));
            const colsUsed = Math.min(bw, maxSize);
            const aspect = Math.abs(rowsUsed - colsUsed);
            const shapePenalty = aspect > 2 ? (aspect - 2) * 40 + aspect : aspect;
            const waste = bh * bw - maxSize;

            const cost = waste * 4
                + shapePenalty
                + needRows * 0.5
                + (C - perBand * bw) * 0.4;

            const candidate = {
                bh: bh, bw: bw, perBand: perBand, bands: bands,
                needRows: needRows, cost: cost
            };
            // 代价相近（<=0.5）时优先更宽的块：教室是横向的
            if (!best
                || cost < best.cost - 0.5
                || (Math.abs(cost - best.cost) <= 0.5 && bw > best.bw)) {
                best = candidate;
            }
        }
    }
    if (!best) return null;
    return { bh: best.bh, bw: best.bw, perBand: best.perBand, bands: best.bands, needRows: best.needRows };
}

/**
 * 规划各分组的座位槽位。
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
 *   layout: {kind:'block'|'sequential', bh?:number, bw?:number, perBand?:number, bands?:number}
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
    const shape = chooseBlockShape(groups, R, C);
    const activeIndices = [];
    groups.forEach(function (n, i) { if (n > 0) activeIndices.push(i); });

    if (shape) {
        // ── 块式布局 ──
        let ordinal = 0;
        for (let a = 0; a < activeIndices.length; a++) {
            const gi = activeIndices[a];
            const band = Math.floor(ordinal / shape.perBand);
            const colSlot = ordinal % shape.perBand;
            const r0 = band * shape.bh;
            const c0 = colSlot * shape.bw;
            blocks.push({ groupIndex: gi, r0: r0, c0: c0, rows: shape.bh, cols: shape.bw });

            for (let r = 0; r < shape.bh && slots[gi].length < groups[gi]; r++) {
                for (let c = 0; c < shape.bw && slots[gi].length < groups[gi]; c++) {
                    const rr = r0 + r;
                    const cc = c0 + c;
                    if (rr >= R || cc >= C) continue;
                    const idx = rr * C + cc;
                    if (isBlocked(idx) || used[idx]) continue;
                    used[idx] = true;
                    slots[gi].push(idx);
                }
            }
            ordinal++;
        }
        // 块内被占 / 块太小装不下的补位：全表顺序补
        for (let a = 0; a < activeIndices.length; a++) {
            const gi = activeIndices[a];
            for (let i = 0; i < totalSeats && slots[gi].length < groups[gi]; i++) {
                if (isBlocked(i) || used[i]) continue;
                used[i] = true;
                slots[gi].push(i);
            }
        }
        return {
            ok: true,
            slots: slots,
            blocks: blocks,
            layout: {
                kind: 'block',
                bh: shape.bh, bw: shape.bw,
                perBand: shape.perBand, bands: shape.bands,
                needRows: shape.needRows
            }
        };
    }

    // ── 兜底：顺序连续排（仍是「一组一段连续座位」） ──
    let cursor = 0;
    for (let gi = 0; gi < groups.length; gi++) {
        while (slots[gi].length < groups[gi] && cursor < totalSeats) {
            if (!isBlocked(cursor) && !used[cursor]) {
                used[cursor] = true;
                slots[gi].push(cursor);
            }
            cursor++;
        }
    }
    return {
        ok: true,
        slots: slots,
        blocks: [],
        layout: { kind: 'sequential' }
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
