// modules/random-arrange.js
// ─────────────────────────────────────────────────────────────────────────────
// 随机排座核心引擎(3 模式 + 强制配对 + 回避配对 + 后处理换座保证)
//
// 职责:
//   - randomSeatArrange(mode) — 入口
//       mode ∈ { 'random' 完全随机, 'mixed' 男女同桌, 'samegender' 男女不同桌 }
//   - 模块私有 helpers:
//       getDeskMatePairs()  同桌对检测(同 row、相邻 col、中间无走道)
//       getGender(s)        性别归一('M'/'F'/'X' wildcard)
//
// 依赖(通过 deps 注入):
//   - helpers   { shuffle } — 来自主 IIFE 的通用洗牌工具
//   - callbacks { onPushSnapshot, onGenerateSeats }
//   - state(直接 import './state.js')
//
// 读路径:全部从 state.* 直读(path-A2 等价行为)
// 写路径:state.seats = Array(...) 重新指向 + commit() 派发 change + 末尾 generateSeats
// ─────────────────────────────────────────────────────────────────────────────

import { state, commit } from './state.js';
import { MESSAGES } from './messages.js';

export function createRandomArrange(deps) {
    const { helpers, callbacks } = deps;
    const { shuffle } = helpers;
    const { onPushSnapshot, onGenerateSeats } = callbacks;

    // ─────────── 模块私有 helpers ───────────

    // 获取所有同桌对(同 row、相邻 col、中间无走道)、单独座位、以及同桌映射表 pairMap。
    // 同时返回 pairMap 是为 #6 重构铺路:findPairMate 可以 O(1) 查到某座位的同桌,
    // 不再每次 O(pairs.length) 线性扫描(原 findDeskMateSeat 是 O(pairs.length))。
    // 为未来支持异形座位布局(纵向同桌 / 三人桌 / L 形桌)铺路:
    //   只需扩展此函数内部 pairMap 填充策略(纵向填 mate、三人桌三向填),
    //   findPairMate 与所有调用点零修改。
    function getDeskMatePairs() {
        const pairs = [];     // [[idx1, idx2], ...] 同桌对
        const singles = [];   // 无法配对的单独座位索引
        const pairMap = new Array(state.rows * state.cols).fill(null); // idx → mateIdx
        for (let r = 0; r < state.rows; r++) {
            let c = 0;
            while (c < state.cols) {
                const idx = r * state.cols + c;
                if (c + 1 < state.cols) {
                    // 检查 c 和 c+1 之间是否有走道
                    const aisle = state.aisles.find(a => a.afterCol === c + 1);
                    if (!aisle) {
                        // 无走道 → 同桌(双向填 pairMap,支持反向查询)
                        const mateIdx = idx + 1;
                        pairMap[idx] = mateIdx;
                        pairMap[mateIdx] = idx;
                        pairs.push([idx, mateIdx]);
                        c += 2;
                        continue;
                    }
                }
                singles.push(idx);
                c += 1;
            }
        }
        return { pairs: pairs, singles: singles, pairMap: pairMap };
    }

    // O(1) 找某座位的同桌座位;pairMap 必须由 getDeskMatePairs() 产生。
    // 单同桌型(横向):返回唯一 mate;无同桌型(singles/走道分隔):返回 null。
    function findPairMate(seatIdx, pairMap) {
        if (!pairMap) return null;
        return pairMap[seatIdx];
    }

    // 判断学生性别(无性别信息视为中性 wildcard)
    function getGender(s) {
        if (s.gender === 'male') return 'M';
        if (s.gender === 'female') return 'F';
        return 'X'; // unknown / wildcard
    }

    // ─────────── 配对设置:满足情况检测 + 修复(随机排座 / 分组轮换共用)───────────

    // 回避配对查重器:一次性把 avoidPairs 建成 Set(key 为排序后的 "idA|idB"),O(1) 查询
    function makeAvoidChecker() {
        var set = new Set();
        state.avoidPairs.forEach(function (p) {
            if (!p || p.length < 2) return;
            set.add(p[0] < p[1] ? p[0] + '|' + p[1] : p[1] + '|' + p[0]);
        });
        return function isAvoided(idA, idB) {
            if (set.size === 0) return false;
            return set.has(idA < idB ? idA + '|' + idB : idB + '|' + idA);
        };
    }

    // studentId → seatIdx 映射
    function buildSeatOf() {
        var seatOf = Object.create(null);
        for (var i = 0; i < state.seats.length; i++) {
            if (state.seats[i]) seatOf[state.seats[i]] = i;
        }
        return seatOf;
    }

    // 当前座位的配对违规情况(任一学生未入座的配对不参与判定)
    function computePairViolations(pairMap) {
        var seatOf = buildSeatOf();
        var forcedBroken = [];
        var avoidBroken = [];
        state.forcedPairs.forEach(function (p) {
            if (!p || p.length < 2) return;
            var a = seatOf[p[0]], b = seatOf[p[1]];
            if (a === undefined || b === undefined) return;
            if (findPairMate(a, pairMap) !== b) forcedBroken.push(p);
        });
        state.avoidPairs.forEach(function (p) {
            if (!p || p.length < 2) return;
            var a = seatOf[p[0]], b = seatOf[p[1]];
            if (a === undefined || b === undefined) return;
            if (findPairMate(a, pairMap) === b) avoidBroken.push(p);
        });
        return { forcedBroken: forcedBroken, avoidBroken: avoidBroken, seatOf: seatOf };
    }

    // 每条配对当前的满足状态,供 UI 着色:
    //   'ok'  = 已满足(强制已同桌 / 回避已分开)
    //   'bad' = 未满足(强制未同桌 / 回避仍同桌)
    //   'na'  = 有人未入座,无法判定
    function getPairStatus() {
        var pm = getDeskMatePairs().pairMap;
        var seatOf = buildSeatOf();
        function statusOf(pair, kind) {
            var a = seatOf[pair[0]], b = seatOf[pair[1]];
            if (a === undefined || b === undefined) return 'na';
            var together = findPairMate(a, pm) === b;
            if (kind === 'forced') return together ? 'ok' : 'bad';
            return together ? 'bad' : 'ok';
        }
        return {
            forced: state.forcedPairs.map(function (p) {
                return { ids: p, status: statusOf(p, 'forced') };
            }),
            avoid: state.avoidPairs.map(function (p) {
                return { ids: p, status: statusOf(p, 'avoid') };
            })
        };
    }

    // ─────────── 性别规则(男女同桌 / 男女不同桌)检测与组内调整 ───────────

    // studentId → 'M' / 'F' / 'X'
    function buildGenderMap() {
        var m = Object.create(null);
        state.students.forEach(function (s) { m[s.id] = getGender(s); });
        return m;
    }

    // 交换 seatA / seatB 的占座者后,是否会产生新的回避同桌(与 repairPairViolations 同一套判定)
    function swapCreatesAvoidCore(pairMap, isAvoided, seatA, seatB) {
        var idA = state.seats[seatA], idB = state.seats[seatB];
        if (!idA || !idB) return false;
        var mateA = findPairMate(seatA, pairMap);
        var mateB = findPairMate(seatB, pairMap);
        if (mateA != null && state.seats[mateA] && state.seats[mateA] !== idA && state.seats[mateA] !== idB) {
            if (isAvoided(idB, state.seats[mateA])) return true;
        }
        if (mateB != null && state.seats[mateB] && state.seats[mateB] !== idA && state.seats[mateB] !== idB) {
            if (isAvoided(idA, state.seats[mateB])) return true;
        }
        return false;
    }

    // 当前座位表里,不满足性别规则的同桌对。
    // 判定口径(与界面闪烁提示一致):
    //   - 有一侧空座 ⇒ 不判定
    //   - 任一侧性别未知('X') ⇒ 不判定(无法判断男女)
    //   - mixed      :要求一男一女,同性 ⇒ 违规
    //   - samegender :要求同性别,异性 ⇒ 违规
    function findGenderViolations(mode, genderMap, pairMap) {
        var dm = pairMap ? null : getDeskMatePairs();
        var pairs = dm ? dm.pairs : null;
        var pm = pairMap || (dm && dm.pairMap);
        var out = [];
        var visited = new Set();
        // 有 pairMap 时按座位遍历即可(每个同桌对会被两侧各访问一次,用 visited 去重)
        var i, a, b;
        if (pairs) {
            for (i = 0; i < pairs.length; i++) {
                a = pairs[i][0]; b = pairs[i][1];
                if (isGenderDeskViolation(a, b, mode, genderMap)) out.push([a, b]);
            }
            return out;
        }
        for (i = 0; i < pm.length; i++) {
            a = i; b = pm[i];
            if (b === null || b === undefined) continue;
            var key = a < b ? a + '-' + b : b + '-' + a;
            if (visited.has(key)) continue;
            visited.add(key);
            if (isGenderDeskViolation(a, b, mode, genderMap)) out.push([a, b]);
        }
        return out;
    }

    function isGenderDeskViolation(a, b, mode, genderMap) {
        var ida = state.seats[a], idb = state.seats[b];
        if (!ida || !idb) return false;
        var ga = genderMap[ida] || 'X';
        var gb = genderMap[idb] || 'X';
        if (ga === 'X' || gb === 'X') return false;
        return mode === 'mixed' ? (ga === gb) : (ga !== gb);
    }

    // 组内性别规则调整:
    //   只允许「同一小组座位区内部」两两交换 ⇒ 轮换后的各组座位区归属完全不变,
    //   任何学生都不会被挪到别的小组座位区域。
    // 尽力达成 mode('mixed' / 'samegender');确实做不到就保留原样,由调用方提示。
    //
    // opts:
    //   mode         'mixed' | 'samegender'
    //   areaOf       (seatIdx) => 区域标识;null / undefined / <0 表示「不属于任何小组座位区」,
    //                该座位不参与调整(不能在小组间挪人)
    //   maxAttempts  最大尝试轮次
    //   shuffle      洗牌函数
    // 返回 { fixed, remaining } —— remaining 为仍未达成的同桌对 [[idxA, idxB], ...]
    function adjustGenderRuleInGroups(opts) {
        opts = opts || {};
        var mode = opts.mode;
        var areaOf = opts.areaOf;
        var maxAttempts = opts.maxAttempts || 300;
        var shuffleFn = opts.shuffle || function (a) { return a; };
        var dm = getDeskMatePairs();
        var pairMap = dm.pairMap;
        var genderMap = buildGenderMap();
        var isAvoided = makeAvoidChecker();

        if (mode !== 'mixed' && mode !== 'samegender') {
            return { fixed: 0, remaining: [] };
        }
        if (typeof areaOf !== 'function') {
            // 没有区域约束 ⇒ 退化成「全班范围内调整」(仅用于兜底 / 单测)
            areaOf = function () { return 0; };
        }

        // 某座位所在同桌是否满足性别规则(空座 / 性别未知 ⇒ 视为满足,不干预)
        function deskOk(idx) {
            var mate = findPairMate(idx, pairMap);
            if (mate === null || mate === undefined) return true;
            return !isGenderDeskViolation(idx, mate, mode, genderMap);
        }

        // 已满足的强制配对成员不可搬动(搬动就拆散了);回避配对由 swapCreatesAvoidCore 拦截
        var locked = new Set();
        (function () {
            var v = computePairViolations(pairMap);
            state.forcedPairs.forEach(function (p) {
                if (!p || p.length < 2) return;
                if (v.forcedBroken.indexOf(p) < 0) { locked.add(p[0]); locked.add(p[1]); }
            });
        })();

        var occupied = [];
        for (var i = 0; i < state.seats.length; i++) if (state.seats[i]) occupied.push(i);

        var skip = new Set();
        var fixed = 0;
        var attempts = 0;

        while (attempts < maxAttempts) {
            var vio = findGenderViolations(mode, genderMap, pairMap).filter(function (p) {
                return !skip.has(p[0] + '-' + p[1]);
            });
            if (vio.length === 0) break;
            attempts++;
            var target = vio[0];
            var done = false;

            // 先试 a、再试 b(顺序洗牌,避免总是牺牲同一侧)
            var froms = shuffleFn([target[0], target[1]]);
            for (var fi = 0; fi < froms.length && !done; fi++) {
                var from = froms[fi];
                var area = areaOf(from);
                if (area === null || area === undefined || area < 0) continue;
                var cands = shuffleFn(occupied.filter(function (idx) {
                    if (idx === from) return false;
                    if (!state.seats[idx]) return false;
                    return areaOf(idx) === area;     // 硬约束:只在本小组座位区内换
                }));
                for (var ci = 0; ci < cands.length; ci++) {
                    var to = cands[ci];
                    var idFrom = state.seats[from];
                    var idTo = state.seats[to];
                    if (locked.has(idFrom) || locked.has(idTo)) continue;
                    if (swapCreatesAvoidCore(pairMap, isAvoided, from, to)) continue;
                    // 试换:两侧同桌都要满足规则(否则等于把问题搬家)
                    state.seats[from] = idTo;
                    state.seats[to] = idFrom;
                    if (deskOk(from) && deskOk(to)) {
                        done = true;
                        fixed++;
                        break;
                    }
                    state.seats[from] = idFrom;
                    state.seats[to] = idTo;
                }
            }
            if (!done) skip.add(target[0] + '-' + target[1]);   // 组内无解 ⇒ 保留原样
        }

        return {
            fixed: fixed,
            remaining: findGenderViolations(mode, genderMap, pairMap)
        };
    }

    // 修复配对违规。只在「已占座」之间两两交换 ⇒ 占座总数、各区人数分布均不变。
    // opts:
    //   pairMap           同桌映射
    //   maxAttempts       最大尝试次数
    //   shuffle           洗牌函数
    //   candidateSeatsOf  (seatIdx) => 允许换到的座位数组;不传 = 全部已占座
    //                    (分组轮换时限定为「同区座位」,保证轮换后各区人数不变)
    // 返回修复后的违规情况(仍可能非空 —— 由调用方决定是否提示)
    function repairPairViolations(opts) {
        var pairMap = opts.pairMap;
        var maxAttempts = opts.maxAttempts || 200;
        var shuffleFn = opts.shuffle || function (a) { return a; };
        var candidateSeatsOf = opts.candidateSeatsOf || null;
        var isAvoided = makeAvoidChecker();

        function allOccupied() {
            var out = [];
            for (var i = 0; i < state.seats.length; i++) if (state.seats[i]) out.push(i);
            return out;
        }

        // 交换 seatA / seatB 的占座者后,是否会产生新的回避同桌
        // (判定逻辑已上提到 swapCreatesAvoidCore,与组内性别调整共用同一套口径)
        function swapCreatesAvoid(seatA, seatB) {
            return swapCreatesAvoidCore(pairMap, isAvoided, seatA, seatB);
        }

        function doSwap(seatA, seatB) {
            var t = state.seats[seatA];
            state.seats[seatA] = state.seats[seatB];
            state.seats[seatB] = t;
        }

        // 已满足的强制配对里的人不能搬走(搬走就拆散了)
        function lockedIds() {
            var v = computePairViolations(pairMap);
            var ids = new Set();
            state.forcedPairs.forEach(function (p) {
                if (!p || p.length < 2) return;
                if (v.forcedBroken.indexOf(p) < 0) { ids.add(p[0]); ids.add(p[1]); }
            });
            return ids;
        }

        // 强制同桌:把其中一人换到另一人的同桌位上
        function tryFixForced(pair, locked) {
            var seatOf = buildSeatOf();
            var sa = seatOf[pair[0]], sb = seatOf[pair[1]];
            if (sa === undefined || sb === undefined) return false;
            var target = findPairMate(sa, pairMap);
            var mover = sb;
            if (target === null || target === undefined) {
                // a 是单座 ⇒ 反过来把 a 换到 b 的同桌位
                target = findPairMate(sb, pairMap);
                mover = sa;
            }
            if (target === null || target === undefined) return false;
            var occupant = state.seats[target];
            if (!occupant) return false;                       // 只与已占座交换
            if (locked.has(occupant)) return false;
            if (locked.has(state.seats[mover])) return false;
            if (swapCreatesAvoid(target, mover)) return false;
            doSwap(target, mover);
            return true;
        }

        // 回避同桌:把其中一人换到别的座位(默认全区,轮换时仅同区)
        function tryFixAvoid(pair, locked) {
            var seatOf = buildSeatOf();
            var sa = seatOf[pair[0]], sb = seatOf[pair[1]];
            if (sa === undefined || sb === undefined) return false;
            if (findPairMate(sa, pairMap) !== sb) return false;   // 已经不同桌了
            var movers = [sa, sb];
            for (var mi = 0; mi < movers.length; mi++) {
                var from = movers[mi];
                var partnerSeat = (from === sa) ? sb : sa;
                if (locked.has(state.seats[from])) continue;
                var pool = candidateSeatsOf ? candidateSeatsOf(from) : allOccupied();
                var cands = shuffleFn(pool.slice());
                for (var ci = 0; ci < cands.length; ci++) {
                    var to = cands[ci];
                    if (to === from) continue;
                    var other = state.seats[to];
                    if (!other) continue;
                    if (locked.has(other)) continue;
                    if (swapCreatesAvoid(from, to)) continue;
                    // 换过去之后不能又和对方同桌
                    if (findPairMate(to, pairMap) === partnerSeat) continue;
                    doSwap(from, to);
                    return true;
                }
            }
            return false;
        }

        var attempts = 0;
        while (attempts < maxAttempts) {
            var v = computePairViolations(pairMap);
            if (v.forcedBroken.length === 0 && v.avoidBroken.length === 0) break;
            var locked = lockedIds();
            var queue = [];
            v.forcedBroken.forEach(function (p) { queue.push({ type: 'forced', pair: p }); });
            v.avoidBroken.forEach(function (p) { queue.push({ type: 'avoid', pair: p }); });
            var progress = false;
            for (var qi = 0; qi < queue.length && attempts < maxAttempts; qi++) {
                var item = queue[qi];
                // 前面的修复可能顺带解决了这条 ⇒ 逐条重新核对
                var cur = computePairViolations(pairMap);
                var still = item.type === 'forced'
                    ? cur.forcedBroken.indexOf(item.pair) >= 0
                    : cur.avoidBroken.indexOf(item.pair) >= 0;
                if (!still) continue;
                attempts++;
                var ok = item.type === 'forced'
                    ? tryFixForced(item.pair, locked)
                    : tryFixAvoid(item.pair, locked);
                if (ok) {
                    progress = true;
                    locked = lockedIds();
                }
            }
            if (!progress) break;   // 一整轮都修不动 ⇒ 放弃,避免死循环
        }
        return computePairViolations(pairMap);
    }

    // ─────────── 入口函数 ───────────

    // options:
    //   maxAttempts   最大尝试次数(#5 批次,从 localStorage 或 UI 读)
    function randomSeatArrange(mode, options) {
        options = options || {};
        var maxAttempts = (typeof options.maxAttempts === 'number' && options.maxAttempts > 0)
            ? Math.floor(options.maxAttempts)
            : 200;

        if (state.students.length === 0) {
            alert(MESSAGES.NO_STUDENTS_YET);
            return { warnings: [MESSAGES.NO_STUDENTS_YET_WARN] };
        }
        if (!confirm(MESSAGES.CONFIRM_RANDOM_MODE(mode))) {
            return { warnings: [] };
        }

        // 保存旧座位映射(学生ID → 旧座位索引),用于后处理确保完全换座
        var prevSeatMap = {};
        for (var i = 0; i < state.seats.length; i++) {
            if (state.seats[i]) prevSeatMap[state.seats[i]] = i;
        }

        onPushSnapshot('random');
        // 就地清空座位表,保持数组引用不变。
        //
        // 关键:主 IIFE 的顶层 `let currentSeats` 与本数组是别名关系
        // (seats-generator.js 顶部 `let currentSeats = state.seats`)。
        // 若在此重新赋值 Array(...) 会断开别名,而渲染读 state.seats、
        // 自动保存 getCurrentConfig() 读 currentSeats —— 结果是界面显示
        // 新座位、localStorage 却仍写入排座前的旧数组,刷新后回到旧座位
        // (表现="随机排座后自动保存失效")。
        // 仅当长度确实变化(行列数被改过)时才重建,此时靠随后的 commit
        // 让主 IIFE 的别名回同步逻辑拉齐。
        if (state.seats.length !== state.rows * state.cols) {
            state.seats = Array(state.rows * state.cols).fill(null);
        } else {
            state.seats.fill(null);
        }

        const totalSeats = state.rows * state.cols;
        const seatCount = Math.min(state.students.length, totalSeats);

        // 获取同桌对结构(所有模式共用,random 模式也需要处理 forcedPairs)
        const { pairs, singles, pairMap } = getDeskMatePairs();
        const allSeatIndices = [];
        pairs.forEach(p => { allSeatIndices.push(p[0], p[1]); });
        singles.forEach(s => allSeatIndices.push(s));
        const neededIndices = allSeatIndices.slice(0, seatCount);

        // 用于放置的辅助函数
        function placeStudentsInSeats(seatIndices, studentList) {
            const count = Math.min(seatIndices.length, studentList.length);
            for (let i = 0; i < count; i++) {
                state.seats[seatIndices[i]] = studentList[i].id;
            }
        }

        // ── 性别规则上下文(仅 mixed / samegender 模式启用)──
        // 关键:后续「每位学生都不在原来座位」的换座后处理,必须在不破坏性别规则的
        // 前提下进行。此前该阶段完全无视性别 ⇒ 一次排座下来大量同桌被拆成违规,
        // 这正是「开着开关却排不出符合要求座位」的根因。
        var genderRuleMode = (mode === 'mixed' || mode === 'samegender') ? mode : null;
        var genderMap = genderRuleMode ? buildGenderMap() : null;

        // 某座位所在同桌当前是否满足性别规则(空座 / 性别未知 ⇒ 视为满足)
        function deskGenderOk(idx) {
            if (!genderRuleMode) return true;
            var mate = findPairMate(idx, pairMap);
            if (mate === null || mate === undefined) return true;
            return !isGenderDeskViolation(idx, mate, genderRuleMode, genderMap);
        }

        // 试换 seatA / seatB 后两侧同桌是否会产生性别违规(试换后立即还原)
        function swapBreaksGender(seatA, seatB) {
            if (!genderRuleMode || seatA === seatB) return false;
            var idA = state.seats[seatA];
            var idB = state.seats[seatB];
            if (!idA || !idB) return false;
            state.seats[seatA] = idB;
            state.seats[seatB] = idA;
            var bad = !deskGenderOk(seatA) || !deskGenderOk(seatB);
            state.seats[seatA] = idA;
            state.seats[seatB] = idB;
            return bad;
        }

        // 把剩余学生填进剩余座位:按桌(同桌单元)成组,优先凑出「符合性别规则」的
        // 两人组合;实在凑不出时,宁可让该桌空一半也不制造异性同桌。
        function placeStudentsGenderAware(seatIdxList, studentList) {
            if (!genderRuleMode) { placeStudentsInSeats(seatIdxList, studentList); return; }
            var pool = studentList.slice();
            var g = genderMap;
            function genderOf(st) { return g[st.id] || 'X'; }
            function okPair(x, y) {
                var gx = genderOf(x), gy = genderOf(y);
                if (gx === 'X' || gy === 'X') return true;   // 性别未知 ⇒ 不违规
                return genderRuleMode === 'mixed' ? (gx !== gy) : (gx === gy);
            }
            // 从 pool 里取出一对满足 okPair 的学生(取不到返回 null)
            function takePair() {
                for (var i = 0; i < pool.length; i++) {
                    for (var j = i + 1; j < pool.length; j++) {
                        if (okPair(pool[i], pool[j])) {
                            var pair = [pool[i], pool[j]];
                            pool.splice(j, 1); pool.splice(i, 1);
                            return pair;
                        }
                    }
                }
                return null;
            }

            // 按同桌单元分组:双座 [a,b] / 单座 [a]
            var units = [];
            var used = new Set();
            seatIdxList.forEach(function (idx) {
                if (used.has(idx)) return;
                var mate = findPairMate(idx, pairMap);
                if (mate !== null && mate !== undefined
                    && seatIdxList.indexOf(mate) >= 0 && !used.has(mate)) {
                    units.push([idx, mate]); used.add(idx); used.add(mate);
                } else {
                    units.push([idx]); used.add(idx);
                }
            });

            // 双座单元:优先整桌成对的合规组合
            var deferred = [];
            units.forEach(function (u) {
                if (u.length !== 2) return;
                var picked = takePair();
                if (picked) {
                    state.seats[u[0]] = picked[0].id;
                    state.seats[u[1]] = picked[1].id;
                } else {
                    deferred.push(u);     // 池里凑不出合规组合 ⇒ 只填一半
                }
            });

            // 单座单元 + 凑不出对的双座。
            // 分两轮填:先给每个单元填「第一座」(优先挑不违规的人),
            // 若还有学生没坐下,再回头填这些桌的「第二座」——
            // 「人人有座」优先于性别规则:留空只在学生确实不够坐时才发生。
            var leftovers = [];
            units.forEach(function (u) { if (u.length === 1) leftovers.push(u[0]); });
            deferred.forEach(function (u) { leftovers.push(u[0]); });

            function fill(seat) {
                if (pool.length === 0) return;
                var pick = -1;
                for (var i = 0; i < pool.length; i++) {
                    state.seats[seat] = pool[i].id;
                    if (deskGenderOk(seat)) { pick = i; break; }
                    state.seats[seat] = null;
                }
                if (pick < 0) { pick = 0; state.seats[seat] = pool[0].id; }
                pool.splice(pick, 1);
            }

            leftovers.forEach(fill);
            if (pool.length > 0) {
                deferred.forEach(function (u) { fill(u[1]); });
            }
        }

        // 辅助:检查两个学生是否构成回避配对
        // 性能优化:一次性构建 Set 索引(key 为排序后的 "idA|idB"),O(1) 查询;
        // 后处理最多 200 次 × 每对座位一次 swapCreatesAvoidPair 检查,
        // 原线性 some() 在 100 人班 + 25 对回避配对时接近 1s,Set 后为常数级。
        // 共用 makeAvoidChecker()(与 repairPairViolations 同一套 key 规范化)
        const isAvoided = makeAvoidChecker();

        // ==================== 第一步:处理强制配对 ====================
        const placedIds = new Set();
        const occupiedSeats = new Set();
        const availablePairs = pairs.filter(p => neededIndices.includes(p[0]) && neededIndices.includes(p[1]));
        const shuffledPairsForForced = shuffle(availablePairs.slice());

        state.forcedPairs.forEach(function (fpair) {
            var idA = fpair[0], idB = fpair[1];
            if (placedIds.has(idA) || placedIds.has(idB)) return;
            // 找一个未被占用的同桌 pair
            var pair = shuffledPairsForForced.find(function (p) {
                return !occupiedSeats.has(p[0]) && !occupiedSeats.has(p[1]);
            });
            if (!pair) return; // 没有可用同桌了
            state.seats[pair[0]] = idA;
            state.seats[pair[1]] = idB;
            placedIds.add(idA);
            placedIds.add(idB);
            occupiedSeats.add(pair[0]);
            occupiedSeats.add(pair[1]);
        });

        // ==================== 第二步:按模式分配剩余座位 ====================

        if (mode === 'random') {
            // 完全随机:剩余学生打乱后填入剩余座位
            // 注意:shuffle() 返回新数组(不原地修改),必须接住返回值
            const remainingSeats = neededIndices.filter(idx => !occupiedSeats.has(idx));
            const remainingStudents = shuffle(state.students.filter(s => !placedIds.has(s.id)));
            placeStudentsInSeats(remainingSeats, remainingStudents);
        } else {

            // mixed / samegender 模式
            // 过滤出尚未占用的同桌 pair
            const remainingPairs = availablePairs.filter(p => !occupiedSeats.has(p[0]) && !occupiedSeats.has(p[1]));

            if (mode === 'mixed') {
                // 男女同桌:优先在剩余 pairs 中放一男一女
                const pool = { M: [], F: [], X: [] };
                shuffle(state.students.filter(s => !placedIds.has(s.id))).forEach(function (s) {
                    pool[getGender(s)].push(s);
                });
                const shuffledPairs = shuffle(remainingPairs.slice());
                const placedSeatsFromPairs = [];

                shuffledPairs.forEach(function (pair) {
                    // 尝试一男一女
                    if (pool.M.length > 0 && pool.F.length > 0) {
                        var male = pool.M.shift();
                        var female = pool.F.shift();
                        // 回避配对检查
                        if (isAvoided(male.id, female.id)) {
                            // 尝试交换:把 female 放回去,取下一个
                            pool.F.unshift(female);
                            var found = false;
                            var attempts = 0;
                            while (pool.F.length > 0 && attempts < pool.F.length) {
                                female = pool.F.shift();
                                if (!isAvoided(male.id, female.id)) { found = true; break; }
                                pool.F.push(female);
                                attempts++;
                            }
                            if (!found) { pool.M.unshift(male); return; }
                        }
                        if (Math.random() < 0.5) {
                            state.seats[pair[0]] = male.id;
                            state.seats[pair[1]] = female.id;
                        } else {
                            state.seats[pair[0]] = female.id;
                            state.seats[pair[1]] = male.id;
                        }
                        placedIds.add(male.id);
                        placedIds.add(female.id);
                        occupiedSeats.add(pair[0]);
                        occupiedSeats.add(pair[1]);
                    }
                });

                // 收集尚未放置的座位和学生
                // 注意:shuffle() 返回新数组,必须接住返回值
                const remainingSeats = neededIndices.filter(idx => !occupiedSeats.has(idx));
                const remainingStudents = shuffle(state.students.filter(s => !placedIds.has(s.id)));
                // mixed 模式:剩余学生同样按「一男一女」成桌填,避免尾部随机破坏规则
                placeStudentsGenderAware(remainingSeats, remainingStudents);

            } else if (mode === 'samegender') {
                // 男女不同桌:每对 pair 放同性别
                const mPool = shuffle(state.students.filter(s => !placedIds.has(s.id) && getGender(s) === 'M'));
                const fPool = shuffle(state.students.filter(s => !placedIds.has(s.id) && getGender(s) === 'F'));
                const xPool = shuffle(state.students.filter(s => !placedIds.has(s.id) && getGender(s) === 'X'));
                const shuffledPairs = shuffle(remainingPairs.slice());

                shuffledPairs.forEach(function (pair) {
                    // 尝试两个男生
                    if (mPool.length >= 2 && (fPool.length < 2 || Math.random() < 0.5)) {
                        var m1 = mPool.shift();
                        var m2 = mPool.shift();
                        if (isAvoided(m1.id, m2.id)) {
                            mPool.unshift(m2); mPool.unshift(m1);
                            // 尝试女生
                            if (fPool.length >= 2) {
                                m1 = fPool.shift(); m2 = fPool.shift();
                                if (isAvoided(m1.id, m2.id)) { fPool.unshift(m2); fPool.unshift(m1); return; }
                            } else { return; }
                        }
                        state.seats[pair[0]] = m1.id;
                        state.seats[pair[1]] = m2.id;
                        placedIds.add(m1.id); placedIds.add(m2.id);
                        occupiedSeats.add(pair[0]); occupiedSeats.add(pair[1]);
                    } else if (fPool.length >= 2) {
                        var f1 = fPool.shift();
                        var f2 = fPool.shift();
                        if (isAvoided(f1.id, f2.id)) {
                            fPool.unshift(f2); fPool.unshift(f1);
                            if (mPool.length >= 2) {
                                f1 = mPool.shift(); f2 = mPool.shift();
                                if (isAvoided(f1.id, f2.id)) { mPool.unshift(f2); mPool.unshift(f1); return; }
                            } else { return; }
                        }
                        state.seats[pair[0]] = f1.id;
                        state.seats[pair[1]] = f2.id;
                        placedIds.add(f1.id); placedIds.add(f2.id);
                        occupiedSeats.add(pair[0]); occupiedSeats.add(pair[1]);
                    }
                });

                // 收集剩余座位和剩余学生
                // 注意:shuffle() 返回新数组,必须接住返回值
                const remainingSeats = neededIndices.filter(idx => !occupiedSeats.has(idx));
                const remainingStudents = shuffle(state.students.filter(s => !placedIds.has(s.id)));
                // samegender 模式:奇数落单的学生按「与同桌同性别」填,不再随机乱塞
                placeStudentsGenderAware(remainingSeats, remainingStudents);
            }
        } // end else (mixed / samegender)

        // ==================== 配对修复 ====================
        // 初始落座只保证了「强制配对尽量同桌」/「mixed·samegender 模式下的回避检查」,
        // random 模式完全没查回避。这里统一补一次修复:尝试 maxAttempts 次把
        // 强制/回避违规消掉;仍做不到就保留座位,由下面统一给提示。
        // 放在「换位后处理」之前 —— 后处理本身有 guard(强制配对学生不参与交换、
        // swapCreatesAvoidPair 防新增回避),不会把这里修好的结果又破坏掉。
        repairPairViolations({ pairMap: pairMap, maxAttempts: maxAttempts, shuffle: shuffle });

        // ==================== 后处理:确保每位学生都不在原来的座位 ====================
        // 收集哪些座位属于强制配对学生(不能被交换破坏)
        var forcedPairStudentIds = new Set();
        state.forcedPairs.forEach(function (fp) {
            forcedPairStudentIds.add(fp[0]);
            forcedPairStudentIds.add(fp[1]);
        });

        // 找出所有仍在原座位的学生(冲突)
        function findConflicts() {
            var conflicts = [];
            for (var i = 0; i < state.seats.length; i++) {
                if (state.seats[i] && prevSeatMap[state.seats[i]] === i) {
                    conflicts.push(i);
                }
            }
            return conflicts;
        }

        // 检查某座位是否是某学生的旧座位
        function wasOldSeat(studentId, seatIdx) {
            return prevSeatMap[studentId] === seatIdx;
        }

        // 检查两个学生交换后是否会产生回避配对同桌
        function swapCreatesAvoidPair(seatA, studentAId, seatB, studentBId) {
            // 找出 seatA 的同桌座位(共享 pairMap,O(1) 查询)
            var mateA = findPairMate(seatA, pairMap);
            var mateB = findPairMate(seatB, pairMap);
            // 交换后:studentBId 在 seatA,studentAId 在 seatB
            // 检查 seatA 的同桌
            if (mateA != null && state.seats[mateA] && state.seats[mateA] !== studentAId && state.seats[mateA] !== studentBId) {
                if (isAvoided(studentBId, state.seats[mateA])) return true;
            }
            // 检查 seatB 的同桌
            if (mateB != null && state.seats[mateB] && state.seats[mateB] !== studentAId && state.seats[mateB] !== studentBId) {
                if (isAvoided(studentAId, state.seats[mateB])) return true;
            }
            return false;
        }

        var conflicts = findConflicts();
        var attempts = 0;

        while (conflicts.length > 0 && attempts < maxAttempts) {
            attempts++;
            // 随机选一个冲突座位
            var ci = conflicts[Math.floor(Math.random() * conflicts.length)];
            var conflictId = state.seats[ci];

            // 强制配对学生不参与交换
            if (forcedPairStudentIds.has(conflictId)) {
                conflicts = conflicts.filter(function (c) { return c !== ci; });
                continue;
            }

            // 随机找一个交换目标
            var shuffledNeeded = shuffle(neededIndices.slice());
            var resolved = false;

            for (var si of shuffledNeeded) {
                if (si === ci) continue;
                var swapId = state.seats[si];
                if (!swapId) continue; // 空座位不交换
                if (forcedPairStudentIds.has(swapId)) continue; // 强制配对学生不交换

                // 交换后:conflictId → si, swapId → ci
                // 条件1: si 不是 conflictId 的旧座位
                if (wasOldSeat(conflictId, si)) continue;
                // 条件2: ci 不是 swapId 的旧座位(避免给 swapId 制造新冲突)
                if (wasOldSeat(swapId, ci)) continue;
                // 条件3: 不产生回避配对
                if (swapCreatesAvoidPair(ci, conflictId, si, swapId)) continue;
                // 条件4: 不破坏性别规则(男女同桌 / 男女不同桌)
                // —— 性别规则优先于「必须换座」:宁可让这名学生留在原座位,
                //    也不把已经合规的同桌拆成违规
                if (swapBreaksGender(ci, si)) continue;

                // 执行交换
                state.seats[ci] = swapId;
                state.seats[si] = conflictId;
                resolved = true;
                break;
            }

            if (!resolved) {
                // 尝试与空座位交换(如果有空座位的话)
                for (var si of shuffledNeeded) {
                    if (si === ci) continue;
                    if (state.seats[si]) continue; // 只找空座位
                    if (wasOldSeat(conflictId, si)) continue;
                    // 移到空座位(同样不能制造性别违规)
                    state.seats[si] = conflictId;
                    state.seats[ci] = null;
                    if (!deskGenderOk(si) || !deskGenderOk(ci)) {
                        state.seats[si] = null;
                        state.seats[ci] = conflictId;
                        continue;
                    }
                    resolved = true;
                    break;
                }
            }

            // 重新计算冲突
            conflicts = findConflicts();
        }

        // ==================== 性别规则收尾修复 ====================
        // 落座阶段与上面的换座阶段都可能留下少量违规(例如男女比例为奇数、或换座
        // 受性别 guard 限制没走完)。这里再做一轮**全班范围**的修复:
        // 不传 areaOf ⇒ 允许跨区互换,把残留的违规桌尽量消掉。
        // 优先级:性别规则 > 「不在原座位」(修复可能让个别学生回到原座位)。
        if (genderRuleMode) {
            adjustGenderRuleInGroups({
                mode: genderRuleMode,
                maxAttempts: Math.max(maxAttempts, 300),
                shuffle: shuffle
            });
            // 修复后重新统计仍在原座位的人数
            conflicts = findConflicts();
        }

        commit({ seats: state.seats });
        onGenerateSeats();

        // ==================== 结果自检 (#4 批次:失败 toast) ====================
        // 检测算法未达成目标的情况,通过 warnings 数组返回给调用方显示 toast,
        // 避免静默返回部分结果(原行为是 200 次跑完即退出,无任何提示)。
        var warnings = [];
        if (conflicts.length > 0) {
            // 仍有学生在原座位(可能是强制配对/无可交换目标,或是 maxAttempts 用尽)
            warnings.push(MESSAGES.RANDOM_WARNING_INCOMPLETE_SWAP(conflicts.length, maxAttempts));
        }
        // 检测是否有学生未入座(students > seats 极端场景)
        var placedCount = state.seats.filter(function (s) { return s; }).length;
        if (placedCount < state.students.length) {
            warnings.push(MESSAGES.RANDOM_WARNING_NOT_SEATED(state.students.length - placedCount));
        }
        // 配对设置最终仍未满足 ⇒ 保留座位并提示(先安排、后提示)
        var finalPair = computePairViolations(pairMap);
        if (finalPair.forcedBroken.length > 0 || finalPair.avoidBroken.length > 0) {
            warnings.push(MESSAGES.PAIR_UNSATISFIED(
                finalPair.forcedBroken.length, finalPair.avoidBroken.length));
        }
        // 性别规则最终仍未满足(男女比例为奇数等数学上做不到的情形)⇒ 如实提示
        if (genderRuleMode) {
            var finalGender = findGenderViolations(genderRuleMode, genderMap, pairMap);
            if (finalGender.length > 0) {
                warnings.push(MESSAGES.GENDER_RULE_UNSATISFIED(genderRuleMode, finalGender.length));
            }
        }
        return { warnings: warnings };
    }

    // ─────────── 分组轮换 ───────────
    //
    // 语义:以「分组建立顺序」为环,步长 offset(默认 +1)。分组 i 的学生轮换到
    // 分组 (i + offset) % n 当前所占的座位上。
    //
    // 两组成员人数不等时:本次实际轮换人数 m = min(源组人数, 目标组座位数),
    // 从源组随机挑 m 人、落进目标组随机 m 个座位。
    //
    // 硬约束(全程保持):
    //   1. 只重排「已入座且有所属分组」的学生;无分组的学生原地不动
    //   2. 总体占座数不增不减(纯置换)——用 newSeats 先腾空再回填,
    //      并做占座数自检
    //   3. 分组的 id / name / color 完全不变,变的是各组座位区里坐了谁
    //
    // leftover 兜底:由于 Σ|pool| = Σ|bucket| = N 且 i → (i+offset)%n 是索引置换,
    // 恒有 Σ未安置学生 == Σ空余座位。回填顺序:
    //   阶段 B1 — 优先让 leftover 学生回到「自己组」的空余座位(尽量保持聚类)
    //   阶段 B2 — 仍有剩余则洗牌后填满所有空余座位(保证硬约束 2)
    function rotateGroupSeats(offset, options) {
        options = options || {};
        var warnings = [];
        var n = state.groups.length;

        if (n < 2) {
            alert(MESSAGES.ROTATE_NO_GROUPS);
            return { warnings: [MESSAGES.ROTATE_NO_GROUPS_WARN], moved: 0 };
        }

        // 步长归一化:允许 > n 或 <= 0 的输入,统一折回 1..n-1
        offset = Math.floor(Number(offset) || 1);
        if (offset < 1 || offset > n - 1) {
            offset = ((offset % n) + n) % n;
            if (offset === 0) offset = 1;
        }

        // 学生 → 分组下标
        var groupIndex = new Map();
        state.groups.forEach(function (g, i) { groupIndex.set(g.id, i); });
        var studentGroup = new Map();
        state.students.forEach(function (s) {
            if (s.groupId && groupIndex.has(s.groupId)) studentGroup.set(s.id, groupIndex.get(s.groupId));
        });

        // pool[i]  — 分组 i 当前占据的座位下标
        // bucket[i] — 分组 i 当前已入座的学生 id
        var pool = [];
        var bucket = [];
        for (var i = 0; i < n; i++) { pool.push([]); bucket.push([]); }

        var groupedSeatIdxs = [];
        for (var idx = 0; idx < state.seats.length; idx++) {
            var sid = state.seats[idx];
            if (!sid) continue;
            var gi = studentGroup.get(sid);
            if (gi === undefined) continue;         // 无分组 → 原地不动
            groupedSeatIdxs.push(idx);
            pool[gi].push(idx);
            bucket[gi].push(sid);
        }

        var seatedGrouped = groupedSeatIdxs.length;
        if (seatedGrouped === 0) {
            alert(MESSAGES.ROTATE_NO_SEATED);
            return { warnings: [MESSAGES.ROTATE_NO_SEATED_WARN], moved: 0 };
        }

        if (!confirm(MESSAGES.CONFIRM_ROTATE(offset, n))) return { warnings: [], moved: 0 };

        onPushSnapshot('rotate');

        // newSeats:先复制(保留无分组学生的原位),再把分组学生的座位腾空
        // 轮换前的占座总数,用于事后自检(不能新增 / 不能缩减)
        var originalPlaced = state.seats.filter(function (x) { return x; }).length;

        // newSeats:先复制(保留无分组学生的原位),再把分组学生的座位腾空
        var newSeats = state.seats.slice();
        groupedSeatIdxs.forEach(function (k) { newSeats[k] = null; });

        // 剩余可用座位/未安置学生,按组分桶
        var freeSeats = pool.map(function (p) { return shuffle(p.slice()); });
        var pending = bucket.map(function (b) { return shuffle(b.slice()); });
        var moved = 0;

        // ── 阶段 A:分组 i 的学生 → 分组 (i+offset)%n 的座位 ──
        for (var s = 0; s < n; s++) {
            var d = (s + offset) % n;
            var m = Math.min(pending[s].length, freeSeats[d].length);
            for (var k2 = 0; k2 < m; k2++) {
                newSeats[freeSeats[d][k2]] = pending[s][k2];
                moved++;
            }
            pending[s] = pending[s].slice(m);
            freeSeats[d] = freeSeats[d].slice(m);
        }

        // ── 溢出快照(必须在 B1/B2 消费 pending 之前取)──
        // 源组人数 > 目标组座位数时,随机多出来、没能轮换的这批学生,
        // 之后要改归「即将轮换到本组座位的上游组」= (s - offset + n) % n ——
        // 也就是占了他们原来座位的那个组(落单学生跟着那个组走)。
        var overflowBySrc = [];
        for (var ov = 0; ov < n; ov++) {
            overflowBySrc.push(pending[ov].slice());
        }

        // ── 阶段 B1:leftover 优先回到自己组的空余座位 ──
        for (var b1 = 0; b1 < n; b1++) {
            var mb = Math.min(pending[b1].length, freeSeats[b1].length);
            for (var k3 = 0; k3 < mb; k3++) {
                newSeats[freeSeats[b1][k3]] = pending[b1][k3];
                moved++;
            }
            pending[b1] = pending[b1].slice(mb);
            freeSeats[b1] = freeSeats[b1].slice(mb);
        }

        // ── 阶段 B2:剩余学生洗牌填满剩余空位(保证占座总数不变) ──
        var restStudents = [];
        var restSeats = [];
        for (var b2 = 0; b2 < n; b2++) {
            restStudents = restStudents.concat(pending[b2]);
            restSeats = restSeats.concat(freeSeats[b2]);
        }
        if (restStudents.length !== restSeats.length) {
            // 理论上不会发生(索引置换保证两侧相等);真出现说明状态被外部改动,
            // 直接中止以免写出座位丢失/重复的坏数据
            console.error('[rotateGroupSeats] 学生/座位不匹配', restStudents.length, restSeats.length);
            return { warnings: ['轮换中止:数据不一致'], moved: 0 };
        }
        restStudents = shuffle(restStudents);
        for (var k4 = 0; k4 < restStudents.length; k4++) {
            newSeats[restSeats[k4]] = restStudents[k4];
            moved++;
        }

        // 就地写回,保持 state.seats 引用不变(避免打断主 IIFE 的 currentSeats 别名)
        for (var w = 0; w < newSeats.length; w++) {
            state.seats[w] = newSeats[w];
        }

        // 自检:占座总数必须与轮换前完全一致(不能新增、不能缩减)
        var afterPlaced = state.seats.filter(function (x) { return x; }).length;
        if (afterPlaced !== originalPlaced) {
            warnings.push('占座总数异常(' + originalPlaced + ' → ' + afterPlaced + ')');
        }
        // 自检:每个学生最多占一个座位(无重复)
        var seen = new Set();
        var dup = 0;
        for (var q = 0; q < state.seats.length; q++) {
            if (!state.seats[q]) continue;
            if (seen.has(state.seats[q])) dup++;
            seen.add(state.seats[q]);
        }
        if (dup > 0) warnings.push('出现重复占座(' + dup + '处)');

        // ── 溢出学生改归上游组 ──
        // 这些学生没挤进目标组的座位,而自己原来的座位区已被上游组占据,
        // 因此让他们「跟着占了其座位的上游组走」,保持分组与所在座位区一致。
        var reassignTotal = 0;
        var fromNames = [];
        var toNames = [];
        for (var rs = 0; rs < n; rs++) {
            var oList = overflowBySrc[rs];
            if (!oList || oList.length === 0) continue;
            var upIdx = (rs - offset + n) % n;
            var upGroup = state.groups[upIdx];
            var srcGroup = state.groups[rs];
            if (!upGroup) continue;
            (function (gid) {
                oList.forEach(function (sid) {
                    var stu = state.students.find(function (x) { return x.id === sid; });
                    if (stu) stu.groupId = gid;
                });
            })(upGroup.id);
            reassignTotal += oList.length;
            if (srcGroup && fromNames.indexOf(srcGroup.name) < 0) fromNames.push(srcGroup.name);
            if (toNames.indexOf(upGroup.name) < 0) toNames.push(upGroup.name);
        }
        if (reassignTotal > 0) {
            warnings.push(MESSAGES.ROTATE_OVERFLOW_REGROUP(
                reassignTotal,
                fromNames.join('、'),
                toNames.join('、')
            ));
            commit({ students: state.students });
        }

        // ── 配对修复(仅限同区换座)──
        // 轮换的语义是「谁坐进哪个组的座位区」,区内具体坐哪把椅子不影响轮换结果。
        // 因此把换座范围限定在同区,既修好配对,又保持各区人数分布与轮换语义不变。
        var seatArea = new Array(state.seats.length).fill(-1);
        for (var ai2 = 0; ai2 < n; ai2++) {
            (function (area) {
                pool[area].forEach(function (idx) { seatArea[idx] = area; });
            })(ai2);
        }
        var finalPairRot = repairPairViolations({
            pairMap: getDeskMatePairs().pairMap,
            maxAttempts: 200,
            shuffle: shuffle,
            candidateSeatsOf: function (from) {
                var a = seatArea[from];
                return a >= 0 ? pool[a] : [];
            }
        });
        if (finalPairRot.forcedBroken.length > 0 || finalPairRot.avoidBroken.length > 0) {
            warnings.push(MESSAGES.PAIR_UNSATISFIED(
                finalPairRot.forcedBroken.length, finalPairRot.avoidBroken.length));
        }

        // ── 性别规则后处理(轮换 + 男女同桌/不同桌 同时开启时)──
        // 顺序:先完成小组轮换,再在全班范围内检测性别规则;
        // 但调整只能在「该座位所属小组座位区」内部进行 —— 任何学生都不会被挪到
        // 别的小组座位区域。确实做不到就保留原样并提示。
        var genderResult = null;
        if (options.genderMode === 'mixed' || options.genderMode === 'samegender') {
            genderResult = adjustGenderRuleInGroups({
                mode: options.genderMode,
                areaOf: function (idx) { return seatArea[idx]; },
                maxAttempts: options.genderMaxAttempts || 300,
                shuffle: shuffle
            });
            if (genderResult.remaining.length > 0) {
                warnings.push(MESSAGES.GENDER_RULE_PARTIAL(
                    options.genderMode, genderResult.remaining.length));
            }
        }

        commit({ seats: state.seats });
        onGenerateSeats();
        return { warnings: warnings, moved: moved, gender: genderResult };
    }

    return {
        randomSeatArrange,
        rotateGroupSeats,
        // 配对设置:满足情况检测(供 UI 着色)与修复
        getPairStatus,
        computePairViolations,
        // 性别规则(男女同桌 / 男女不同桌):检测 + 组内调整
        buildGenderMap,
        findGenderViolations,
        adjustGenderRuleInGroups,
        // 导出 helper 供单元测试使用(#16 批次)
        getDeskMatePairs,
        findPairMate,
        getGender
    };
}