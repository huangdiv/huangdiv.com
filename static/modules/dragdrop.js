// modules/dragdrop.js
// ─────────────────────────────────────────────────────────────────────────────
// 桌面端拖放模块(HTML5 drag-and-drop API)
//
// 职责(7 个函数 + 事件绑定):
//   1. handleDragStart(e)         座位/学生项 dragstart
//   2. handleDragOver(e)          阻止默认(允许 drop)
//   3. handleDragEnter(e)         高亮目标座位
//   4. handleDragLeave(e)         取消高亮(忽略子元素)
//   5. clearDragHighlights()      重置全部拖拽状态与高亮(公开,供 toggleCheckinMode 等调用)
//   6. handleDrop(e)              分配/交换/删除学生
//   7. handleDragEnd(e)           dragend 兜底清状态
//
// 模块私有状态(closure):
//   - draggedStudentId   当前拖拽的学生 ID
//   - draggedFromIndex   拖拽源座位索引(null = 来自学生名单)
//   - dragStartTime      起始时间(预留扩展)
//
// 依赖(通过 deps 注入):
//   - DOM refs    classroom / studentList / deleteZone / dragHint
//   - helpers     { getStudentById }
//   - callbacks   { onPushSnapshot, onUpdateStudentAssignmentDisplay, onGenerateSeats }
//   - state(直接 import './state.js')
//
// 读路径:全部从 state.* 直读(path-A2 等价行为)
// 写路径:state.students / state.seats 直接变更 + commit() 派发 change 事件
// ─────────────────────────────────────────────────────────────────────────────

import { state, commit } from './state.js';
import { MESSAGES } from './messages.js';

export function createDragdrop(deps) {
    const {
        classroom,
        studentList,
        deleteZone,
        dragHint,
        helpers,
        callbacks
    } = deps;

    const { getStudentById } = helpers;
    const {
        onPushSnapshot,
        onUpdateStudentAssignmentDisplay,
        onGenerateSeats
    } = callbacks;

    // ─────────── 模块私有拖拽状态 ───────────
    let draggedStudentId = null;
    let draggedFromIndex = null;
    let dragStartTime = 0;

    // 拖拽事件的 e.target 不一定是 Element(落在文本节点上时为 Text),
    // 而 Text 没有 closest()——统一收敛成元素再取 closest,避免
    // "e.target.closest is not a function" 中断整个 drop 流程。
    function targetEl(e) {
        const t = e.target;
        if (t && t.nodeType === 1) return t;
        return (t && t.parentElement) || null;
    }

    // 公共高亮视觉(座位/名单 dragstart 共享)
    function applyDragVisuals(sourceEl) {
        sourceEl.classList.add('dragging');
        dragHint.style.display = 'block';
        classroom.classList.add('highlight');
        studentList.classList.add('highlight');
        deleteZone.classList.add('visible');
    }

    // ─────────── 7 个导出函数 ───────────

    function handleDragStart(e) {
        const el = targetEl(e);
        const seat = el ? el.closest('.seat') : null;
        if (!seat) return;

        const studentId = seat.getAttribute('data-student');
        if (!studentId) {
            e.preventDefault();
            return;
        }

        dragStartTime = Date.now();
        draggedStudentId = studentId;
        draggedFromIndex = parseInt(seat.getAttribute('data-index'));
        e.dataTransfer.setData('text/plain', studentId);
        applyDragVisuals(seat);
    }

    function handleDragOver(e) {
        e.preventDefault();
    }

    function handleDragEnter(e) {
        e.preventDefault();
        const el = targetEl(e);
        const seat = el ? el.closest('.seat') : null;
        if (seat) seat.classList.add('highlight');
    }

    function handleDragLeave(e) {
        const el = targetEl(e);
        const seat = el ? el.closest('.seat') : null;
        if (seat && !seat.contains(e.relatedTarget)) {
            seat.classList.remove('highlight');
        }
    }

    function clearDragHighlights() {
        draggedStudentId = null;
        draggedFromIndex = null;
        dragHint.style.display = 'none';
        classroom.classList.remove('highlight');
        studentList.classList.remove('highlight');
        deleteZone.classList.remove('highlight', 'visible');
        document.querySelectorAll('.seat.highlight, .seat.dragging, .student-item.dragging').forEach(el => {
            el.classList.remove('highlight', 'dragging');
        });
    }

    function handleDrop(e) {
        e.preventDefault();

        // 用 try/finally 兜底:无论正常完成还是中途抛异常(例如 pushSnapshot 深拷贝
        // state 失败、commit 渲染失败等),都要保证拖拽高亮与拖拽状态被清除,
        // 否则会留下 .highlight/.dragging 残留,表现为"松开鼠标后界面保持不动"。
        const target = targetEl(e);
        try {
            // 仅在有有效拖拽目标时才保存快照
            const hasValidTarget = !!target && (
                                   target.closest('#deleteZone') ||
                                   target.closest('.student-list') ||
                                   target.closest('.seat'));
            if (hasValidTarget && draggedStudentId) {
                onPushSnapshot('drag');
            }

            // 删除区域
            if (target && target.closest('#deleteZone')) {
                const student = getStudentById(draggedStudentId);
                const displayName = student ? student.name : '';
                if (confirm(MESSAGES.CONFIRM_DELETE_STUDENT(displayName))) {
                    state.students = state.students.filter(s => s.id !== draggedStudentId);
                    if (draggedFromIndex !== null) {
                        state.seats[draggedFromIndex] = null;
                    }
                    commit({ seats: state.seats, students: state.students });
                    onUpdateStudentAssignmentDisplay();
                    onGenerateSeats();
                }
                return;
            }

            // 拖回学生名单区域
            if (target && target.closest('.student-list')) {
                if (draggedFromIndex !== null) {
                    state.seats[draggedFromIndex] = null;
                    commit({ seats: state.seats });
                    onGenerateSeats();
                }
                return;
            }

            // 拖到座位
            const seat = target ? target.closest('.seat') : null;
            if (!seat) return;
            const seatIndex = parseInt(seat.getAttribute('data-index'));
            if (Number.isNaN(seatIndex)) return;

            // 从名单拖到座位
            if (draggedStudentId && draggedFromIndex === null) {
                if (state.seats.includes(draggedStudentId)) {
                    const student = getStudentById(draggedStudentId);
                    alert(MESSAGES.STUDENT_ALREADY_SEATED(student ? student.name : ''));
                    return;
                }
                state.seats[seatIndex] = draggedStudentId;
                commit({ seats: state.seats });
            }
            // 座位间交换
            else if (draggedFromIndex !== null) {
                const targetStudentId = state.seats[seatIndex];
                state.seats[seatIndex] = draggedStudentId;
                state.seats[draggedFromIndex] = targetStudentId;
                commit({ seats: state.seats });
            }

            onGenerateSeats();
        } finally {
            clearDragHighlights();
        }
    }

    function handleDragEnd(e) {
        clearDragHighlights();
    }

    // ─────────── 公开方法:一次性绑定静态区域事件 ───────────

    function attachEventListeners() {
        // 仅在非触摸设备启用桌面拖拽
        if (state.isTouchDevice) return;

        // 学生名单区域
        studentList.addEventListener('dragover', function (e) {
            e.preventDefault();
        });

        studentList.addEventListener('dragenter', function (e) {
            e.preventDefault();
            this.classList.add('highlight');
        });

        studentList.addEventListener('dragleave', function (e) {
            this.classList.remove('highlight');
        });

        studentList.addEventListener('drop', function (e) {
            e.preventDefault();
            this.classList.remove('highlight');
            handleDrop(e); // 复用handleDrop函数
        });

        // 删除区域
        deleteZone.addEventListener('dragover', function (e) {
            e.preventDefault();
            this.classList.add('highlight');
        });

        deleteZone.addEventListener('dragenter', function (e) {
            e.preventDefault();
            this.classList.add('highlight');
        });

        deleteZone.addEventListener('dragleave', function (e) {
            this.classList.remove('highlight');
        });

        deleteZone.addEventListener('drop', function (e) {
            e.preventDefault();
            this.classList.remove('highlight');
            handleDrop(e); // 复用handleDrop函数
        });

        // 座位表区域(事件委托)
        classroom.addEventListener('dragstart', handleDragStart);
        classroom.addEventListener('dragover', handleDragOver);
        classroom.addEventListener('dragenter', handleDragEnter);
        classroom.addEventListener('dragleave', handleDragLeave);
        classroom.addEventListener('drop', handleDrop);
        classroom.addEventListener('dragend', handleDragEnd);
    }

    // ─────────── 公开方法:为单个学生项绑定 batch dragstart ───────────
    // 用于批量模式:generateStudentList 中每个 student-item 调用一次

    function attachStudentItemDragstart(studentItem, student) {
        if (state.isTouchDevice || state.isCheckinMode) return;

        studentItem.addEventListener('dragstart', function (e) {
            dragStartTime = Date.now();
            draggedStudentId = student.id;
            draggedFromIndex = null;
            e.dataTransfer.setData('text/plain', student.id);
            applyDragVisuals(studentItem);
        });

        studentItem.addEventListener('dragend', function (e) {
            clearDragHighlights();
        });
    }

    return {
        handleDragStart,
        handleDragOver,
        handleDragEnter,
        handleDragLeave,
        clearDragHighlights,
        handleDrop,
        handleDragEnd,
        attachEventListeners,
        attachStudentItemDragstart
    };
}