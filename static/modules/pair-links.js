// modules/pair-links.js
// ─────────────────────────────────────────────────────────────────────────────
// 配对约束校验 + 座位区「关联指示箭头」几何规划（纯函数，零 DOM 依赖）。
//
// 两块职责：
//   1. validateForcedPair / sanitizeForcedPairs / sanitizePairs
//      —— 「一位学生只能有一组强制同桌」的唯一性规则，供弹窗录入与配置迁移共用。
//   2. planPairLinks
//      —— 把「当前座位 + 配对设置 + 每个座位的矩形坐标」翻译成 SVG path 列表。
//
// 为什么连线要绕格子间的空隙走（而不是两点直连）：
//   用户要求「座位方格之间有联系指示，但连接线不能覆盖或影响之间的其他座位」。
//   因此每条连线只允许出现在：
//     · 行与行之间的横向空隙带（走廊）
//     · 列与列之间的纵向空隙带（含走道占位）
//     · 教室四周的 padding 带
//   路径一律「从 A 座位边缘出发 → 进入相邻横向走廊 →（必要时经纵向走廊换层）
//   → 回到 B 座位边缘」，全程不进入任何座位矩形内部；图层本身再设
//   pointer-events:none 且置于座位下方，双重保证不影响拖拽/点击。
//
//   同桌（deskmateMap 互指）的连线额外固定方位：全班统一走座位同一侧的最近
//   一条横向走廊，且不加序号抖动（见 decideDeskmateSide）；非同桌连线仍按
//   序号交错上下，避免多条跨行/跨列长线叠在同一条走廊上。
//
// 坐标约定：rects[i] = { left, top, width, height }，坐标系原点为 .classroom
// 的 padding box 左上角（与 absolute inset:0 的 SVG 完全一致）。
// ─────────────────────────────────────────────────────────────────────────────

/** 无序配对键，用于去重（[a,b] 与 [b,a] 视为同一对）。 */
export function pairKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
}

/**
 * 校验一条「强制同桌」能否加入现有列表。
 * 规则：一个人最多出现在一组强制同桌里（回避同桌不受此限制）。
 *
 * @param {Array<[string,string]>} existing 现有强制配对
 * @param {string} idA
 * @param {string} idB
 * @returns {{ok:boolean, reason:'self'|'duplicate'|'conflict'|'', conflicts:Array}}
 *   conflicts 元素 = { ids, sharedId, partnerId, newPartnerId }
 */
export function validateForcedPair(existing, idA, idB) {
    const list = Array.isArray(existing) ? existing : [];
    if (!idA || !idB || idA === idB) {
        return { ok: false, reason: 'self', conflicts: [] };
    }
    const key = pairKey(idA, idB);
    if (list.some(p => Array.isArray(p) && p.length >= 2 && pairKey(p[0], p[1]) === key)) {
        return { ok: false, reason: 'duplicate', conflicts: [] };
    }
    const conflicts = [];
    list.forEach(p => {
        if (!Array.isArray(p) || p.length < 2) return;
        let sharedId = null;
        let partnerId = null;
        let newPartnerId = null;
        if (p[0] === idA || p[1] === idA) {
            sharedId = idA;
            partnerId = p[0] === idA ? p[1] : p[0];
            newPartnerId = idB;
        } else if (p[0] === idB || p[1] === idB) {
            sharedId = idB;
            partnerId = p[0] === idB ? p[1] : p[0];
            newPartnerId = idA;
        }
        if (sharedId) conflicts.push({ ids: [p[0], p[1]], sharedId, partnerId, newPartnerId });
    });
    if (conflicts.length) return { ok: false, reason: 'conflict', conflicts: conflicts };
    return { ok: true, reason: '', conflicts: [] };
}

/** 清掉非法/重复/互撞的强制配对（保留先出现者），用于老配置与手改 JSON 兜底。 */
export function sanitizeForcedPairs(pairs) {
    const out = [];
    (Array.isArray(pairs) ? pairs : []).forEach(p => {
        if (!Array.isArray(p) || p.length < 2) return;
        const a = p[0], b = p[1];
        if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return;
        if (validateForcedPair(out, a, b).ok) out.push([a, b]);
    });
    return out;
}

/** 回避配对只清非法 + 去重，允许多人回避同一个人。 */
export function sanitizePairs(pairs) {
    const out = [];
    const seen = new Set();
    (Array.isArray(pairs) ? pairs : []).forEach(p => {
        if (!Array.isArray(p) || p.length < 2) return;
        const a = p[0], b = p[1];
        if (typeof a !== 'string' || typeof b !== 'string' || !a || !b || a === b) return;
        const k = pairKey(a, b);
        if (seen.has(k)) return;
        seen.add(k);
        out.push([a, b]);
    });
    return out;
}

// ─────────── 几何工具 ───────────

function medianOf(arr) {
    if (!arr.length) return 8;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

function boxOf(r) {
    return {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        top: r.top,
        bottom: r.top + r.height,
        left: r.left,
        right: r.left + r.width
    };
}

function groupBy(values, keyOf) {
    const m = new Map();
    values.forEach(v => {
        const k = keyOf(v);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(v);
    });
    return m;
}

/**
 * 从座位矩形推导「可走线的空隙带」。
 * 返回 { hLanes, vLanes, gapBand }：
 *   hLanes —— 横向走廊的 y 值（升序），vLanes —— 纵向走廊的 x 值（升序）。
 */
export function buildLaneMap(rects, width, height) {
    const valid = (rects || []).filter(r => r && r.width > 0 && r.height > 0);
    if (!valid.length) return { hLanes: [], vLanes: [], gapBand: 8 };

    const rowGroups = [...groupBy(valid, r => Math.round(r.top)).entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, rs]) => ({
            top: Math.min(...rs.map(r => r.top)),
            bottom: Math.max(...rs.map(r => r.top + r.height))
        }));
    const colGroups = [...groupBy(valid, r => Math.round(r.left)).entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, rs]) => ({
            left: Math.min(...rs.map(r => r.left)),
            right: Math.max(...rs.map(r => r.left + r.width))
        }));

    const rowGaps = [];
    for (let i = 0; i < rowGroups.length - 1; i++) {
        rowGaps.push(rowGroups[i + 1].top - rowGroups[i].bottom);
    }
    const colGaps = [];
    for (let i = 0; i < colGroups.length - 1; i++) {
        colGaps.push(colGroups[i + 1].left - colGroups[i].right);
    }
    // 走道占位会把列间空隙撑得很宽（10 + 50 + 10），取中位数才代表普通网格 gap
    const gapBand = Math.max(2, Math.min(10, medianOf(rowGaps.concat(colGaps))));

    const hLanes = [];
    for (let i = 0; i < rowGroups.length - 1; i++) {
        hLanes.push((rowGroups[i].bottom + rowGroups[i + 1].top) / 2);
    }
    const firstTop = rowGroups[0].top;
    const lastBottom = rowGroups[rowGroups.length - 1].bottom;
    if (firstTop - gapBand / 2 > 2) hLanes.push(firstTop - gapBand / 2);
    if (lastBottom + gapBand / 2 < height - 2) hLanes.push(lastBottom + gapBand / 2);
    hLanes.sort((a, b) => a - b);

    const vLanes = [];
    for (let i = 0; i < colGroups.length - 1; i++) {
        vLanes.push((colGroups[i].right + colGroups[i + 1].left) / 2);
    }
    const minLeft = colGroups[0].left;
    const maxRight = colGroups[colGroups.length - 1].right;
    if (minLeft > 4) vLanes.push(minLeft / 2);
    if (maxRight < width - 4) vLanes.push((maxRight + width) / 2);
    vLanes.sort((a, b) => a - b);

    return { hLanes, vLanes, gapBand };
}

function laneBelow(lanes, y) {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] > y + 0.5) return lanes[i];
    return null;
}
function laneAbove(lanes, y) {
    for (let i = lanes.length - 1; i >= 0; i--) if (lanes[i] < y - 0.5) return lanes[i];
    return null;
}

/**
 * 「同桌连线」全班统一走座位上方还是下方，只根据几何算一次。
 *
 * 历史 bug：同一行的连线曾按 `index % 2` 交替上下走廊（本意是让多条跨列连线
 * 错开不重叠），但 index 是「配对数组里的序号」—— 增删一组配对、或导入配置里
 * 顺序不同，同一对同桌的线就会从上方翻到下方。用户看到的就是「有时在俩座位
 * 上方、有时在下方」。
 *
 * 因此侧别必须与配对顺序完全解耦：只要最顶行上方还有横向走廊（.classroom 有
 * 24px padding，正常都成立），全班同桌线一律走上方；否则整体改走下方。
 */
function decideDeskmateSide(hLanes, rects) {
    const valid = (rects || []).filter(r => r && r.width > 0 && r.height > 0);
    if (!valid.length) return 'above';
    const top = Math.min(...valid.map(r => r.top));
    const bottom = Math.max(...valid.map(r => r.top + r.height));
    if (laneAbove(hLanes, top) != null) return 'above';
    if (laneBelow(hLanes, bottom) != null) return 'below';
    return 'above';
}

function chooseVerticalLane(lanes, ax, bx, index, jitter) {
    if (!lanes.length) return (ax + bx) / 2;
    const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
    const between = lanes.filter(x => x > lo + 1 && x < hi - 1);
    const pool = (between.length ? between : lanes)
        .slice()
        .sort((p, q) => Math.abs(p - ax) - Math.abs(q - ax));
    const picked = pool[Math.min(index % Math.min(3, pool.length), pool.length - 1)];
    return picked + ((index % 3) - 1) * jitter;
}

function dedupe(points) {
    const out = [];
    points.forEach(p => {
        const last = out[out.length - 1];
        if (last && Math.abs(last[0] - p[0]) < 0.6 && Math.abs(last[1] - p[1]) < 0.6) return;
        out.push(p);
    });
    // 三点共线时去掉中间点，折线更干净
    const simplified = [];
    for (let i = 0; i < out.length; i++) {
        const prev = simplified[simplified.length - 1];
        const next = out[i + 1];
        if (prev && next) {
            const collinearX = Math.abs(prev[0] - out[i][0]) < 0.6 && Math.abs(out[i][0] - next[0]) < 0.6;
            const collinearY = Math.abs(prev[1] - out[i][1]) < 0.6 && Math.abs(out[i][1] - next[1]) < 0.6;
            if (collinearX || collinearY) continue;
        }
        simplified.push(out[i]);
    }
    return simplified;
}

function planOne(fromIdx, toIdx, kind, ids, index, ctx) {
    const A = ctx.rects[fromIdx], B = ctx.rects[toIdx];
    if (!A || !B) return null;
    const a = boxOf(A), b = boxOf(B);
    const jitter = Math.min(0.8, ctx.gapBand / 10);
    const off = ((index % 5) - 2) * jitter;
    const downward = b.cy > a.cy;
    const sameRow = Math.abs(a.cy - b.cy) < 2;
    // deskmateMap 来自排座引擎（走道隔开的不算同桌）。同桌的连线必须固定方位，
    // 且不加 index 抖动：同排所有同桌线因此等高、同侧、与配对录入顺序无关。
    const isDeskmate = !!(ctx.deskmateMap && ctx.deskmateMap[fromIdx] === toIdx);

    let yA, yB;
    if (isDeskmate) {
        const above = laneAbove(ctx.hLanes, a.top);
        const below = laneBelow(ctx.hLanes, a.bottom);
        const primary = ctx.deskmateSide === 'below' ? below : above;
        const secondary = ctx.deskmateSide === 'below' ? above : below;
        const chosen = primary != null ? primary
            : (secondary != null ? secondary : Math.max(0, a.top - 2));
        yA = yB = chosen;
    } else if (sameRow) {
        // 非同桌的同行连线仍按序号交错上下，避免多条跨列连线叠在同一条走廊上
        const above = laneAbove(ctx.hLanes, a.top);
        const below = laneBelow(ctx.hLanes, a.bottom);
        const useAbove = index % 2 === 0;
        const chosen = useAbove
            ? (above != null ? above : below)
            : (below != null ? below : above);
        yA = yB = (chosen != null ? chosen : a.top - 2) + off;
    } else {
        const rawA = downward ? laneBelow(ctx.hLanes, a.bottom) : laneAbove(ctx.hLanes, a.top);
        const rawB = downward ? laneAbove(ctx.hLanes, b.top) : laneBelow(ctx.hLanes, b.bottom);
        yA = (rawA != null ? rawA : (downward ? a.bottom + 2 : a.top - 2)) + off;
        yB = (rawB != null ? rawB : (downward ? b.top - 2 : b.bottom + 2)) + off;
    }

    const startY = yA < a.cy ? a.top - 1 : a.bottom + 1;
    const endY = yB < b.cy ? b.top - 1 : b.bottom + 1;
    const points = [[a.cx, startY], [a.cx, yA]];
    let crossX = null;
    if (Math.abs(yA - yB) > 0.6) {
        const xv = chooseVerticalLane(ctx.vLanes, a.cx, b.cx, index, jitter);
        points.push([xv, yA], [xv, yB]);
        crossX = xv;
    } else {
        crossX = (a.cx + b.cx) / 2;
    }
    points.push([b.cx, yB], [b.cx, endY]);

    const clean = dedupe(points);
    if (clean.length < 2) return null;
    const d = 'M' + clean.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
    return {
        kind: kind,
        ids: ids,
        fromIdx: fromIdx,
        toIdx: toIdx,
        d: d,
        points: clean,
        // 诊断/测试用：同桌连线固定侧别，断言「全班统一」时无需反推几何
        deskmate: isDeskmate,
        laneSide: isDeskmate ? (yA < a.cy ? 'above' : 'below') : '',
        // 互斥标记（回避同桌却已同桌）：放在水平走线段的中点，同样位于空隙带内
        cross: kind === 'avoid' ? { x: crossX, y: (yA + yB) / 2 } : null
    };
}

/**
 * 规划当前所有需要显示的配对连线。
 *
 * @param {object} o
 * @param {Array}  o.forced       强制同桌 [[idA,idB], ...]
 * @param {Array}  o.avoid        回避同桌 [[idA,idB], ...]
 * @param {Array}  o.seats        seats[seatIndex] = studentId|null
 * @param {Array}  o.deskmateMap  seatIndex → mateIndex（来自 randomArrange.getDeskMatePairs）
 * @param {Array}  o.rects        seatIndex → {left,top,width,height}
 * @param {number} o.width        .classroom clientWidth
 * @param {number} o.height       .classroom clientHeight
 * @returns {{links:Array, forcedCount:number, avoidCount:number}}
 */
export function planPairLinks(o) {
    const seats = Array.isArray(o.seats) ? o.seats : [];
    const rects = o.rects || [];
    const dm = o.deskmateMap || [];
    const seatOf = Object.create(null);
    for (let i = 0; i < seats.length; i++) {
        if (seats[i]) seatOf[seats[i]] = i;
    }
    const lanes = buildLaneMap(rects, o.width || 0, o.height || 0);
    const ctx = {
        rects: rects,
        gapBand: lanes.gapBand,
        hLanes: lanes.hLanes,
        vLanes: lanes.vLanes,
        deskmateMap: dm,
        // 全班只算一次，同桌线不再随配对数组顺序翻上翻下
        deskmateSide: decideDeskmateSide(lanes.hLanes, rects)
    };
    const links = [];
    let forcedCount = 0;
    let avoidCount = 0;

    (Array.isArray(o.forced) ? o.forced : []).forEach(p => {
        if (!Array.isArray(p) || p.length < 2) return;
        const a = seatOf[p[0]], b = seatOf[p[1]];
        if (a === undefined || b === undefined || a === b) return;
        const link = planOne(a, b, 'forced', [p[0], p[1]], links.length, ctx);
        if (link) { links.push(link); forcedCount++; }
    });

    (Array.isArray(o.avoid) ? o.avoid : []).forEach(p => {
        if (!Array.isArray(p) || p.length < 2) return;
        const a = seatOf[p[0]], b = seatOf[p[1]];
        if (a === undefined || b === undefined || a === b) return;
        // 回避同桌只有「被安排成了同桌」才画互斥连线；已分开时保持静默
        if (dm[a] !== b) return;
        const link = planOne(a, b, 'avoid', [p[0], p[1]], links.length, ctx);
        if (link) { links.push(link); avoidCount++; }
    });

    return { links: links, forcedCount: forcedCount, avoidCount: avoidCount };
}
