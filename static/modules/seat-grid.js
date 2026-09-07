// modules/seat-grid.js
// ─────────────────────────────────────────────────────────────────────────────
// 座位网格渲染模块(座标计算 + DOM 渲染 + 统计)
//
// 职责:
//   1. generateSeats()            — 主入口:重渲染整个教室座位
//   2. generateGridTemplateColumns() — 计算 CSS grid 列模板(含走道)
//   3. updateStatistics()         — 头部统计卡(总数 / 已排 / 未排)
//   4. updateCheckinStats()       — 签到模式下的进度条与统计
//
// 依赖(通过 deps 传入,不在模块内隐式引用主 IIFE 内部变量):
//   - classroom      — 主 IIFE 缓存的 #classroom DOM 节点
//   - getView()      — 懒读取当前视角模式('teacher' / 'student'),返回布尔表示教师视角
//   - helpers        — { escapeHtml, adjustColor, isLightColor, getStudentById, getStudentGroupColor }
//   - callbacks      — { onUpdateToggleIconsBtnText, onToggleCheckinMode,
//                        onPushSnapshot, onGenerateStudentList, onAutoSave }
//
// 读路径:全部从 state(./state.js)直读,不走顶层 let 别名,path-A2 等价行为。
// 写路径:`state.students[i].checkedIn = ...` 是 in-place 字段变更,state.students
// 引用未变,不需 commit;行为与原代码一致(原代码也未在 banner 按钮里 commit)。
//
// P1 批次4:#1 generateSeats diff — 全量 innerHTML 重建改造为「结构键触发全量重建、
// 其余 per-seat diff」持久化方案。click 事件已委托给 #classroom 或父容器,持久化
// 节点无 per-seat 监听器泄露风险。
// ─────────────────────────────────────────────────────────────────────────────

import { state } from './state.js';

export function createSeatGrid(deps) {
    const { classroom, getView, helpers, callbacks } = deps;

    const {
        escapeHtml,
        adjustColor,
        isLightColor,
        getStudentById,
        getStudentGroupColor
    } = helpers;

    const {
        onUpdateToggleIconsBtnText,
        onToggleCheckinMode,
        onPushSnapshot,
        onGenerateStudentList,
        onAutoSave
    } = callbacks;

    // ─────────── 持久化缓存(persistent 节点 + 上次渲染快照) ───────────
    // seatNodes[i] 为 seatIndex=i 的持久 DOM 节点,跨 generateSeats 多次调用复用。
    //   元素本身不释放,只更新属性 / innerHTML / className。
    // seatStateCache[i] 为该座位「上次渲染时的关键状态」,用于 diff 比较。
    //   字段:studentId / checkedIn / groupColor / showIcons(结构对齐用,跨 render 不变)
    const seatNodes = [];
    const seatStateCache = [];
    let lastStructureKey = '';
    // 上次 DOM 中插入的「讲台 + 走道 + 模式 banner」附加元素的占位信息:
    //   - 教师视角 / 学生视角 讲台分别只能存在一个
    //   - 模式 banner(签到 / 分组)互斥,仅在当前模式存在,渲染一次即可
    let modeBannerNode = null;

    // ─────────── 4 个导出函数 ───────────

    function generateSeats() {
        onUpdateToggleIconsBtnText();
        classroom.style.gridTemplateColumns = generateGridTemplateColumns();

        const newStructureKey = computeStructureKey();
        const totalSeats = state.rows * state.cols;
        // 结构键变化 OR 座位总数变化(行/列重新组合) ⇒ 全量重建 DOM
        const structureChanged = newStructureKey !== lastStructureKey
            || seatNodes.length !== totalSeats;

        if (structureChanged) {
            fullRebuildSeats(totalSeats);
            lastStructureKey = newStructureKey;
        } else {
            diffUpdateSeats(totalSeats);
        }

        classroom.classList.toggle('checkin-mode', state.isCheckinMode);
        onGenerateStudentList();
        updateStatistics();
        updateCheckinStats();
        onAutoSave();
    }

    // ─────────── 结构键:决定是否需要全量重建 DOM ───────────
    function computeStructureKey() {
        // 变更任一字段都会改变「DOM 节点总数 / DOM 顺序 / 节点外观」
        // 行 × 列  — 座位总数变,必须重建(append 顺序)
        // view 视角 — 学生视角从左到右、教师视角从右到左,节点顺序镜像
        // isCheckinMode — 增加签到 banner + 切走道 padding
        // isGroupMode   — 增加分组 banner(与签到互斥)
        // aislesSig — 走道在网格模板列中的位置 / 宽度;位置变化 ⇒ 节点顺序变
        // showStudentIcons — 仅节点 innerHTML 内容差异,理论上可走 diff;
        //                    但归到结构键统一处理更简单,且切换频率极低,代价可忽略
        const aislesSig = state.aisles
            .slice()
            .sort((a, b) => a.afterCol - b.afterCol)
            .map(a => a.afterCol + ':' + a.width)
            .join(',');
        return [
            state.rows,
            state.cols,
            getView() ? 'T' : 'S',
            state.isCheckinMode ? 'C' : (state.isGroupMode ? 'G' : ''),
            state.showStudentIcons ? 'I' : '',
            aislesSig
        ].join('|');
    }

    // ─────────── 全量重建(初始 / 结构变化时) ───────────
    function fullRebuildSeats(totalSeats) {
        classroom.innerHTML = '';
        seatNodes.length = 0;
        seatStateCache.length = 0;
        modeBannerNode = null;

        // 模式 banner 置于顶端(签到 / 分组互斥)
        if (state.isCheckinMode) {
            modeBannerNode = buildCheckinBanner();
            classroom.appendChild(modeBannerNode);
        } else if (state.isGroupMode) {
            modeBannerNode = buildGroupBanner();
            classroom.appendChild(modeBannerNode);
        }

        // 学生视角讲台置于开头(座位前)
        if (!getView()) {
            classroom.appendChild(buildTeacherDesk(false));
        }

        // 渲染全部座位(节点持久化保留入 seatNodes)
        for (let row = 0; row < state.rows; row++) {
            for (let col = 0; col < state.cols; col++) {
                const { seatIndex, actualCol } = resolveSeatCoord(row, col);
                const seat = createSeatNode(seatIndex);
                applySeatFullRender(seat, seatIndex);   // 计算 innerHTML / className / 颜色
                seatNodes.push(seat);
                seatStateCache.push(takeSeatSnapshot(seatIndex));
                classroom.appendChild(seat);

                // 走道占位(若此列后有走道)
                const checkCol = getView() ? actualCol : (col + 1);
                const aisle = state.aisles.find(a => a.afterCol === checkCol);
                if (aisle) {
                    const aislePh = document.createElement('div');
                    aislePh.className = 'aisle-placeholder';
                    classroom.appendChild(aislePh);
                }
            }
        }

        // 教师视角讲台置于末尾(座位后)
        if (getView()) {
            classroom.appendChild(buildTeacherDesk(true));
        }
    }

    // ─────────── diff 更新(结构未变化时) ───────────
    function diffUpdateSeats(totalSeats) {
        const showIcons = state.showStudentIcons;
        for (let i = 0; i < totalSeats; i++) {
            const cached = seatStateCache[i];
            const seat = seatNodes[i];
            // 该座位被迁移了?totalSeats 增加 ⇒ cached 缺失 ⇒ 不在 diff 范围(由全量重建路径处理)
            if (!cached || !seat) continue;

            const newStudentId = state.seats[i] || null;
            const cachedStudentId = cached.studentId;

            // 学生 ID 变化 ⇒ 内层 innerHTML / className / 颜色全套更新
            if (newStudentId !== cachedStudentId) {
                applySeatFullRender(seat, i);
                seatStateCache[i] = takeSeatSnapshot(i);
                continue;
            }

            // 学生 ID 相同 ⇒ 仅需比较 checkedIn / groupColor 这两个独立维度
            const student = newStudentId ? getStudentById(newStudentId) : null;
            const newCheckedIn = !!(student && student.checkedIn);
            if (newCheckedIn !== cached.checkedIn) {
                applySeatCheckinClass(seat, i, newCheckedIn);
                cached.checkedIn = newCheckedIn;
            }

            if (showIcons !== cached.showIcons) {
                // innerHTML 中的图标区间需要随开关切换整段重写
                renderSeatInner(seat, i, showIcons);
                cached.showIcons = showIcons;
            }

            const newGroupColor = newStudentId ? (getStudentGroupColor(newStudentId) || '') : '';
            if (newGroupColor !== (cached.groupColor || '')) {
                applySeatGroupColor(seat, newStudentId, newGroupColor);
                cached.groupColor = newGroupColor;
            }
        }
    }

    // ─────────── 工具函数 ───────────
    function resolveSeatCoord(row, col) {
        if (getView()) {
            const actualRow = state.rows - 1 - row;
            const actualCol = state.cols - 1 - col;
            return { seatIndex: actualRow * state.cols + actualCol, actualCol };
        }
        return { seatIndex: row * state.cols + col, actualCol: col };
    }

    function createSeatNode(seatIndex) {
        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.setAttribute('data-index', seatIndex);
        return seat;
    }

    function buildTeacherDesk(isTeacherView) {
        const desk = document.createElement('div');
        desk.className = 'teacher-desk' + (isTeacherView ? ' teacher-view' : '');
        desk.textContent = '讲台';
        return desk;
    }

    function buildCheckinBanner() {
        const banner = document.createElement('div');
        banner.className = 'mode-banner checkin-banner visible';
        banner.innerHTML =
            '<span class="mode-banner-icon">✓</span>' +
            '<span>签到模式 — 点击座位签到/取消签到</span>' +
            '<button class="mode-banner-btn" id="resetCheckinBtn">重新签到</button>' +
            '<button class="mode-banner-btn" id="allCheckinBtn">全部签到</button>' +
            '<button class="mode-banner-close">×</button>';
        banner.querySelector('.mode-banner-close').addEventListener('click', function (e) {
            e.stopPropagation();
            if (state.isCheckinMode) onToggleCheckinMode();
        });
        banner.querySelector('#resetCheckinBtn').addEventListener('click', function (e) {
            e.stopPropagation();
            onPushSnapshot('checkin');
            state.students.forEach(s => s.checkedIn = false);
            generateSeats();
        });
        banner.querySelector('#allCheckinBtn').addEventListener('click', function (e) {
            e.stopPropagation();
            onPushSnapshot('checkin');
            state.students.forEach(s => s.checkedIn = true);
            generateSeats();
        });
        return banner;
    }

    // 分组模式 banner — 与签到 banner 同款(顶部横幅 + 图标 + 按钮 + 关闭),
    // 风格统一;内容壳子在此构建,分组列表/选中计数由主 IIFE 的
    // renderGroupModeList() / updateGroupModeCount() 按 id 回填。
    function buildGroupBanner() {
        const banner = document.createElement('div');
        banner.className = 'mode-banner group-banner visible';
        banner.innerHTML =
            '<span class="mode-banner-icon">👥</span>' +
            '<span>分组模式 — 点击座位多选学生,再点分组按钮分配</span>' +
            '<span class="group-mode-count" id="groupModeCount">已选 0 名学生</span>' +
            '<div class="group-mode-list" id="groupModeList"></div>' +
            '<button class="mode-banner-btn" id="groupModeNewBtn">＋新建分组并分配</button>' +
            '<button class="mode-banner-close" id="groupModeExitBtn">×</button>';
        return banner;
    }

    // 应用「该 seat 完整渲染」:className + data-student + 内层 innerHTML + 背景色
    // 用于:全量重建 或 某座位 studentId 发生变化
    function applySeatFullRender(seat, seatIndex) {
        const studentId = state.seats[seatIndex];
        const student = studentId ? getStudentById(studentId) : null;
        const isCheckedIn = !!(student && student.checkedIn);
        let seatClass = studentId ? 'seat' : 'seat empty';
        if (studentId && state.isCheckinMode) {
            seatClass += isCheckedIn ? ' checked-in' : ' not-checked-in';
        }
        seat.className = seatClass;
        seat.setAttribute('data-student', studentId || '');

        // 内层 + 背景色 + draggable
        renderSeatInner(seat, seatIndex, state.showStudentIcons);
        applySeatGroupColor(seat, studentId, studentId ? (getStudentGroupColor(studentId) || '') : '');
        // 仅非签到模式且非触屏才可拖
        seat.draggable = !!(studentId && !state.isTouchDevice && !state.isCheckinMode);
    }

    // 仅更新签到 class(用于 ID 不变但 checkedIn 切换)
    function applySeatCheckinClass(seat, seatIndex, isCheckedIn) {
        const studentId = state.seats[seatIndex];
        let cls = studentId ? 'seat' : 'seat empty';
        if (studentId && state.isCheckinMode) {
            cls += isCheckedIn ? ' checked-in' : ' not-checked-in';
        }
        seat.className = cls;
    }

    // 仅更新分组背景 / 边框 / 文字色(纯样式,不重建 innerHTML)
    function applySeatGroupColor(seat, studentId, groupColor) {
        if (!studentId || !groupColor) {
            seat.style.backgroundColor = '';
            seat.style.borderColor = '';
            seat.style.color = '';
            return;
        }
        seat.style.backgroundColor = groupColor;
        seat.style.borderColor = adjustColor(groupColor, -30);
        seat.style.color = isLightColor(groupColor) ? '#000' : '#fff';
    }

    // 渲染 seat 内层 HTML(座位号 / 学生名 / icons / 删除按钮 / 「空」占位)
    function renderSeatInner(seat, seatIndex, showIcons) {
        const studentId = state.seats[seatIndex];
        const student = studentId ? getStudentById(studentId) : null;
        const displayRow = Math.floor(seatIndex / state.cols) + 1;
        const displayCol = (seatIndex % state.cols) + 1;

        if (studentId) {
            const displayName = student ? student.name : '';
            const deleteBtnHtml = state.isCheckinMode ? '' : '<button class="seat-delete-btn" title="删除学生">×</button>';
            let iconsHtml = '';
            if (showIcons && student) {
                const icons = [];
                if (student.gender === 'male') {
                    icons.push({ emoji: '♂', title: '男' });
                } else if (student.gender === 'female') {
                    icons.push({ emoji: '♀', title: '女' });
                }
                if (student.tags && student.tags.length > 0) {
                    student.tags.forEach(function (tag) {
                        icons.push({
                            emoji: tag.emoji || '🏷',
                            title: tag.label
                        });
                    });
                }
                if (icons.length > 0) {
                    iconsHtml = '<span class="seat-icons">' + icons.map(function (ic) {
                        return '<span class="seat-icon" title="' + escapeHtml(ic.title) + '">' + escapeHtml(ic.emoji) + '</span>';
                    }).join('') + '</span>';
                }
            }
            seat.innerHTML =
                '<span class="seat-number">' + displayRow + '排' + displayCol + '列</span>' +
                '<span class="seat-name">' + escapeHtml(displayName) + '</span>' +
                iconsHtml +
                deleteBtnHtml;
        } else {
            seat.innerHTML =
                '<span class="seat-number">' + displayRow + '排' + displayCol + '列</span>' +
                '<span class="seat-name" style="color: #999;">空</span>';
        }
    }

    function takeSeatSnapshot(seatIndex) {
        const studentId = state.seats[seatIndex] || null;
        const student = studentId ? getStudentById(studentId) : null;
        const isCheckedIn = !!(student && student.checkedIn);
        return {
            studentId,
            checkedIn: isCheckedIn,
            groupColor: studentId ? (getStudentGroupColor(studentId) || '') : '',
            showIcons: state.showStudentIcons
        };
    }

    // 生成网格列模板(包含走道)
    // 教师视角:网格列模板从右向左构建,走道位置通过 cols - afterCol 映射
    function generateGridTemplateColumns() {
        let template = '';

        if (getView()) {
            // 教师视角:需要镜像,从右向左遍历
            for (let i = state.cols; i >= 1; i--) {
                template += 'var(--seat-width) ';

                // 检查是否需要在此列后添加走道(镜像位置)
                // 镜像公式:如果走道在学生视角的第X列后,教师视角在第(cols-X)列后
                const aisle = state.aisles.find(a => a.afterCol === i - 1);
                if (aisle) {
                    template += `${aisle.width}px `;
                }
            }
        } else {
            // 学生视角:正常从左到右遍历
            for (let i = 1; i <= state.cols; i++) {
                template += 'var(--seat-width) ';

                // 检查是否需要在此列后添加走道
                const aisle = state.aisles.find(a => a.afterCol === i);
                if (aisle) {
                    template += `${aisle.width}px `;
                }
            }
        }

        return template.trim();
    }


    // 更新统计信息
    function updateStatistics() {
        const total = state.students.length;
        const assigned = state.seats.filter(seat => seat !== null).length;
        const unassigned = total - assigned;

        document.getElementById('totalStudents').textContent = total;
        document.getElementById('assignedStudents').textContent = assigned;
        document.getElementById('unassignedStudents').textContent = unassigned;
    }

    // 更新签到统计
    function updateCheckinStats() {
        const assignedIds = new Set(state.seats.filter(s => s !== null));
        const assigned = assignedIds.size;
        const assignedStudents = state.students.filter(s => assignedIds.has(s.id));
        const checkedIn = assignedStudents.filter(s => s.checkedIn).length;
        const notCheckedIn = assigned - checkedIn;
        const rate = assigned > 0 ? Math.round((checkedIn / assigned) * 100) : 0;

        const rateEl = document.getElementById('checkinRate');
        const progressBar = document.getElementById('checkinProgressBar');

        if (rateEl) rateEl.textContent = rate + '%';
        if (progressBar) progressBar.style.width = rate + '%';

        if (state.isCheckinMode) {
            const assignedEl = document.getElementById('assignedStudentsCheckin');
            const checkedInEl = document.getElementById('checkedInCount');
            const notCheckedInEl = document.getElementById('notCheckedInCount');

            if (assignedEl) assignedEl.textContent = assigned;
            if (checkedInEl) checkedInEl.textContent = checkedIn;
            if (notCheckedInEl) notCheckedInEl.textContent = notCheckedIn;
        }
    }

    return {
        generateSeats,
        generateGridTemplateColumns,
        updateStatistics,
        updateCheckinStats
    };
}
