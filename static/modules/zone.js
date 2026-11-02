// =====================================================================
// modules/zone.js
//
// 教室「九宫格区域」——把座位按 行数三等分（前/中/后）× 列数三等分（左/中/右）
// 划成 9 个区域，供「智能排座 → 区域设置」使用：
//   · 倾向区域(zonePref)  ：排座时尽量把该学生安排进这个区域
//   · 避开区域(zoneAvoid) ：排座时尽量别把该学生安排在这个区域
//
// 设计要点:
//   · 纯函数，无 DOM、不读全局 state ⇒ 可被 Node ESM 直接 import 单测
//   · 区域只是「软约束」：optimizeZones 只做**等价交换**（有人↔有人），
//     不增不减占座数，因此不会让任何学生失去座位
//   · 交换是否允许由调用方注入的 guard 决定（配对 / 性别 / 原座位等硬约束
//     由 random-arrange 判定，本模块不感知业务规则）
// =====================================================================

const ROW_KEYS = ['front', 'mid', 'back'];
const COL_KEYS = ['left', 'center', 'right'];
const ROW_LABELS = ['前', '中', '后'];
const COL_LABELS = ['左', '中', '右'];

// 权重：避开比倾向更强一点（老师标"别坐这"通常比"想坐这"更硬）
const PREF_WEIGHT = 2;
const AVOID_WEIGHT = 3;

export const ZONE_IDS = [];
export const ZONE_DEFS = [];
ROW_KEYS.forEach(function (rk, ri) {
    COL_KEYS.forEach(function (ck, ci) {
        const id = rk + '-' + ck;
        ZONE_IDS.push(id);
        ZONE_DEFS.push({ id: id, name: ROW_LABELS[ri] + COL_LABELS[ci], rowBand: ri, colBand: ci });
    });
});

const ZONE_NAME = {};
ZONE_DEFS.forEach(function (d) { ZONE_NAME[d.id] = d.name; });

export function isZoneId(id) {
    return typeof id === 'string' && ZONE_IDS.indexOf(id) >= 0;
}

export function zoneName(id) {
    return ZONE_NAME[id] || '';
}

// 把第 i 项（行或列）归入 0/1/2 三档。
// 只有 1 行/列时归「中」；2 行/列时归「前/后」(或「左/右」)，不产生空的中间档。
export function bandIndex(i, total) {
    if (!(total > 0)) return 1;
    if (total <= 1) return 1;
    if (total === 2) return i <= 0 ? 0 : 2;
    const b = Math.floor(i * 3 / total);
    return b < 0 ? 0 : (b > 2 ? 2 : b);
}

// 座位下标 → 区域 id；越界返回 ''
export function seatZone(index, rows, cols) {
    if (!(index >= 0) || !(rows > 0) || !(cols > 0)) return '';
    if (index >= rows * cols) return '';
    const r = Math.floor(index / cols);
    const c = index % cols;
    return ROW_KEYS[bandIndex(r, rows)] + '-' + COL_KEYS[bandIndex(c, cols)];
}

// 区域 id → 座位下标数组（9 个 key 恒定存在，可能是空数组）
export function buildZoneMap(rows, cols) {
    const map = {};
    ZONE_IDS.forEach(function (id) { map[id] = []; });
    const total = (rows > 0 && cols > 0) ? rows * cols : 0;
    for (let i = 0; i < total; i++) {
        const z = seatZone(i, rows, cols);
        if (z) map[z].push(i);
    }
    return map;
}

// 规范化某学生的区域设置（非法/缺失一律视为未设置）
export function studentZonePrefs(s) {
    return {
        prefer: isZoneId(s && s.zonePref) ? s.zonePref : '',
        avoid: isZoneId(s && s.zoneAvoid) ? s.zoneAvoid : ''
    };
}

// 某学生在「位于 zone 区域的座位」上的代价（0 = 完全满足）
export function zoneCost(prefs, zone) {
    let cost = 0;
    if (prefs.prefer && prefs.prefer !== zone) cost += PREF_WEIGHT;
    if (prefs.avoid && prefs.avoid === zone) cost += AVOID_WEIGHT;
    return cost;
}

// 当前座位表的区域适配情况（供弹窗顶部预览 / 排座后 toast 使用）
export function zoneStats(seats, students, rows, cols) {
    const byId = {};
    (students || []).forEach(function (s) { if (s && s.id) byId[s.id] = s; });

    const counts = {};
    ZONE_IDS.forEach(function (id) { counts[id] = { prefer: 0, avoid: 0, seated: 0 }; });

    let prefTotal = 0, prefMet = 0, avoidTotal = 0, avoidHit = 0;
    const unmet = [];

    (seats || []).forEach(function (sid, idx) {
        if (!sid) return;
        const zone = seatZone(idx, rows, cols);
        if (!zone) return;
        counts[zone].seated++;

        const s = byId[sid];
        if (!s) return;
        const prefs = studentZonePrefs(s);

        if (prefs.prefer) {
            prefTotal++;
            counts[prefs.prefer].prefer++;
            if (zone === prefs.prefer) {
                prefMet++;
            } else {
                unmet.push({ id: sid, name: s.name, kind: 'prefer', zone: prefs.prefer, at: zone });
            }
        }
        if (prefs.avoid) {
            avoidTotal++;
            counts[prefs.avoid].avoid++;
            if (zone === prefs.avoid) {
                avoidHit++;
                unmet.push({ id: sid, name: s.name, kind: 'avoid', zone: prefs.avoid, at: zone });
            }
        }
    });

    return {
        counts: counts,
        prefTotal: prefTotal,
        prefMet: prefMet,
        avoidTotal: avoidTotal,
        avoidHit: avoidHit,
        total: prefTotal + avoidTotal,
        met: prefMet + (avoidTotal - avoidHit),
        unmet: unmet
    };
}

// 贪心换座优化：
//   反复扫描「未被满足」的学生，找「换过去自己严格变好、且不会让别人整体变差」的座位，
//   与那里的人交换。guard(seatA, seatB, idA, idB) 返回 false 时跳过该候选。
//   就地修改 seats（保持数组引用），返回 { moved }。
export function optimizeZones(seats, students, rows, cols, options) {
    options = options || {};
    const guard = typeof options.guard === 'function' ? options.guard : function () { return true; };
    const maxPasses = Math.max(1, Math.floor(options.maxPasses || 4));

    const prefsOf = {};
    const targets = [];
    (students || []).forEach(function (s) {
        if (!s || !s.id) return;
        const p = studentZonePrefs(s);
        prefsOf[s.id] = p;
        if (p.prefer || p.avoid) targets.push(s);
    });
    if (targets.length === 0 || !seats || seats.length === 0) return { moved: 0 };

    const seatOf = {};
    for (let i = 0; i < seats.length; i++) {
        if (seats[i]) seatOf[seats[i]] = i;
    }

    const empty = { prefer: '', avoid: '' };
    let moved = 0;

    for (let pass = 0; pass < maxPasses; pass++) {
        let changed = false;

        for (let t = 0; t < targets.length; t++) {
            const s = targets[t];
            const cur = seatOf[s.id];
            if (cur === undefined) continue;

            const mine = prefsOf[s.id];
            const curZone = seatZone(cur, rows, cols);
            const before = zoneCost(mine, curZone);
            if (before === 0) continue;   // 已满足

            let bestSeat = -1;
            let bestGain = 0;

            for (let j = 0; j < seats.length; j++) {
                if (j === cur) continue;
                const other = seats[j];
                if (!other) continue;      // 只做「有人↔有人」的等价交换

                const zone = seatZone(j, rows, cols);
                const after = zoneCost(mine, zone);
                if (after >= before) continue;   // 自己必须严格变好

                const otherPrefs = prefsOf[other] || empty;
                const gain = (before - after)
                    + (zoneCost(otherPrefs, zone) - zoneCost(otherPrefs, curZone));
                if (gain <= bestGain) continue;  // 严格大于 ⇒ 平局取下标更靠前的座位

                if (!guard(cur, j, s.id, other)) continue;

                bestGain = gain;
                bestSeat = j;
            }

            if (bestSeat >= 0) {
                const other = seats[bestSeat];
                seats[bestSeat] = s.id;
                seats[cur] = other;
                seatOf[s.id] = bestSeat;
                seatOf[other] = cur;
                moved++;
                changed = true;
            }
        }

        if (!changed) break;
    }

    return { moved: moved };
}
