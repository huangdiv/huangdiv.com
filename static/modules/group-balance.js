// =====================================================================
// modules/group-balance.js
//
// 分组「均衡系数」计算（纯函数，无 DOM / 无全局状态，可被 Node ESM 单测）。
//
// 目标：给老师一个 0~100 的数，**横向对比**当前各分组是否均衡，
//       便于手动把某个偏弱的组调整回来。
//
// 系数由三个维度加权而成（缺数据的维度自动剔除并重新归一化权重）：
//
//   1. 排名均衡 (权重 0.6)  —— 核心维度
//      把已分组的学生按排名排队，每 G 人切成一条「排名带」（G = 非空组数）。
//      一条带里恰好一人落到一个组，正是「蛇形分组」的理想形态：
//      每个组都覆盖到从尖子到后进的每一层。
//      对每个组，统计它在每条带里的人数 c_b，与理想值 bandSize/G 求差：
//          dev = Σ_b |c_b − bandSize_b / G|
//          rankScore = 100 · max(0, 1 − dev / (2k))      （k = 组人数）
//        ⇒ 完美覆盖 → 100；一次两人互换（dev=2）→ 约 83；
//          按名次整块切（1-6 / 7-12 / 13-18）→ 约 33；
//          全是一层的学生 → 接近 0。
//      为什么不用「组平均排名偏差」：整块切分时中间那一组的平均排名
//      恰好等于全班平均，会被误判成满分 —— 带覆盖度没有这个盲区。
//
//   2. 性别均衡 (权重 0.2)
//      组内男生占比与该组规模下「全班男生占比」的差，线性映射为分数。
//      全班没有性别数据时该维度不参与计算（不给老师扣无意义的分数）。
//
//   3. 班委均衡 (权重 0.2)
//      组内班委数与该组规模下「全班班委数 / 组数」的期望值之差，
//      用期望值归一（期望不足 1 时按 1 归一，避免小题大做）。
//
// 输出里同时给出逐维度分数，UI 可放进 title 里解释「为什么这组 82 分」。
// =====================================================================

import { rankOf, isCadreStudent, compareByRank } from './student-rank.js';

/** 各维度默认权重（缺数据时自动剔除并重新归一化） */
export const DEFAULT_WEIGHTS = { rank: 0.6, gender: 0.2, cadre: 0.2 };

function toFiniteNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

/**
 * 均衡系数 → 等级，供 UI 上色。
 * @param {number|null} score
 * @returns {'good'|'fair'|'poor'|'empty'}
 */
export function balanceLevel(score) {
    if (score === null || score === undefined || !Number.isFinite(score)) return 'empty';
    if (score >= 90) return 'good';
    if (score >= 75) return 'fair';
    return 'poor';
}

/** 四舍五入到整数（UI 用），null 原样返回 */
export function roundScore(score) {
    if (score === null || score === undefined || !Number.isFinite(score)) return null;
    return Math.round(score);
}

/**
 * 计算各分组的均衡系数。
 *
 * @param {Array<{id:string, groupId?:string|null, rank?:number, gender?:string, tags?:Array}>} students
 * @param {Array<{id:string, name?:string, color?:string}>} groups
 * @param {{weights?: {rank?:number, gender?:number, cadre?:number}}} [options]
 * @returns {{
 *   available: {gender:boolean, cadre:boolean},
 *   weights: {rank:number, gender:number, cadre:number},
 *   overall: {score:number|null, spread:number, meanRank:number|null,
 *             groupCount:number, studentCount:number, weakestGroupId:string|null},
 *   groups: Array<{groupId:string, groupIndex:number, name:string, color:string,
 *                  count:number, male:number, female:number, cadre:number,
 *                  avgRank:number|null, deviation:number|null,
 *                  rankScore:number|null, genderScore:number|null,
 *                  cadreScore:number|null, score:number|null, level:string}>
 * }}
 */
export function computeGroupBalance(students, groups, options) {
    const groupList = (Array.isArray(groups) ? groups : []).filter(Boolean);
    const studentList = (Array.isArray(students) ? students : []).filter(Boolean);
    const opts = options || {};
    const inputWeights = opts.weights || {};

    // ── 1. 按分组分桶（只统计 groupId 能对上现有分组的） ──
    const indexOfGroup = new Map();
    groupList.forEach(function (g, i) { indexOfGroup.set(g.id, i); });
    const buckets = groupList.map(function () { return []; });
    const pool = [];
    studentList.forEach(function (s) {
        const gid = s.groupId;
        if (gid === null || gid === undefined) return;
        const gi = indexOfGroup.get(gid);
        if (gi === undefined) return;          // 悬空 groupId（分组已删）→ 忽略
        buckets[gi].push(s);
        pool.push(s);
    });

    // ── 2. 全局基准（仅用有分组的学生） ──
    const ordered = pool.slice().sort(compareByRank);
    const validRanks = [];
    let totalMale = 0;
    let totalFemale = 0;
    let totalCadre = 0;
    ordered.forEach(function (s) {
        const r = rankOf(s);
        if (Number.isFinite(r)) validRanks.push(r);
        if (s.gender === 'male') totalMale++;
        else if (s.gender === 'female') totalFemale++;
        if (isCadreStudent(s)) totalCadre++;
    });

    let meanRank = null;
    if (validRanks.length > 0) {
        const sum = validRanks.reduce(function (a, b) { return a + b; }, 0);
        meanRank = sum / validRanks.length;
    }

    const genderKnown = totalMale + totalFemale;
    const genderAvailable = genderKnown > 0;
    const maleRatio = genderAvailable ? totalMale / genderKnown : 0;

    const nonEmptyGroups = buckets.filter(function (b) { return b.length > 0; }).length;
    const cadreAvailable = totalCadre > 0 && nonEmptyGroups > 0;
    const cadrePerGroup = cadreAvailable ? totalCadre / nonEmptyGroups : 0;

    // ── 2b. 排名带：每 G 人一条带，理想状态「一条带里每组各一人」 ──
    const bandCount = nonEmptyGroups > 0 ? Math.ceil(ordered.length / nonEmptyGroups) : 0;
    const bandOfStudent = new Map();      // studentId → 带序号
    const bandSizes = new Array(Math.max(0, bandCount)).fill(0);
    ordered.forEach(function (s, i) {
        const band = nonEmptyGroups > 0 ? Math.floor(i / nonEmptyGroups) : 0;
        bandOfStudent.set(s.id, band);
        if (bandSizes[band] !== undefined) bandSizes[band]++;
    });
    const bandExpected = function (b) {
        return nonEmptyGroups > 0 ? bandSizes[b] / nonEmptyGroups : 0;
    };

    // ── 3. 权重：缺数据的维度剔除后重新归一化 ──
    const rawWeights = {
        rank: toFiniteNumber(inputWeights.rank, DEFAULT_WEIGHTS.rank),
        gender: genderAvailable ? toFiniteNumber(inputWeights.gender, DEFAULT_WEIGHTS.gender) : 0,
        cadre: cadreAvailable ? toFiniteNumber(inputWeights.cadre, DEFAULT_WEIGHTS.cadre) : 0
    };
    const weightSum = rawWeights.rank + rawWeights.gender + rawWeights.cadre;
    const weights = weightSum > 0
        ? {
            rank: rawWeights.rank / weightSum,
            gender: rawWeights.gender / weightSum,
            cadre: rawWeights.cadre / weightSum
        }
        : { rank: 1, gender: 0, cadre: 0 };

    // ── 4. 逐组计算 ──
    const groupResults = groupList.map(function (g, gi) {
        const members = buckets[gi];
        const count = members.length;
        const base = {
            groupId: g.id,
            groupIndex: gi,
            name: g.name || ('第' + (gi + 1) + '组'),
            color: g.color || '',
            count: 0,
            male: 0,
            female: 0,
            cadre: 0,
            avgRank: null,
            deviation: null,
            bandDeviation: null,
            rankScore: null,
            genderScore: null,
            cadreScore: null,
            score: null,
            level: 'empty'
        };
        if (count === 0) return base;

        let male = 0;
        let female = 0;
        let cadre = 0;
        let rankSum = 0;
        const perBand = new Array(Math.max(0, bandCount)).fill(0);
        members.forEach(function (s) {
            if (s.gender === 'male') male++;
            else if (s.gender === 'female') female++;
            if (isCadreStudent(s)) cadre++;
            const r = rankOf(s);
            // 缺排名的学生按全班均值参与（中性，不人为拉偏该组）
            rankSum += Number.isFinite(r) ? r : (meanRank === null ? 0 : meanRank);
            const band = bandOfStudent.get(s.id);
            if (band !== undefined && perBand[band] !== undefined) perBand[band]++;
        });

        const avgRank = rankSum / count;
        const deviation = meanRank === null ? 0 : avgRank - meanRank;

        // 排名维度：排名带覆盖度（每条带里每组理想为 bandSize/G 人）
        let bandDeviation = 0;
        for (let b = 0; b < bandCount; b++) {
            bandDeviation += Math.abs(perBand[b] - bandExpected(b));
        }
        const rankScore = 100 * Math.max(0, 1 - bandDeviation / (2 * count));

        // 性别维度
        let genderScore = null;
        if (genderAvailable) {
            const known = male + female;
            if (known === 0) {
                genderScore = 100;               // 本组无性别数据 → 中性
            } else {
                const ratio = male / known;
                genderScore = 100 * (1 - Math.abs(ratio - maleRatio));
            }
        }

        // 班委维度
        let cadreScore = null;
        if (cadreAvailable) {
            const expected = Math.max(1, cadrePerGroup);
            const dev = Math.abs(cadre - expected) / expected;
            cadreScore = 100 * (1 - Math.min(1, dev));
        }

        // 加权合成（未参与计算的维度直接跳过，权重已在上面归一化）
        let score = rankScore * weights.rank;
        if (genderScore !== null && weights.gender > 0) score += genderScore * weights.gender;
        if (cadreScore !== null && weights.cadre > 0) score += cadreScore * weights.cadre;
        score = Math.max(0, Math.min(100, score));

        return Object.assign(base, {
            count: count,
            male: male,
            female: female,
            cadre: cadre,
            avgRank: avgRank,
            deviation: deviation,
            bandDeviation: bandDeviation,
            rankScore: rankScore,
            genderScore: genderScore,
            cadreScore: cadreScore,
            score: score,
            level: balanceLevel(score)
        });
    });

    // ── 5. 整体汇总 ──
    const scored = groupResults.filter(function (r) { return r.score !== null; });
    let overallScore = null;
    let spread = 0;
    let weakestGroupId = null;
    if (scored.length > 0) {
        const sum = scored.reduce(function (a, r) { return a + r.score; }, 0);
        overallScore = sum / scored.length;
        let min = Infinity;
        let max = -Infinity;
        scored.forEach(function (r) {
            if (r.score < min) { min = r.score; weakestGroupId = r.groupId; }
            if (r.score > max) max = r.score;
        });
        spread = max - min;
    }

    return {
        available: { gender: genderAvailable, cadre: cadreAvailable },
        weights: weights,
        overall: {
            score: overallScore,
            spread: spread,
            meanRank: meanRank,
            groupCount: nonEmptyGroups,
            studentCount: pool.length,
            weakestGroupId: weakestGroupId
        },
        groups: groupResults
    };
}
