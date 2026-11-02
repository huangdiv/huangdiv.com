// =====================================================================
// modules/student-rank.js
//
// 学生「排名」相关的纯函数集合（无 DOM / 无全局状态，可被 Node ESM 直接单测）。
//
// 提供:
//   parseRankValue(value)                 解析 Excel 排名依据单元格 → 数字 | null
//   normalizeRank(value, fallback)        规整排名为 >=1 的整数
//   rankOf(student)                       取排名（缺失 → Infinity，排序时排最后）
//   compareByRank(a, b)                   按排名升序（缺失排最后，同值保持原序）
//   sortByRank(list)                      返回按排名排序的新数组（不改原数组）
//   rankOrderIndices(values, direction)   按依据值排序后的下标序列（含空值处理）
//   isCadreStudent(student)               是否班委（按标签文本识别）
//   normalizeGroupCount(n, total)         组数钳制
//   planBalancedGroupAssignment(list, g)  蛇形顺序 + 性别/班委均衡的分组方案
//
// 设计要点:
//   - 「均衡」是尽力而为：先固定蛇形顺序（1..G 正序 / G..1 逆序 交替），
//     再在每一批（每组各 1 人）内做一次小规模最优化，使各组的
//     性别差 (男-女)² 与 班委数² 之和最小；无性别/班委信息时恒等排列，
//     即严格保持 1..G 正序，符合「默认按排名顺序分配」的直觉。
//   - 批内最优解：组数 <= 7 时穷举全排列（最多 5040 种，代价可忽略）；
//     更大规模退化为逐槽贪心，避免阶乘爆炸。
// =====================================================================

/** 班委/干部类标签关键词（命中任一即视为班委，用于分组均衡） */
export const CADRE_KEYWORDS = [
    '班长', '班委', '班干部', '团支部', '团支书', '委员', '课代表',
    '组长', '队长', 'monitor', 'leader', 'chief', 'captain'
];

/**
 * 解析排名依据单元格。
 * 支持 "3" / " 3 " / "第3名" / "3.0" 等；无法解析或空白 → null。
 * @param {*} value
 * @returns {number|null}
 */
export function parseRankValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).trim();
    if (!text) return null;
    const direct = Number(text);
    if (Number.isFinite(direct)) return direct;
    const matched = text.match(/-?\d+(?:\.\d+)?/);
    if (!matched) return null;
    const num = Number(matched[0]);
    return Number.isFinite(num) ? num : null;
}

/**
 * 规整排名：必须是 >= 1 的整数，否则用 fallback（再否则 1）。
 * @param {*} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function normalizeRank(value, fallback) {
    const num = parseInt(value, 10);
    if (Number.isFinite(num) && num >= 1) return num;
    const fb = parseInt(fallback, 10);
    if (Number.isFinite(fb) && fb >= 1) return fb;
    return 1;
}

/**
 * 取学生排名；缺失/非法 → Infinity（保证排序时排到最后）。
 * @param {{rank?:number}} student
 * @returns {number}
 */
export function rankOf(student) {
    if (!student) return Number.POSITIVE_INFINITY;
    const num = parseInt(student.rank, 10);
    return Number.isFinite(num) && num >= 1 ? num : Number.POSITIVE_INFINITY;
}

/**
 * 按排名升序比较。排名相同返回 0（依赖 Array#sort 的稳定性保持原顺序）。
 * @param {{rank?:number}} a
 * @param {{rank?:number}} b
 * @returns {number}
 */
export function compareByRank(a, b) {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra === rb) return 0;
    // Infinity - Infinity = NaN，必须显式分支
    if (ra === Number.POSITIVE_INFINITY) return 1;
    if (rb === Number.POSITIVE_INFINITY) return -1;
    return ra - rb;
}

/**
 * 返回按排名升序排列的新数组（不改动入参）。
 * @template T
 * @param {T[]} list
 * @returns {T[]}
 */
export function sortByRank(list) {
    return (Array.isArray(list) ? list.slice() : []).sort(compareByRank);
}

/**
 * 按依据值排序后的下标序列（稳定排序；空值恒排最后）。
 * @param {Array<number|null>} values  已解析的依据值
 * @param {'asc'|'desc'} direction
 * @returns {number[]}
 */
export function rankOrderIndices(values, direction) {
    const desc = direction === 'desc';
    const list = Array.isArray(values) ? values : [];
    const indices = list.map(function (_, i) { return i; });
    indices.sort(function (i, j) {
        const a = list[i];
        const b = list[j];
        const aNull = a === null || a === undefined || !Number.isFinite(a);
        const bNull = b === null || b === undefined || !Number.isFinite(b);
        if (aNull && bNull) return i - j;      // 都无值 → 保持原始顺序
        if (aNull) return 1;                    // 无值排最后
        if (bNull) return -1;
        if (a === b) return i - j;              // 同值 → 保持原始顺序
        return desc ? b - a : a - b;
    });
    return indices;
}

/**
 * 是否班委（按标签文本识别；标签形如 { label, emoji }）。
 * @param {{tags?: Array<{label?:string}>}} student
 * @returns {boolean}
 */
export function isCadreStudent(student) {
    if (!student || !Array.isArray(student.tags) || student.tags.length === 0) return false;
    for (let i = 0; i < student.tags.length; i++) {
        const tag = student.tags[i];
        const label = String((tag && tag.label) || '').toLowerCase();
        if (!label) continue;
        for (let k = 0; k < CADRE_KEYWORDS.length; k++) {
            if (label.indexOf(CADRE_KEYWORDS[k].toLowerCase()) >= 0) return true;
        }
    }
    return false;
}

/**
 * 组数钳制到 [1, 学生数]；学生数为 0 时返回 0。
 * @param {*} value
 * @param {number} total
 * @returns {number}
 */
export function normalizeGroupCount(value, total) {
    const max = Math.max(0, parseInt(total, 10) || 0);
    if (max === 0) return 0;
    const num = parseInt(value, 10);
    if (!Number.isFinite(num)) return 1;
    return Math.max(1, Math.min(num, max));
}

// ─────────────────────────── 内部工具 ───────────────────────────

function emptyStat() {
    return { male: 0, female: 0, cadre: 0, count: 0 };
}

function addToStat(stat, student) {
    stat.count++;
    if (student.gender === 'male') stat.male++;
    else if (student.gender === 'female') stat.female++;
    if (isCadreStudent(student)) stat.cadre++;
}

/**
 * 批内代价：受影响各组的 性别差² 与 班委数² 加权求和。
 * 未受影响的组贡献恒定，可省略（不影响 argmin）。
 */
function scoreAssignment(perm, chunk, targets, stats, weights) {
    let genderScore = 0;
    let cadreScore = 0;
    for (let k = 0; k < targets.length; k++) {
        const stat = stats[targets[k]];
        const student = chunk[perm[k]];
        const male = stat.male + (student.gender === 'male' ? 1 : 0);
        const female = stat.female + (student.gender === 'female' ? 1 : 0);
        const cadre = stat.cadre + (isCadreStudent(student) ? 1 : 0);
        genderScore += (male - female) * (male - female);
        cadreScore += cadre * cadre;
    }
    return genderScore * weights.gender + cadreScore * weights.cadre;
}

/** 逐槽贪心代价（同一组的候选比较用） */
function scoreCandidate(stat, student, weights) {
    const male = stat.male + (student.gender === 'male' ? 1 : 0);
    const female = stat.female + (student.gender === 'female' ? 1 : 0);
    const cadre = stat.cadre + (isCadreStudent(student) ? 1 : 0);
    return (male - female) * (male - female) * weights.gender + cadre * cadre * weights.cadre;
}

/**
 * 遍历 n 的全排列；**第一个**输出恒为恒等排列 [0..n-1]，
 * 因此「代价相同时保留前者」天然等价于「尽量保持默认顺序」。
 */
function forEachPermutation(n, fn) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(i);
    (function walk(k) {
        if (k === n) { fn(arr.slice()); return; }
        for (let i = k; i < n; i++) {
            const tmp = arr[k];
            arr[k] = arr[i];
            arr[i] = tmp;
            walk(k + 1);
            arr[i] = arr[k];
            arr[k] = tmp;
        }
    })(0);
}

const MAX_EXHAUSTIVE = 7;   // 7! = 5040 种排列，代价可接受

/**
 * 求解一批学生的落位：返回与 targets 等长的数组，第 k 项分到 targets[k] 组。
 */
function solveBatch(chunk, targets, stats, weights) {
    const n = chunk.length;
    if (n <= 1) return chunk.slice();

    if (n <= MAX_EXHAUSTIVE) {
        let bestPerm = null;
        let bestScore = Infinity;
        forEachPermutation(n, function (perm) {
            const score = scoreAssignment(perm, chunk, targets, stats, weights);
            if (score < bestScore - 1e-9) {
                bestScore = score;
                bestPerm = perm;
            }
        });
        if (bestPerm) return bestPerm.map(function (i) { return chunk[i]; });
        return chunk.slice();
    }

    // 大规模：逐槽贪心（每槽都在剩余候选里挑代价最小的，代价相同取靠前的）
    const remaining = chunk.slice();
    const plan = [];
    for (let k = 0; k < targets.length; k++) {
        const stat = stats[targets[k]];
        let bestIdx = 0;
        let bestScore = Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const score = scoreCandidate(stat, remaining[i], weights);
            if (score < bestScore - 1e-9) {
                bestScore = score;
                bestIdx = i;
            }
        }
        plan.push(remaining.splice(bestIdx, 1)[0]);
    }
    return plan;
}

/**
 * 按排名均衡分组方案。
 *
 * 规则:
 *   1. 学生按排名升序（rank 小的优先）排队；
 *   2. 每 G 人一批，第 1 批按 1..G 正序落到 1..G 组，第 2 批按 G..1 逆序，
 *      第 3 批再正序 …… 交替，保证各批都覆盖所有组；
 *   3. 每批内部在不破坏「一组建一人」的前提下，尽量让各组的
 *      男女差与班委数更均衡（无性别/班委信息时恒等排列 = 严格按排名顺序）。
 *
 * @param {Array<{id:string, rank?:number, gender?:string, tags?:Array}>} students
 * @param {number} groupCount
 * @param {{genderWeight?:number, cadreWeight?:number}} [options]
 * @returns {{groupCount:number, assignments:Array<{studentId:string, groupIndex:number}>, stats:Array}}
 */
export function planBalancedGroupAssignment(students, groupCount, options) {
    const list = (Array.isArray(students) ? students : []).filter(Boolean);
    const g = normalizeGroupCount(groupCount, list.length);
    if (g === 0) return { groupCount: 0, assignments: [], stats: [] };

    const opts = options || {};
    const weights = {
        gender: typeof opts.genderWeight === 'number' ? opts.genderWeight : 2,
        cadre: typeof opts.cadreWeight === 'number' ? opts.cadreWeight : 3
    };

    const ordered = sortByRank(list);
    const stats = [];
    for (let i = 0; i < g; i++) stats.push(emptyStat());

    const assignments = [];
    let batch = 0;
    for (let start = 0; start < ordered.length; start += g, batch++) {
        const chunk = ordered.slice(start, start + g);
        const forward = batch % 2 === 0;
        const slotOrder = [];
        for (let i = 0; i < g; i++) slotOrder.push(forward ? i : g - 1 - i);
        const targets = slotOrder.slice(0, chunk.length);

        const plan = solveBatch(chunk, targets, stats, weights);
        for (let k = 0; k < targets.length; k++) {
            const groupIndex = targets[k];
            const student = plan[k];
            addToStat(stats[groupIndex], student);
            assignments.push({ studentId: student.id, groupIndex: groupIndex });
        }
    }

    return { groupCount: g, assignments: assignments, stats: stats };
}
