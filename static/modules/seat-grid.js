// modules/seat-grid.js
// ─────────────────────────────────────────────────────────────────────────────
// 座位网格渲染模块(座标计算 + DOM 渲染 + 统计)
//
// 职责:
//   1. generateSeats()            — 主入口:重渲染整个 7×7 教室座位
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

    // ─────────── 4 个导出函数 ───────────

    function generateSeats() {
        onUpdateToggleIconsBtnText();
        classroom.style.gridTemplateColumns = generateGridTemplateColumns();
        classroom.innerHTML = '';

        if (state.isCheckinMode) {
            const banner = document.createElement('div');
            banner.className = 'checkin-banner visible';
            banner.innerHTML =
                '<span class="checkin-banner-icon">✓</span>' +
                '<span>签到模式 — 点击座位签到/取消签到</span>' +
                '<button class="checkin-banner-btn" id="resetCheckinBtn">重新签到</button>' +
                '<button class="checkin-banner-btn" id="allCheckinBtn">全部签到</button>' +
                '<button class="checkin-banner-close">×</button>';
            classroom.appendChild(banner);
            banner.querySelector('.checkin-banner-close').addEventListener('click', function (e) {
                e.stopPropagation();
                if (state.isCheckinMode) onToggleCheckinMode();
            });
            banner.querySelector('#resetCheckinBtn').addEventListener('click', function (e) {
                e.stopPropagation();
                onPushSnapshot();
                state.students.forEach(s => s.checkedIn = false);
                generateSeats();
            });
            banner.querySelector('#allCheckinBtn').addEventListener('click', function (e) {
                e.stopPropagation();
                onPushSnapshot();
                state.students.forEach(s => s.checkedIn = true);
                generateSeats();
            });
        }

        if (!getView()) {
            const desk = document.createElement('div');
            desk.className = 'teacher-desk';
            desk.textContent = '讲台';
            classroom.appendChild(desk);
        }

        for (let row = 0; row < state.rows; row++) {
            for (let col = 0; col < state.cols; col++) {
                let seatIndex;
                let actualCol;

                if (getView()) {
                    const actualRow = state.rows - 1 - row;
                    actualCol = state.cols - 1 - col;
                    seatIndex = actualRow * state.cols + actualCol;
                } else {
                    actualCol = col;
                    seatIndex = row * state.cols + col;
                }

                const seat = document.createElement('div');
                const studentId = state.seats[seatIndex];
                const student = studentId ? getStudentById(studentId) : null;
                const isCheckedIn = student && student.checkedIn;
                let seatClass = studentId ? 'seat' : 'seat empty';
                if (isCheckedIn) seatClass += ' checked-in';
                else if (studentId && state.isCheckinMode) seatClass += ' not-checked-in';
                seat.className = seatClass;
                seat.setAttribute('data-index', seatIndex);
                seat.setAttribute('data-student', studentId || '');

                const displayRow = Math.floor(seatIndex / state.cols) + 1;
                const displayCol = (seatIndex % state.cols) + 1;

                if (studentId) {
                    const displayName = student ? student.name : '';
                    const groupColor = getStudentGroupColor(studentId);
                    if (groupColor) {
                        seat.style.backgroundColor = groupColor;
                        seat.style.borderColor = adjustColor(groupColor, -30);
                        seat.style.color = isLightColor(groupColor) ? '#000' : '#fff';
                    }
                    // 签到模式下不显示删除按钮(√ 由 CSS ::before 显示)
                    const deleteBtnHtml = state.isCheckinMode ? '' : '<button class="seat-delete-btn" title="删除学生">×</button>';
                    // 构建性别和标签图标
                    let iconsHtml = '';
                    if (state.showStudentIcons && student) {
                        const icons = [];
                        // 性别图标
                        if (student.gender === 'male') {
                            icons.push({ emoji: '♂', title: '男' });
                        } else if (student.gender === 'female') {
                            icons.push({ emoji: '♀', title: '女' });
                        }
                        // 标签图标
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
                    seat.draggable = !state.isTouchDevice && !state.isCheckinMode;
                } else {
                    seat.innerHTML =
                        '<span class="seat-number">' + displayRow + '排' + displayCol + '列</span>' +
                        '<span class="seat-name" style="color: #999;">空</span>';
                    seat.draggable = false;
                }

                classroom.appendChild(seat);

                let checkCol = getView() ? actualCol : (col + 1);
                const aisle = state.aisles.find(a => a.afterCol === checkCol);
                if (aisle) {
                    const aislePlaceholder = document.createElement('div');
                    aislePlaceholder.className = 'aisle-placeholder';
                    classroom.appendChild(aislePlaceholder);
                }
            }
        }

        if (getView()) {
            const desk = document.createElement('div');
            desk.className = 'teacher-desk teacher-view';
            desk.textContent = '讲台';
            classroom.appendChild(desk);
        }

        if (state.isCheckinMode) {
            classroom.classList.add('checkin-mode');
        } else {
            classroom.classList.remove('checkin-mode');
        }

        onGenerateStudentList();
        updateStatistics();
        updateCheckinStats();
        onAutoSave();
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