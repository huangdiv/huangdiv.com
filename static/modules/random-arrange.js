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

    // ─────────── 入口函数 ───────────

    function randomSeatArrange(mode, options) {
        // #5 批次:options.maxAttempts 允许调用方覆盖默认尝试次数(从 localStorage 或 UI 读)。
        options = options || {};
        var maxAttempts = (typeof options.maxAttempts === 'number' && options.maxAttempts > 0)
            ? Math.floor(options.maxAttempts)
            : 200;

        if (state.students.length === 0) {
            alert(MESSAGES.NO_STUDENTS_YET);
            return { warnings: [MESSAGES.NO_STUDENTS_YET_WARN] };
        }
        if (!confirm(MESSAGES.CONFIRM_RANDOM_MODE(mode))) return { warnings: [] };

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

        // 辅助:检查两个学生是否构成回避配对
        // 性能优化:一次性构建 Set 索引(key 为排序后的 "idA|idB"),O(1) 查询;
        // 后处理最多 200 次 × 每对座位一次 swapCreatesAvoidPair 检查,
        // 原线性 some() 在 100 人班 + 25 对回避配对时接近 1s,Set 后为常数级。
        const avoidKeySet = new Set();
        state.avoidPairs.forEach(function (p) {
            if (!p || p.length < 2) return;
            // key 规范化:两个 id 按字典序排序,保证 (A,B) 与 (B,A) 命中同一 key
            const k = p[0] < p[1] ? p[0] + '|' + p[1] : p[1] + '|' + p[0];
            avoidKeySet.add(k);
        });
        function isAvoided(idA, idB) {
            if (avoidKeySet.size === 0) return false;
            const k = idA < idB ? idA + '|' + idB : idB + '|' + idA;
            return avoidKeySet.has(k);
        }

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
                placeStudentsInSeats(remainingSeats, remainingStudents);

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
                placeStudentsInSeats(remainingSeats, remainingStudents);
            }
        } // end else (mixed / samegender)

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
                    // 移到空座位
                    state.seats[si] = conflictId;
                    state.seats[ci] = null;
                    resolved = true;
                    break;
                }
            }

            // 重新计算冲突
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

        commit({ seats: state.seats });
        onGenerateSeats();
        return { warnings: warnings, moved: moved };
    }

    return {
        randomSeatArrange,
        rotateGroupSeats,
        // 导出 helper 供单元测试使用(#16 批次)
        getDeskMatePairs,
        findPairMate,
        getGender
    };
}