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

export function createRandomArrange(deps) {
    const { helpers, callbacks } = deps;
    const { shuffle } = helpers;
    const { onPushSnapshot, onGenerateSeats } = callbacks;

    // ─────────── 模块私有 helpers ───────────

    // 获取所有同桌对(同 row、相邻 col、中间无走道)和单独座位
    function getDeskMatePairs() {
        const pairs = [];     // [[idx1, idx2], ...] 同桌对
        const singles = [];   // 无法配对的单独座位索引
        for (let r = 0; r < state.rows; r++) {
            let c = 0;
            while (c < state.cols) {
                const idx = r * state.cols + c;
                if (c + 1 < state.cols) {
                    // 检查 c 和 c+1 之间是否有走道
                    const aisle = state.aisles.find(a => a.afterCol === c + 1);
                    if (!aisle) {
                        // 无走道 → 同桌
                        pairs.push([idx, idx + 1]);
                        c += 2;
                        continue;
                    }
                }
                singles.push(idx);
                c += 1;
            }
        }
        return { pairs: pairs, singles: singles };
    }

    // 判断学生性别(无性别信息视为中性 wildcard)
    function getGender(s) {
        if (s.gender === 'male') return 'M';
        if (s.gender === 'female') return 'F';
        return 'X'; // unknown / wildcard
    }

    // ─────────── 入口函数 ───────────

    function randomSeatArrange(mode) {
        if (state.students.length === 0) {
            alert('请先导入学生名单！');
            return;
        }
        if (!confirm('确定要执行「' + ({random:'完全随机', mixed:'男女同桌', samegender:'男女不同桌'}[mode]) + '」排座吗？')) return;

        // 保存旧座位映射(学生ID → 旧座位索引),用于后处理确保完全换座
        var prevSeatMap = {};
        for (var i = 0; i < state.seats.length; i++) {
            if (state.seats[i]) prevSeatMap[state.seats[i]] = i;
        }

        onPushSnapshot();
        state.seats = Array(state.rows * state.cols).fill(null);

        const totalSeats = state.rows * state.cols;
        const seatCount = Math.min(state.students.length, totalSeats);

        // 获取同桌对结构(所有模式共用,random 模式也需要处理 forcedPairs)
        const { pairs, singles } = getDeskMatePairs();
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
            // 找出 seatA 的同桌座位
            var mateA = findDeskMateSeat(seatA);
            var mateB = findDeskMateSeat(seatB);
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

        // 找某座位的同桌座位
        function findDeskMateSeat(seatIdx) {
            for (var pi = 0; pi < pairs.length; pi++) {
                if (pairs[pi][0] === seatIdx) return pairs[pi][1];
                if (pairs[pi][1] === seatIdx) return pairs[pi][0];
            }
            return null;
        }

        var conflicts = findConflicts();
        var maxAttempts = 200;
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
    }

    return {
        randomSeatArrange
    };
}