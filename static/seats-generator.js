import { state, bus, commit, subscribe, selectors } from './modules/state.js';
import { createSeatGrid } from './modules/seat-grid.js';
import { createDragdrop } from './modules/dragdrop.js';
import { createRandomArrange } from './modules/random-arrange.js';
import { migrateConfig as migrateConfigFn } from './modules/migrate.js';
import { MESSAGES } from './modules/messages.js';

    (function () {
        'use strict';

        // ==================== 应用版本号 ====================
        const APP_VERSION = '1.3.1';

        // ==================== 数据模型 ====================
        // students: [{ id: 's1', name: '张三', groupId: null }]
        // groups:  [{ id: 'g1', name: '第一组', color: '#4CAF50' }]
        // currentSeats: [null, 's1', null, 's2', ...]  — 存储学生 ID

// === 顶层状态别名(同步 state 中心,path-A1)===
// 这些 let/const 别名仅用于兼容既有 283 个函数对顶层变量的读写,
// 与 state 中心始终保持「初始时同引用」。对数组/对象的方法调用
// (push/pop/filter/sort 等)会自动反映到 state.*。
//
// 对 let 别名的「重新指向新对象」(92 处写点)目前只更新本地别名,
// 不主动同步 state/commit — 这是有意的渐进策略:
//   1) path-A1(本轮):读路径透明,行为等价于旧代码,零回归
//   2) path-A1-follow(本轮内最小切口):每改一处写点就同步 commit
//   3) path-A2(下一轮):全部写点接入 commit,完成 bus 驱动
//
// 如果不需要双轨可彻底切换,改写点并 add commit 是必经之路。
let students = state.students;
let groups = state.groups;
let aisles = state.aisles;
let forcedPairs = state.forcedPairs;
let avoidPairs = state.avoidPairs;
let currentSeats = state.seats;
let rows = state.rows;
let cols = state.cols;
let isTeacherView = state.viewMode === 'teacher';
let isCheckinMode = state.isCheckinMode;
let isGroupMode = state.isGroupMode;   // 分组模式:座位表多选学生 → 批量分配到分组
const groupModeSelectedIds = new Set();  // 分组模式:当前选中的学生 id 集合(座位表多选)
let groupFocusId = null;               // 分组模式:当前聚焦查看的分组 id(高亮成员 + 统计栏展示)
let groupCurrentStudentId = null;      // 分组模式:多选时统计栏展示的「当前学生」(最后点击的那位)
let groupRotateOffset = 1;             // 分组轮换步长(默认 +1:轮换到下一组)
// 智能排座下拉的三个选项开关(初始值均为「关」,之后由配置覆盖)
let smartArrangeMixed = false;         // 男女同桌
let smartArrangeSameGender = false;    // 男女不同桌(与「男女同桌」互斥)
let smartArrangeRotate = false;        // 小组轮换(开启后智能排座会在排座后按步长轮换)
let showStudentIcons = state.showStudentIcons;
let isTouchDevice = state.isTouchDevice;
// 性别规则(男女同桌 / 男女不同桌)未达成的座位集合 —— 开座表闪烁提示用
const genderHintSeats = new Set();

// 轮换步长归一:必须是 >= 1 的整数;超过分组数时收敛到最大有效值(组数-1)。
// 分组数变化(新建/删除分组)后旧配置可能越界,统一走这里修正。
function normalizeRotateOffset(value) {
    var n = Math.floor(Number(value));
    if (!isFinite(n) || n < 1) return 1;
    if (groups.length > 1 && n > groups.length - 1) return groups.length - 1;
    return n;
}

        // DOM 引用
        const classroom = document.getElementById('classroom');
        const classroomWrapper = classroom.parentElement;
        const pageTitle = document.getElementById('pageTitle');
        const titleDate = document.getElementById('titleDate');
        const studentList = document.getElementById('studentList');
        const fileInput = document.getElementById('fileInput');
        const fileInfo = document.getElementById('fileInfo');
        const previewArea = document.getElementById('previewArea');
        const sheetSelectArea = document.getElementById('sheetSelectArea');
        const sheetSelect = document.getElementById('sheetSelect');
        const columnSelect = document.getElementById('columnSelect');
        const tablePreview = document.getElementById('tablePreview');
        const confirmImportBtn = document.getElementById('confirmImportBtn');
        const dragHint = document.getElementById('dragHint');
        const clearStorageBtn = document.getElementById('clearStorageBtn');

        // 多配置管理常量
        const CONFIGS_KEY = 'classroomConfigsList';
        const ACTIVE_CONFIG_KEY = 'classroomActiveConfig';
        const deleteZone = document.getElementById('deleteZone');
        const toggleViewBtn = document.getElementById('toggleViewBtn');
        const rowsInput = document.getElementById('rowsInput');
        const colsInput = document.getElementById('colsInput');
        const applyConfigBtn = document.getElementById('applyConfigBtn');
        const groupList = document.getElementById('groupList');
        const studentAssignment = document.getElementById('studentAssignment');
        const studentGroupSelector = document.getElementById('studentGroupSelector');
        const groupImportSection = document.getElementById('groupImportSection');
        const enableGroupImport = document.getElementById('enableGroupImport');
        const groupImportControls = document.getElementById('groupImportControls');
        const enableRowFilter = document.getElementById('enableRowFilter');
        const rowFilterControls = document.getElementById('rowFilterControls');
        const filterColumnSelect = document.getElementById('filterColumnSelect');
        const filterValueSelect = document.getElementById('filterValueSelect');
        const filterSummary = document.getElementById('filterSummary');
        const groupColumnSelect = document.getElementById('groupColumnSelect');
        const groupPreviewSection = document.getElementById('groupPreviewSection');
        const groupPreviewList = document.getElementById('groupPreviewList');
        const genderImportSection = document.getElementById('genderImportSection');
        const enableGenderImport = document.getElementById('enableGenderImport');
        const genderImportControls = document.getElementById('genderImportControls');
        const genderColumnSelect = document.getElementById('genderColumnSelect');
        const tagImportSection = document.getElementById('tagImportSection');
        const enableTagImport = document.getElementById('enableTagImport');
        const tagImportControls = document.getElementById('tagImportControls');
        const tagColumnSelect = document.getElementById('tagColumnSelect');
        const aisleListEl = document.getElementById('aisleList');
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        const printBtn = document.getElementById('printBtn');
        const modeSwitchBtn = document.getElementById('modeSwitchBtn');
        const modeSwitchIcon = document.getElementById('modeSwitchIcon');
        const modeSwitchLabel = document.getElementById('modeSwitchLabel');
        const quickRandomBtn = document.getElementById('quickRandomBtn');
        // 智能排座:上段 #smartArrangeBtn 直接执行;下段 #randomDropdownBtn 展开选项菜单
        const smartArrangeBtn = document.getElementById('smartArrangeBtn');
        const randomDropdownBtn = document.getElementById('randomDropdownBtn');
        const mobileBanner = document.getElementById('mobileBanner');

        // 分组导入相关变量
        let tempImportGroups = [];
        let selectedGroupColumnIndex = -1;
        let isGroupImportEnabled = false;
        let excelWorkbook = null;
        let selectedFilterColumnIndex = -1;
        let selectedFilterValue = '';
        // 性别/标签导入相关变量
        let selectedGenderColumnIndex = -1;
        let isGenderImportEnabled = false;
        let selectedTagColumnIndex = -1;
        let isTagImportEnabled = false;

        let excelData = null;
        let selectedColumnIndex = 0;

        // 座位表配置 — 见顶部 path-A1 别名(rows / cols / currentSeats)
        // 走道配置 — 见顶部 path-A1 别名(aisles)
        // 配对约束 — 见顶部 path-A1 别名(forcedPairs / avoidPairs)

        let isInitialized = false;
        let autoSaveTimer = null;

        // 撤销/重做栈
        const undoStack = [];
        const redoStack = [];
        const MAX_UNDO = 30;
        let isUndoing = false;

        // 移动端触摸交互状态
        // let isTouchDevice = false;  // 见顶部 path-A1 别名
        let tapSelectedStudentId = null;   // 选中的学生 ID(来自学生列表)
        let tapSelectedSeatIndex = null;    // 选中的座位索引(来自座位表)

        // 签到模式状态
        // let isCheckinMode = false;  // 见顶部 path-A1 别名

        // 学生图标显示开关
        // let showStudentIcons = true;  // 见顶部 path-A1 别名

        // ==================== 设备检测 ====================
        function detectTouchDevice() {
            if (!window.matchMedia) return false;
            const hasCoarsePrimaryPointer = window.matchMedia('(pointer: coarse)').matches;
            const hasNoPrimaryHover = window.matchMedia('(hover: none)').matches;
            const hasTouchPoints = navigator.maxTouchPoints > 0;
            return hasCoarsePrimaryPointer && hasNoPrimaryHover && hasTouchPoints;
        }

        function initMobileSupport() {
            isTouchDevice = detectTouchDevice();
            state.isTouchDevice = isTouchDevice;
            commit({ isTouchDevice: isTouchDevice });
            if (isTouchDevice) {
                mobileBanner.classList.add('visible');
            } else {
                mobileBanner.classList.remove('visible');
            }
        }

        // 提前初始化设备类型，确保后续事件绑定使用正确的值
        initMobileSupport();

        // ==================== 工具函数 ====================

        function generateId(prefix) {
            prefix = prefix || 'g';
            return prefix + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str == null ? '' : str;
            return div.innerHTML;
        }

        function shuffle(arr) {
            const a = [...arr];
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        }

        function adjustColor(color, amount) {
            const hex = color.replace('#', '');
            const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
            const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
            const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
            return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
        }

        function isLightColor(hex) {
            const r = parseInt(hex.substr(1, 2), 16);
            const g = parseInt(hex.substr(3, 2), 16);
            const b = parseInt(hex.substr(5, 2), 16);
            return (r * 299 + g * 587 + b * 114) / 1000 > 128;
        }

        // ==================== 学生/分组查找 ====================

        function getStudentById(id) {
            return students.find(s => s.id === id);
        }

        function getStudentByName(name) {
            return students.find(s => s.name === name);
        }

        function getGroupById(groupId) {
            return groups.find(g => g.id === groupId);
        }

        function getStudentGroupColor(studentId) {
            const student = getStudentById(studentId);
            if (!student || !student.groupId) return null;
            const group = getGroupById(student.groupId);
            return group ? group.color : null;
        }

        // ==================== 自动保存 ====================

        function getCurrentConfig() {
            return {
                title: pageTitle.textContent.trim(),
                rows: rows,
                cols: cols,
                seats: currentSeats,
                students: students,
                groups: groups,
                viewMode: isTeacherView ? 'teacher' : 'student',
                aisles: aisles,
                showStudentIcons: showStudentIcons,
                forcedPairs: forcedPairs,
                avoidPairs: avoidPairs,
                isCheckinMode: isCheckinMode,
                isGroupMode: isGroupMode,
                groupRotateOffset: groupRotateOffset,
                smartArrangeMixed: smartArrangeMixed,
                smartArrangeSameGender: smartArrangeSameGender,
                smartArrangeRotate: smartArrangeRotate,
                version: APP_VERSION
            };
        }

        function autoSave() {
            if (!isInitialized) return;
            clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(function () {
                try {
                    localStorage.setItem('classroomConfig', JSON.stringify(getCurrentConfig()));
                } catch (e) {
                    console.error('自动保存失败:', e);
                }
            }, 500);
        }

        // 集中式自动保存:订阅 state 中心的 'change' 事件,任何一次 commit() 都触发
        // 防抖 autoSave。这样手动调座(拖放 / 触屏点选移动 / 任意写点)只要走 commit
        // 就会被持久化,无需在每个调用点手动补 autoSave()(也避免漏改点的回归)。
        // autoSave 内部已用 isInitialized 守卫,初始化期间的 commit 不会提前写入。
        subscribe(function () {
            // 别名回同步:state 是唯一真源。渲染(seat-grid)读 state.seats,
            // 而自动保存 getCurrentConfig() 读顶层 currentSeats(历史遗留别名,
            // 全文件 60+ 处引用,暂不整体迁移)。任何一次重新赋值 state.seats
            // 的写点都会打断别名,导致"界面已变、保存仍是旧值"。
            // 这里在每次 commit 后统一拉齐,保证任意路径的修改都能被持久化。
            if (state.seats !== currentSeats) {
                currentSeats = state.seats;
            }
            autoSave();
        });

        // ==================== 撤销/重做 ====================

        // 深拷贝工具:优先 structuredClone(原生、快、支持更多类型),
        // 老浏览器(Chrome <98 / Safari <15.4)回退 JSON 序列化。
        // 快照数据均为纯 JSON 结构(students/groups/aisles),两种方式结果等价。
        function deepClone(obj) {
            if (typeof structuredClone === 'function') return structuredClone(obj);
            return JSON.parse(JSON.stringify(obj));
        }

        // P1 (1) 撤销栈 smart-merge:
        //   同一类操作(opType)在 SMART_MERGE_MS 内的连续动作视为一次「心智动作」,不重复入栈。
        //   例如连续拖 5 个学生到新座位 → 1 次 undo 即可全部还原。
        //   阈值从最初的 200ms 起,可通过 localStorage「undoMergeMs」调。
        const SMART_MERGE_DEFAULT_MS = 200;
        function getSmartMergeMs() {
            var v = parseInt(localStorage.getItem('undoMergeMs') || '', 10);
            if (!isFinite(v) || v < 0) v = SMART_MERGE_DEFAULT_MS;
            if (v > 5000) v = 5000;  // 上限 5s,防止 UI 误设
            return v;
        }
        let lastSnapOpType = null;     // 上一次入栈的 opType(字符串或 null)
        let lastSnapTime = 0;          // 上一次入栈的 Date.now()

        // ==================== UTF-8 ↔ Base64 ====================
        // 替代 deprecated 的 btoa(unescape(encodeURIComponent(s))) / decodeURIComponent(escape(atob(s)))。
        // 老式方案依赖 escape/unescape(已被 MDN 标记 deprecated 且部分浏览器将移除),
        // 新方案用 TextEncoder/TextDecoder 原生处理 UTF-8,对 emoji/中文 安全。
        function utf8ToBase64(str) {
            const bytes = new TextEncoder().encode(str);
            let bin = '';
            // 分块拼接避免单次 apply 参数过多(>65535 个会 RangeError)
            const CHUNK = 0x8000;
            for (let i = 0; i < bytes.length; i += CHUNK) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
            }
            return btoa(bin);
        }
        function base64ToUtf8(b64) {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new TextDecoder().decode(bytes);
        }

        function pushSnapshot(opType) {
            if (isUndoing) return;
            const now = Date.now();
            const mergeMs = getSmartMergeMs();
            // merge 条件:同 opType + 在窗口内 + 栈非空 + 合并阈值 > 0
            const canMerge = opType
                && lastSnapOpType === opType
                && (now - lastSnapTime) < mergeMs
                && mergeMs > 0
                && undoStack.length > 0;
            if (canMerge) {
                // 不入栈 — 顶部快照保留为「该心智动作开始前」的状态,1 次 undo 即可回退整批
                // 仍视为一次新操作:清空 redoStack;同时刷新 top 的 ts,延续合并窗口
                undoStack[undoStack.length - 1].ts = now;
                redoStack.length = 0;
                updateUndoRedoButtons();
                return;
            }
            undoStack.push({
                seats: [...currentSeats],
                students: deepClone(students),
                groups: deepClone(groups),
                aisles: deepClone(aisles),
                rows: rows,
                cols: cols,
                opType: opType || null,
                ts: now
            });
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            lastSnapOpType = opType || null;
            lastSnapTime = now;
            redoStack.length = 0;
            updateUndoRedoButtons();
        }

        function undo() {
            if (undoStack.length === 0) return;
            isUndoing = true;
            redoStack.push({
                seats: [...currentSeats],
                students: deepClone(students),
                groups: deepClone(groups),
                aisles: deepClone(aisles),
                rows: rows,
                cols: cols
            });
            const snap = undoStack.pop();
            currentSeats = [...snap.seats];
            students = deepClone(snap.students);
            groups = deepClone(snap.groups);
            aisles = deepClone(snap.aisles);
            rows = snap.rows;
            cols = snap.cols;
            commit({ seats: currentSeats, students: students, groups: groups, aisles: aisles, rows: rows, cols: cols });
            rowsInput.value = rows;
            colsInput.value = cols;
            updateAisleDisplay();
            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            generateSeats();
            // P1 (1) smart-merge:undo 之后是「用户尝试新方向」,必须打破合并窗口,
            // 否则后续 push 会被并入「已撤销」的那个动作的顶部
            lastSnapOpType = null;
            lastSnapTime = 0;
            isUndoing = false;
            updateUndoRedoButtons();
        }

        function redo() {
            if (redoStack.length === 0) return;
            isUndoing = true;
            undoStack.push({
                seats: [...currentSeats],
                students: deepClone(students),
                groups: deepClone(groups),
                aisles: deepClone(aisles),
                rows: rows,
                cols: cols
            });
            const snap = redoStack.pop();
            currentSeats = [...snap.seats];
            students = deepClone(snap.students);
            groups = deepClone(snap.groups);
            aisles = deepClone(snap.aisles);
            rows = snap.rows;
            cols = snap.cols;
            commit({ seats: currentSeats, students: students, groups: groups, aisles: aisles, rows: rows, cols: cols });
            rowsInput.value = rows;
            colsInput.value = cols;
            updateAisleDisplay();
            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            generateSeats();
            // P1 (1) smart-merge:redo 同样打破合并窗口(与 undo 对称)
            lastSnapOpType = null;
            lastSnapTime = 0;
            isUndoing = false;
            updateUndoRedoButtons();
        }

        function updateUndoRedoButtons() {
            undoBtn.disabled = undoStack.length === 0;
            redoBtn.disabled = redoStack.length === 0;
        }

        // ==================== 配置迁移（向后兼容） ====================
        // 委托给 modules/migrate.js — 纯函数,无副作用,易单测
        // 这里只做一个薄包装,因为 IIFE 内的 generateId 已闭包到 migrate 内部
        function migrateConfig(config) {
            return migrateConfigFn(config);
        }

        // 添加走道按钮事件
        document.getElementById('addAisleBtn').addEventListener('click', function () {
            const afterCol = parseInt(document.getElementById('aisleAfterCol').value);
            const width = parseInt(document.getElementById('aisleWidth').value);

            if (afterCol < 1 || afterCol >= cols) {
                alert(MESSAGES.AISLE_COL_RANGE(cols));
                return;
            }

            if (aisles.some(a => a.afterCol === afterCol)) {
                alert(MESSAGES.AISLE_EXISTS);
                return;
            }

            aisles.push({ afterCol: afterCol, width: width });
            aisles.sort((a, b) => a.afterCol - b.afterCol);
            commit({ aisles: aisles });
            updateAisleDisplay();
            generateSeats();
        });

        // 更新走道显示
        function updateAisleDisplay() {
            if (aisles.length === 0) {
                aisleListEl.innerHTML = '<span style="color: #999;">暂无走道</span>';
                return;
            }
            aisleListEl.innerHTML = aisles.map(aisle =>
                '<span class="aisle-item" data-after-col="' + aisle.afterCol + '">' +
                    '第' + aisle.afterCol + '列后(' + aisle.width + 'px) ' +
                    '<button class="aisle-remove-btn" data-after-col="' + aisle.afterCol + '">×</button>' +
                '</span>'
            ).join('');
        }

        // 走道列表事件委托（点击删除按钮）
        aisleListEl.addEventListener('click', function (e) {
            const btn = e.target.closest('.aisle-remove-btn');
            if (!btn) return;
            const afterCol = parseInt(btn.getAttribute('data-after-col'));
            aisles = aisles.filter(a => a.afterCol !== afterCol);
            commit({ aisles: aisles });
            updateAisleDisplay();
            generateSeats();
        });

        // ==================== 分组管理 ====================

        function addGroup() {
            const newRow = groupList.querySelector('.new-group-row');
            if (!newRow) return;
            const nameInput = newRow.querySelector('.new-group-name');
            const colorInput = newRow.querySelector('.new-group-color');
            const name = nameInput.value.trim();
            const color = colorInput.value;

            if (!name) {
                alert(MESSAGES.GROUP_NAME_REQUIRED);
                return;
            }

            if (groups.some(g => g.name === name)) {
                alert(MESSAGES.GROUP_NAME_EXISTS);
                return;
            }

            groups.push({
                id: generateId('g'),
                name: name,
                color: color
            });
            commit({ groups: groups });

            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            autoSave();
        }

        function editGroup(groupId, newName, newColor) {
            const group = getGroupById(groupId);
            if (group) {
                group.name = newName;
                group.color = newColor;
                commit({ groups: groups });
                updateGroupDisplay();
                updateStudentAssignmentDisplay();
                generateSeats();
            }
        }

        function deleteGroup(groupId) {
            if (confirm(MESSAGES.CONFIRM_DELETE_GROUP)) {
                pushSnapshot('group');
                students.forEach(s => {
                    if (s.groupId === groupId) s.groupId = null;
                });
                groups = groups.filter(g => g.id !== groupId);
                commit({ students: students, groups: groups });
                updateGroupDisplay();
                updateStudentAssignmentDisplay();
                generateSeats();
            }
        }

        // 分组列表渲染（纯渲染，事件由委托处理）
        function updateGroupDisplay() {
            // 新增分组行（始终显示在最后）
            const newRow =
                '<div class="group-item new-group-row" style="background: #e8f5e9;">' +
                    '<div class="group-info">' +
                        '<input type="text" class="group-name-input new-group-name" placeholder="新增分组" data-group-id="">' +
                    '</div>' +
                    '<div class="group-actions">' +
                        '<input type="color" class="group-color-input new-group-color" value="#4CAF50" data-group-id="">' +
                        '<button class="add-btn new-group-add-btn" title="添加分组">+</button>' +
                    '</div>' +
                '</div>';

            if (groups.length === 0) {
                groupList.innerHTML = newRow;
            } else {
                groupList.innerHTML = groups.map(group =>
                    '<div class="group-item" data-group-id="' + escapeHtml(group.id) + '">' +
                        '<div class="group-info">' +
                            '<input type="text" class="group-name-input" value="' + escapeHtml(group.name) + '" data-group-id="' + escapeHtml(group.id) + '">' +
                        '</div>' +
                        '<div class="group-actions">' +
                            '<input type="color" class="group-color-input" value="' + escapeHtml(group.color) + '" data-group-id="' + escapeHtml(group.id) + '">' +
                            '<button class="delete-btn group-delete-btn" data-group-id="' + escapeHtml(group.id) + '" title="删除分组">×</button>' +
                        '</div>' +
                    '</div>'
                ).join('') + newRow;
            }
            studentAssignment.style.display = 'block';

            // 分组数变化后,旧的轮换步长可能越界(例如 4 组时的 +3 在删到 2 组后失效)
            const normalized = normalizeRotateOffset(groupRotateOffset);
            if (normalized !== groupRotateOffset) {
                groupRotateOffset = normalized;
                autoSave();
            }
            updateRotateOffsetBadge();
            // 分组增删会改变步长的可用上限,同步智能排座下拉的开关/步长 UI
            syncSmartArrangeUI();
            if (isGroupMode) updateGroupStatsRow();
        }

        // 分组列表事件委托
        groupList.addEventListener('change', function (e) {
            const target = e.target;
            const groupId = target.getAttribute('data-group-id');
            if (!groupId) return;
            const group = getGroupById(groupId);
            if (!group) return;
            if (target.classList.contains('group-name-input')) {
                editGroup(groupId, target.value, group.color);
            } else if (target.classList.contains('group-color-input')) {
                editGroup(groupId, group.name, target.value);
            }
        });

        groupList.addEventListener('click', function (e) {
            // 删除分组
            const delBtn = e.target.closest('.group-delete-btn');
            if (delBtn) {
                deleteGroup(delBtn.getAttribute('data-group-id'));
                return;
            }
            // 新增分组
            const addBtn = e.target.closest('.new-group-add-btn');
            if (addBtn) {
                addGroup();
                return;
            }
        });

        // 新增分组输入框回车
        groupList.addEventListener('keypress', function (e) {
            if (e.key !== 'Enter') return;
            if (!e.target.classList.contains('new-group-name')) return;
            addGroup();
        });

        // 更新学生分配显示（纯渲染，事件由委托处理）
        function updateStudentAssignmentDisplay() {
            const groupOptions = groups.map(g =>
                '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</option>'
            ).join('');

            const newRow =
                '<div class="student-group-item" style="background: #e8f5e9;">' +
                    '<input type="text" class="new-student-name" placeholder="新增学生">' +
                    '<select class="new-student-group"><option value="">未分组</option>' + groupOptions + '</select>' +
                    '<select class="gender-select new-student-gender-select" title="性别">' +
                        '<option value="">—</option>' +
                        '<option value="male">♂</option>' +
                        '<option value="female">♀</option>' +
                    '</select>' +
                    '<button class="tag-toggle-btn new-student-tag-btn" title="添加标签">+</button>' +
                    '<button class="add-btn new-student-add-btn">+</button>' +
                '</div>';

            if (students.length === 0) {
                studentGroupSelector.innerHTML = newRow;
            } else {
                const studentsHtml = students.map(student => {
                    let classes = 'student-group-item';
                    const checkbox = '';
                    // 性别选项（带选中状态）
                    const genderOpts = [
                        { value: '', label: '—' },
                        { value: 'male', label: '♂' },
                        { value: 'female', label: '♀' }
                    ].map(g =>
                        '<option value="' + g.value + '"' + (student.gender === g.value ? ' selected' : '') + '>' + g.label + '</option>'
                    ).join('');
                    // 标签数量提示
                    const tagCount = (student.tags || []).length;
                    const tagBtnTitle = tagCount > 0
                        ? '标签 (' + tagCount + '): ' + student.tags.map(t => t.label).join(', ')
                        : '添加标签';
                    return (
                        '<div class="' + classes + '" data-student-id="' + escapeHtml(student.id) + '">' +
                            checkbox +
                            '<input type="text" class="student-name-input" value="' + escapeHtml(student.name) + '">' +
                            '<select class="student-group-select">' +
                                '<option value="">未分组</option>' +
                                groups.map(g =>
                                    '<option value="' + escapeHtml(g.id) + '"' + (student.groupId === g.id ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>'
                                ).join('') +
                            '</select>' +
                            '<select class="gender-select student-gender-select" title="性别">' + genderOpts + '</select>' +
                            '<button class="tag-toggle-btn student-tag-btn" title="' + escapeHtml(tagBtnTitle) + '">' +
                                (tagCount > 0 ? escapeHtml(student.tags[0].emoji || '🏷') : '+') +
                            '</button>' +
                            '<button class="delete-btn student-delete-btn">×</button>' +
                        '</div>'
                    );
                }).join('');
                studentGroupSelector.innerHTML = studentsHtml + newRow;
            }
        }

        // 学生分配区域事件委托
        studentGroupSelector.addEventListener('change', function (e) {
            const target = e.target;
            const item = target.closest('.student-group-item');
            if (!item) return;

            // 已有学生姓名变更
            if (target.classList.contains('student-name-input')) {
                const studentId = item.getAttribute('data-student-id');
                updateStudentName(studentId, target.value);
                return;
            }

            // 已有学生分组变更
            if (target.classList.contains('student-group-select')) {
                const studentId = item.getAttribute('data-student-id');
                assignStudentToGroup(studentId, target.value);
                return;
            }

            // 已有学生性别变更
            if (target.classList.contains('student-gender-select')) {
                const studentId = item.getAttribute('data-student-id');
                const student = getStudentById(studentId);
                if (student) {
                    student.gender = target.value;
                    generateSeats();
                    autoSave();
                }
                return;
            }
        });

        studentGroupSelector.addEventListener('click', function (e) {
            // 新增行标签管理按钮
            const newTagBtn = e.target.closest('.new-student-tag-btn');
            if (newTagBtn) {
                e.stopPropagation();
                openNewStudentTagPopup(newTagBtn);
                return;
            }

            // 已有学生标签管理按钮
            const tagBtn = e.target.closest('.student-tag-btn');
            if (tagBtn) {
                e.stopPropagation();
                const item = tagBtn.closest('.student-group-item');
                const studentId = item.getAttribute('data-student-id');
                openTagPopup(studentId, tagBtn);
                return;
            }

            // 删除学生
            const delBtn = e.target.closest('.student-delete-btn');
            if (delBtn) {
                const item = delBtn.closest('.student-group-item');
                const studentId = item.getAttribute('data-student-id');
                removeStudent(studentId);
                return;
            }

            // 新增学生
            const addBtn = e.target.closest('.new-student-add-btn');
            if (addBtn) {
                const item = addBtn.closest('.student-group-item');
                const nameInput = item.querySelector('.new-student-name');
                const groupSelect = item.querySelector('.new-student-group');
                const genderSelect = item.querySelector('.new-student-gender-select');
                const name = nameInput.value.trim();
                const groupId = groupSelect.value || null;
                const gender = genderSelect ? genderSelect.value : '';

                if (!name) {
                    alert(MESSAGES.STUDENT_NAME_REQUIRED);
                    return;
                }
                if (students.some(s => s.name === name)) {
                    alert(MESSAGES.STUDENT_NAME_EXISTS_NEW);
                    return;
                }

                // 收集新增行中已添加的标签
                const newTags = [];
                const tagChips = item.querySelectorAll('.new-student-tag-chip');
                tagChips.forEach(function (chip) {
                    const emoji = chip.getAttribute('data-emoji') || '🏷';
                    const label = chip.getAttribute('data-label') || '';
                    if (label) newTags.push({ emoji: emoji, label: label });
                });

                students.push({ id: generateId('s'), name: name, groupId: groupId, checkedIn: false, gender: gender, tags: newTags });
                nameInput.value = '';
                groupSelect.value = '';
                if (genderSelect) genderSelect.value = '';
                updateStudentAssignmentDisplay();
                generateStudentList();
                updateStatistics();
                autoSave();
            }
        });

        // 新增学生输入框回车
        studentGroupSelector.addEventListener('keypress', function (e) {
            if (e.key !== 'Enter') return;
            const target = e.target;
            if (!target.classList.contains('new-student-name')) return;
            const item = target.closest('.student-group-item');
            const addBtn = item.querySelector('.new-student-add-btn');
            addBtn.click();
        });

        function assignStudentToGroup(studentId, groupId) {
            const student = getStudentById(studentId);
            if (student) {
                student.groupId = groupId || null;
                generateSeats();
                generateStudentList();
                autoSave();
            }
        }

        function updateStudentName(studentId, newName) {
            newName = newName.trim();

            if (!newName) {
                alert(MESSAGES.STUDENT_NAME_REQUIRED);
                updateStudentAssignmentDisplay();
                return;
            }

            const student = getStudentById(studentId);
            if (!student) return;

            if (students.some(s => s.name === newName && s.id !== studentId)) {
                alert(MESSAGES.STUDENT_NAME_EXISTS_EDIT);
                updateStudentAssignmentDisplay();
                return;
            }

            // ID 化后无需更新 currentSeats（座位存的是 ID，不是姓名）
            student.name = newName;
            generateSeats();
            generateStudentList();
            autoSave();
        }

        function removeStudent(studentId) {
            const student = getStudentById(studentId);
            if (!student) return;
            if (confirm(MESSAGES.CONFIRM_DELETE_STUDENT(student.name))) {
                pushSnapshot('student');
                // 如果该学生的标签弹窗打开着，先关闭
                if (activeTagPopup && activeTagPopup.studentId === studentId) {
                    closeTagPopup();
                }
                currentSeats = currentSeats.map(id => id === studentId ? null : id);
                students = students.filter(s => s.id !== studentId);
                commit({ seats: currentSeats, students: students });
                updateStudentAssignmentDisplay();
                generateSeats();
                autoSave();
            }
        }

        // ==================== 标签管理 ====================
        let activeTagPopup = null; // { studentId, popupEl }

        // 新增行标签 popup（操作临时标签数据，不关联 studentId）
        // P1 UX #5:弹窗焦点陷阱 + Esc 关闭 helper — 任何 popup 关闭自己的回调可通过 onEscape 传入。
        // focusable 选择器列表覆盖原生表单元素 + role=button 的可聚焦 div。
        const FOCUSABLE_SELECTOR = [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
            '[role="button"]',
            '[role="menuitem"]'
        ].join(',');
        function installFocusTrap(popupEl, onEscape) {
            const previouslyFocused = document.activeElement;
            // 初始焦点:弹窗内第一个可聚焦元素;没有就聚焦弹窗本身
            const initial = popupEl.querySelector(FOCUSABLE_SELECTOR);
            if (initial) {
                requestAnimationFrame(function () { initial.focus(); });
            } else {
                popupEl.setAttribute('tabindex', '-1');
                popupEl.focus();
            }
            popupEl.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    if (typeof onEscape === 'function') onEscape();
                    return;
                }
                if (e.key !== 'Tab') return;
                const focusables = Array.from(popupEl.querySelectorAll(FOCUSABLE_SELECTOR))
                    .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
                if (focusables.length === 0) {
                    e.preventDefault();
                    return;
                }
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                const active = document.activeElement;
                if (e.shiftKey) {
                    if (active === first || !popupEl.contains(active)) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (active === last || !popupEl.contains(active)) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            });
            return {
                restoreFocus: function () {
                    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                        previouslyFocused.focus();
                    }
                }
            };
        }

        // 共享 popup 骨架:DOM 创建 + 定位 + 回车添加 + 标签建议 + 阻止冒泡 + 焦点陷阱。
        // 调用方只需传入标题、锚点、建议数据源 + 关闭回调,再自行绑定 添加/删除 事件(P1 去重,原先两函数 copy-paste ~100 行)。
        function createTagPopupShell(titleHtml, anchorEl, suggestionSource, onClose) {
            const container = ensureTagPopupContainer();
            const popup = document.createElement('div');
            popup.className = 'tag-popup';
            popup.setAttribute('role', 'dialog');
            popup.setAttribute('aria-modal', 'true');
            popup.innerHTML =
                '<div class="tag-popup-title">' + titleHtml + '</div>' +
                '<div class="tag-chips-container"></div>' +
                '<div class="tag-popup-row">' +
                    '<input type="text" class="tag-popup-emoji" placeholder="🏷" title="emoji图标(支持组合 emoji,可粘贴多位,限 4 个码点)">' +
                    '<input type="text" class="tag-popup-input" placeholder="标签名称">' +
                    '<button class="mini-btn primary tag-popup-add">添加</button>' +
                '</div>' +
                '<div class="tag-suggestions" style="display:none;"></div>';

            container.appendChild(popup);

            // 定位 popup:锚点右侧 8px,越界翻转到左侧
            const rect = anchorEl.getBoundingClientRect();
            const popupWidth = 280;
            let left = rect.right + 8;
            let top = rect.top;
            if (left + popupWidth > window.innerWidth - 8) {
                left = Math.max(8, rect.left - popupWidth - 8);
            }
            popup.style.left = left + 'px';
            popup.style.top = top + 'px';

            requestAnimationFrame(function () {
                popup.classList.add('visible');
            });

            // P1 UX #4:emoji input 不依赖 HTML maxlength(按 UTF-16 units 算会把 VS16/ZWJ 组合 emoji 截半),
            // 改用 Array.from(str) 按码点计数后再裁切,保留组合 emoji 完整。
            const EMOJI_MAX_CODEPOINTS = 4;
            const emojiInput = popup.querySelector('.tag-popup-emoji');
            emojiInput.addEventListener('input', function () {
                const codepoints = Array.from(this.value);
                if (codepoints.length > EMOJI_MAX_CODEPOINTS) {
                    this.value = codepoints.slice(0, EMOJI_MAX_CODEPOINTS).join('');
                }
            });

            // 回车添加
            popup.querySelector('.tag-popup-input').addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    popup.querySelector('.tag-popup-add').click();
                }
            });

            // 标签名称输入框 focus 时显示已有标签建议(数据源懒取,保证实时)
            const labelInput = popup.querySelector('.tag-popup-input');
            let suggestionHideTimer = null;
            labelInput.addEventListener('focus', function () {
                if (suggestionHideTimer) { clearTimeout(suggestionHideTimer); suggestionHideTimer = null; }
                const suggestionsEl = popup.querySelector('.tag-suggestions');
                const existingTags = collectExistingTags(suggestionSource);
                if (existingTags.length === 0) { suggestionsEl.style.display = 'none'; return; }
                suggestionsEl.innerHTML = existingTags.map(function (t) {
                    return '<button type="button" class="tag-suggestion-item" data-emoji="' + escapeHtml(t.emoji || '') + '" data-label="' + escapeHtml(t.label) + '">' +
                        '<span class="tag-suggestion-emoji">' + escapeHtml(t.emoji || '🏷') + '</span>' +
                        '<span class="tag-suggestion-label">' + escapeHtml(t.label) + '</span>' +
                    '</button>';
                }).join('');
                suggestionsEl.style.display = 'block';
            });
            labelInput.addEventListener('blur', function () {
                // 延迟隐藏,让点击建议项能触发
                suggestionHideTimer = setTimeout(function () {
                    const el = popup.querySelector('.tag-suggestions');
                    if (el) el.style.display = 'none';
                }, 150);
            });

            // 点击建议项填充
            popup.querySelector('.tag-suggestions').addEventListener('click', function (e) {
                const sItem = e.target.closest('.tag-suggestion-item');
                if (!sItem) return;
                e.preventDefault();
                popup.querySelector('.tag-popup-emoji').value = sItem.getAttribute('data-emoji') || '';
                popup.querySelector('.tag-popup-input').value = sItem.getAttribute('data-label');
                popup.querySelector('.tag-suggestions').style.display = 'none';
            });

            // 防止点击 popup 内部关闭
            popup.addEventListener('click', function (e) {
                e.stopPropagation();
            });

            // P1 UX #5:焦点陷阱 + Esc 关闭弹窗(返回 focusTrap 以便外部恢复锚点焦点)
            const focusTrap = installFocusTrap(popup, function () {
                if (typeof onClose === 'function') onClose();
            });

            return Object.assign(popup, { _focusTrap: focusTrap });
        }

        function openNewStudentTagPopup(anchorEl) {
            if (activeTagPopup) closeTagPopup();

            const item = anchorEl.closest('.student-group-item');
            // 收集当前已有的临时标签
            const tempTags = [];
            item.querySelectorAll('.new-student-tag-chip').forEach(function (chip) {
                tempTags.push({
                    emoji: chip.getAttribute('data-emoji') || '🏷',
                    label: chip.getAttribute('data-label') || ''
                });
            });

            // 用一个伪对象让标签建议复用 collectExistingTags(tempTags 引用稳定,增删实时同步)
            const tempStudent = { name: '新增学生', tags: tempTags };
            const popup = createTagPopupShell('管理标签 — 新增学生', anchorEl, tempStudent, closeTagPopup);

            activeTagPopup = { studentId: '__new__', popupEl: popup, tempTags: tempTags, rowItem: item };

            function renderTemp() {
                var c = popup.querySelector('.tag-chips-container');
                if (tempTags.length === 0) {
                    c.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">暂无标签</div>';
                } else {
                    c.innerHTML = tempTags.map(function (tag, idx) {
                        return '<span class="tag-chip">' +
                            '<span class="tag-chip-emoji">' + escapeHtml(tag.emoji || '🏷') + '</span>' +
                            '<span class="tag-chip-label">' + escapeHtml(tag.label) + '</span>' +
                            '<button class="tag-chip-remove" data-tag-idx="' + idx + '" title="删除">×</button>' +
                        '</span>';
                    }).join('');
                }
                // 同步到 DOM（new-student-tag-chip）
                item.querySelectorAll('.new-student-tag-chip').forEach(function (el) { el.remove(); });
                var addBtn = item.querySelector('.new-student-add-btn');
                tempTags.forEach(function (t) {
                    var chip = document.createElement('span');
                    chip.className = 'tag-chip new-student-tag-chip';
                    chip.style.cssText = 'font-size:10px;padding:1px 4px;margin:0 1px;';
                    chip.setAttribute('data-emoji', t.emoji);
                    chip.setAttribute('data-label', t.label);
                    chip.textContent = (t.emoji || '🏷') + t.label;
                    item.insertBefore(chip, addBtn);
                });
                // 更新按钮显示
                anchorEl.textContent = tempTags.length > 0 ? (tempTags[0].emoji || '🏷') : '+';
                anchorEl.title = tempTags.length > 0
                    ? '标签 (' + tempTags.length + '): ' + tempTags.map(function (t) { return t.label; }).join(', ')
                    : '添加标签';
            }

            renderTemp();

            // 添加标签
            popup.querySelector('.tag-popup-add').addEventListener('click', function () {
                var emojiInput = popup.querySelector('.tag-popup-emoji');
                var labelInput = popup.querySelector('.tag-popup-input');
                var emoji = emojiInput.value.trim() || '🏷';
                var label = labelInput.value.trim();
                if (!label) { labelInput.focus(); return; }
                tempTags.push({ emoji: emoji, label: label });
                emojiInput.value = '';
                labelInput.value = '';
                popup.querySelector('.tag-suggestions').style.display = 'none';
                renderTemp();
            });

            // 删除标签
            popup.querySelector('.tag-chips-container').addEventListener('click', function (e) {
                var removeBtn = e.target.closest('.tag-chip-remove');
                if (!removeBtn) return;
                var idx = parseInt(removeBtn.getAttribute('data-tag-idx'));
                tempTags.splice(idx, 1);
                renderTemp();
            });
        }

        function ensureTagPopupContainer() {
            let container = document.getElementById('tagPopupContainer');
            if (container) return container;
            container = document.createElement('div');
            container.id = 'tagPopupContainer';
            document.body.appendChild(container);
            return container;
        }

        function closeTagPopup() {
            if (activeTagPopup) {
                const popupEl = activeTagPopup.popupEl;
                const focusTrap = popupEl && popupEl._focusTrap;
                if (focusTrap && typeof focusTrap.restoreFocus === 'function') {
                    focusTrap.restoreFocus();
                }
                popupEl.classList.remove('visible');
                setTimeout(function () {
                    if (activeTagPopup && activeTagPopup.popupEl.parentNode) {
                        activeTagPopup.popupEl.parentNode.removeChild(activeTagPopup.popupEl);
                    }
                    activeTagPopup = null;
                }, 150);
            }
        }

        function renderTagPopup(popupEl, student) {
            const container = popupEl.querySelector('.tag-chips-container');
            const tags = student.tags || [];
            if (tags.length === 0) {
                container.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">暂无标签</div>';
            } else {
                container.innerHTML = tags.map(function (tag, idx) {
                    return '<span class="tag-chip">' +
                        '<span class="tag-chip-emoji">' + escapeHtml(tag.emoji || '🏷') + '</span>' +
                        '<span class="tag-chip-label">' + escapeHtml(tag.label) + '</span>' +
                        '<button class="tag-chip-remove" data-tag-idx="' + idx + '" title="删除">×</button>' +
                    '</span>';
                }).join('');
            }
        }

        function openTagPopup(studentId, anchorEl) {
            // 关闭已有的 popup
            if (activeTagPopup) closeTagPopup();

            const student = getStudentById(studentId);
            if (!student) return;

            const popup = createTagPopupShell('管理标签 — ' + escapeHtml(student.name), anchorEl, student, closeTagPopup);

            activeTagPopup = { studentId: studentId, popupEl: popup };

            renderTagPopup(popup, student);

            // 添加标签
            popup.querySelector('.tag-popup-add').addEventListener('click', function () {
                const emojiInput = popup.querySelector('.tag-popup-emoji');
                const labelInput = popup.querySelector('.tag-popup-input');
                const emoji = emojiInput.value.trim() || '🏷';
                const label = labelInput.value.trim();
                if (!label) {
                    labelInput.focus();
                    return;
                }
                pushSnapshot('tag');
                if (!student.tags) student.tags = [];
                student.tags.push({ emoji: emoji, label: label });
                emojiInput.value = '';
                labelInput.value = '';
                popup.querySelector('.tag-suggestions').style.display = 'none';
                renderTagPopup(popup, student);
                generateSeats();
                updateStudentAssignmentDisplay();
                autoSave();
            });

            // 删除标签
            popup.querySelector('.tag-chips-container').addEventListener('click', function (e) {
                const removeBtn = e.target.closest('.tag-chip-remove');
                if (!removeBtn) return;
                const idx = parseInt(removeBtn.getAttribute('data-tag-idx'));
                pushSnapshot('tag');
                student.tags.splice(idx, 1);
                renderTagPopup(popup, student);
                generateSeats();
                updateStudentAssignmentDisplay();
                autoSave();
            });
        }

        // 收集所有学生中已有的标签（按 label 去重，排除当前学生已有的）
        function collectExistingTags(currentStudent) {
            const seen = new Set();
            const result = [];
            students.forEach(function (s) {
                if (!s.tags) return;
                // 标记当前学生已有标签，避免重复建议
                const isCurrent = currentStudent && s.id === currentStudent.id;
                s.tags.forEach(function (tag) {
                    if (seen.has(tag.label)) return;
                    seen.add(tag.label);
                    // 如果是当前学生已有的标签，不建议（已显示在 chips 里）
                    if (isCurrent) return;
                    result.push({ emoji: tag.emoji, label: tag.label });
                });
            });
            return result;
        }

        // 点击 popup 外部关闭
        document.addEventListener('click', function (e) {
            if (!activeTagPopup) return;
            if (activeTagPopup.popupEl.contains(e.target)) return;
            closeTagPopup();
        });

        // Esc 关闭 popup
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && activeTagPopup) {
                closeTagPopup();
            }
        });

        // ==================== 分组管理函数结束 ====================

        // ==================== 配对设置 ====================
        let activePairPopup = null;

        function buildStudentOptions(excludeId) {
            return students.map(function (s) {
                if (s.id === excludeId) return '';
                return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>';
            }).join('');
        }

        function pairKey(idA, idB) {
            return idA < idB ? idA + '|' + idB : idB + '|' + idA;
        }

        // 配对满足情况的文案(强制 / 回避两种语义不同)
        function pairStatusTitle(type, status) {
            if (status === 'na') return '当前满足情况:有人未入座,暂无法判定';
            if (type === 'forced') {
                return status === 'ok' ? '当前满足情况:已同桌 ✓' : '当前满足情况:未同桌 ✗';
            }
            return status === 'ok' ? '当前满足情况:已分开 ✓' : '当前满足情况:仍同桌 ✗';
        }

        function renderPairList(container, pairArr, type) {
            if (pairArr.length === 0) {
                container.innerHTML = '<div class="pair-empty">暂无' + (type === 'forced' ? '强制' : '回避') + '配对</div>';
                return;
            }
            // 每条配对的实时满足状态(ok / bad / na)—— 座位一变就重新取
            var statusList = null;
            try {
                var st = randomArrange.getPairStatus();
                statusList = (type === 'forced' ? st.forced : st.avoid) || null;
            } catch (e) {
                statusList = null;
            }
            container.innerHTML = pairArr.map(function (pair, idx) {
                var sA = students.find(function (s) { return s.id === pair[0]; });
                var sB = students.find(function (s) { return s.id === pair[1]; });
                var nameA = sA ? sA.name : '(已删除)';
                var nameB = sB ? sB.name : '(已删除)';
                var status = (statusList && statusList.length === pairArr.length && statusList[idx])
                    ? statusList[idx].status
                    : 'na';
                return '<div class="pair-item pair-status-' + status + '"' +
                        ' title="' + escapeHtml(pairStatusTitle(type, status)) + '">' +
                    '<span class="pair-item-dot" aria-hidden="true"></span>' +
                    '<span class="pair-item-names">' + escapeHtml(nameA) + ' ↔ ' + escapeHtml(nameB) + '</span>' +
                    '<button class="pair-item-remove" data-pair-type="' + type + '" data-pair-idx="' + idx + '" title="删除">×</button>' +
                '</div>';
            }).join('');
        }

        // 座位发生变化(手动拖拽 / 随机排座 / 分组轮换 / 撤销 等)后,
        // 若配对设置弹窗正开着,就按新座位刷新每条配对的底色。
        // ─────────── 性别规则提示(男女同桌 / 男女不同桌)───────────
        // 开关开启时,自动检测未达成条件的同桌座位 ⇒ 座位表上缓慢闪烁提示。
        // 任何手动(拖拽 / 点选 / 删除)或自动(随机排座 / 小组轮换 / 撤销)调整座位后
        // 都会经 generateSeats → afterSeatsRender 重新检测。
        function currentGenderRuleMode() {
            if (smartArrangeMixed) return 'mixed';
            if (smartArrangeSameGender) return 'samegender';
            return null;
        }

        // 重新计算未达成集合并刷新座位表(便宜:O(座位数),可随时调用)
        function refreshGenderHints() {
            genderHintSeats.clear();
            const mode = currentGenderRuleMode();
            if (mode) {
                // randomArrange / refreshSeatExtraClasses 都是本 IIFE 后段才初始化的
                // const,初始化早期调用会命中 TDZ ⇒ 统一 try 住,最坏只是不提示
                try {
                    const violations = randomArrange.findGenderViolations(
                        mode, randomArrange.buildGenderMap(), null);
                    violations.forEach(function (p) {
                        genderHintSeats.add(p[0]);
                        genderHintSeats.add(p[1]);
                    });
                } catch (e) {
                    console.error('[gender-hint] 检测失败', e);
                }
            }
            try {
                refreshSeatExtraClasses();
            } catch (e) {
                /* 尚未初始化:忽略 */
            }
        }

        function getSeatGenderHintClass(seatIndex) {
            return genderHintSeats.has(seatIndex) ? 'gender-rule-hint' : '';
        }

        function refreshPairPopupStatus() {
            if (!activePairPopup || !activePairPopup.popupEl) return;
            var popup = activePairPopup.popupEl;
            // 轮换设置弹窗复用 .pair-popup 外壳但没有配对列表 ⇒ 跳过
            var fList = popup.querySelector('.pair-forced-list');
            var aList = popup.querySelector('.pair-avoid-list');
            if (!fList || !aList) return;
            renderPairList(fList, forcedPairs, 'forced');
            renderPairList(aList, avoidPairs, 'avoid');
        }

        // 座位渲染统一出口:任何一次座位重绘后都要做的派生刷新
        function afterSeatsRender() {
            refreshPairPopupStatus();
            refreshGenderHints();
        }

        function openPairPopup(anchorEl) {
            if (activePairPopup) closePairPopup();

            var container = ensureTagPopupContainer();
            var popup = document.createElement('div');
            popup.className = 'pair-popup';
            popup.setAttribute('role', 'dialog');
            popup.setAttribute('aria-modal', 'true');
            popup.setAttribute('aria-labelledby', 'pairPopupTitle');

            var studentOpts = students.length > 0
                ? students.map(function (s) { return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>'; }).join('')
                : '';
            popup.innerHTML =
                '<div class="pair-popup-title" id="pairPopupTitle">配对设置</div>' +
                '<div class="pair-popup-section">' +
                    '<div class="pair-popup-section-title">强制同桌</div>' +
                    '<div class="pair-popup-row">' +
                        '<select class="pair-forced-a"><option value="">选择学生A</option>' + studentOpts + '</select>' +
                        '<select class="pair-forced-b"><option value="">选择学生B</option>' + studentOpts + '</select>' +
                        '<button class="mini-btn pair-forced-add">添加</button>' +
                    '</div>' +
                    '<div class="pair-forced-list"></div>' +
                '</div>' +
                '<div class="pair-popup-section">' +
                    '<div class="pair-popup-section-title">回避同桌</div>' +
                    '<div class="pair-popup-row">' +
                        '<select class="pair-avoid-a"><option value="">选择学生A</option>' + studentOpts + '</select>' +
                        '<select class="pair-avoid-b"><option value="">选择学生B</option>' + studentOpts + '</select>' +
                        '<button class="mini-btn pair-avoid-add">添加</button>' +
                    '</div>' +
                    '<div class="pair-avoid-list"></div>' +
                '</div>';

            container.appendChild(popup);

            var rect = anchorEl.getBoundingClientRect();
            var popupWidth = 320;
            var left = rect.left;
            var top = rect.bottom + 4;
            if (left + popupWidth > window.innerWidth - 8) {
                left = Math.max(8, window.innerWidth - popupWidth - 8);
            }
            if (top + 300 > window.innerHeight) {
                top = Math.max(8, rect.top - 300);
            }
            popup.style.left = left + 'px';
            popup.style.top = top + 'px';

            activePairPopup = { popupEl: popup };

            function renderAll() {
                renderPairList(popup.querySelector('.pair-forced-list'), forcedPairs, 'forced');
                renderPairList(popup.querySelector('.pair-avoid-list'), avoidPairs, 'avoid');
                // 更新菜单项文字(已从独立按钮改为「随机排座」下拉内的菜单项)
                var pairSettingsMenuItemLabel = document.querySelector('[data-action="pairSettings"] .pair-settings-label');
                if (pairSettingsMenuItemLabel) {
                    pairSettingsMenuItemLabel.textContent = '配对设置' +
                        (forcedPairs.length > 0 ? ' [' + forcedPairs.length + '强' : '') +
                        (avoidPairs.length > 0 ? (forcedPairs.length > 0 ? '/' : ' [') + avoidPairs.length + '避' : '') +
                        (forcedPairs.length > 0 || avoidPairs.length > 0 ? ']' : '');
                }
            }

            renderAll();

            requestAnimationFrame(function () {
                popup.classList.add('visible');
            });

            // 添加强制配对
            popup.querySelector('.pair-forced-add').addEventListener('click', function () {
                var a = popup.querySelector('.pair-forced-a').value;
                var b = popup.querySelector('.pair-forced-b').value;
                if (!a || !b || a === b) { alert(MESSAGES.PAIR_SELECT_TWO_DIFFERENT); return; }
                var key = pairKey(a, b);
                if (forcedPairs.some(function (p) { return pairKey(p[0], p[1]) === key; })) {
                    alert(MESSAGES.PAIR_ALREADY_EXISTS); return;
                }
                forcedPairs.push([a, b]);
                popup.querySelector('.pair-forced-a').value = '';
                popup.querySelector('.pair-forced-b').value = '';
                renderAll();
                autoSave();
            });

            // 添加回避配对
            popup.querySelector('.pair-avoid-add').addEventListener('click', function () {
                var a = popup.querySelector('.pair-avoid-a').value;
                var b = popup.querySelector('.pair-avoid-b').value;
                if (!a || !b || a === b) { alert(MESSAGES.PAIR_SELECT_TWO_DIFFERENT); return; }
                var key = pairKey(a, b);
                if (avoidPairs.some(function (p) { return pairKey(p[0], p[1]) === key; })) {
                    alert(MESSAGES.PAIR_ALREADY_EXISTS); return;
                }
                avoidPairs.push([a, b]);
                popup.querySelector('.pair-avoid-a').value = '';
                popup.querySelector('.pair-avoid-b').value = '';
                renderAll();
                autoSave();
            });

            // 删除配对
            popup.addEventListener('click', function (e) {
                var removeBtn = e.target.closest('.pair-item-remove');
                if (!removeBtn) return;
                var type = removeBtn.getAttribute('data-pair-type');
                var idx = parseInt(removeBtn.getAttribute('data-pair-idx'));
                if (type === 'forced') forcedPairs.splice(idx, 1);
                else avoidPairs.splice(idx, 1);
                renderAll();
                autoSave();
            });

            popup.addEventListener('click', function (e) {
                e.stopPropagation();
            });

            // P1 UX #5:焦点陷阱 + Esc 关闭;返回的 focusTrap 在 closePairPopup 时恢复锚点焦点
            const pairFocusTrap = installFocusTrap(popup, closePairPopup);
            activePairPopup.focusTrap = pairFocusTrap;
        }

        function closePairPopup() {
            if (activePairPopup) {
                if (activePairPopup.focusTrap && typeof activePairPopup.focusTrap.restoreFocus === 'function') {
                    activePairPopup.focusTrap.restoreFocus();
                }
                activePairPopup.popupEl.classList.remove('visible');
                setTimeout(function () {
                    if (activePairPopup && activePairPopup.popupEl.parentNode) {
                        activePairPopup.popupEl.parentNode.removeChild(activePairPopup.popupEl);
                    }
                    activePairPopup = null;
                }, 150);
            }
        }

        // 配对设置现在通过「随机排座」下拉内的 data-action="pairSettings" 菜单项打开/关闭

        // ==================== 轮换设置 ====================
        // 轮换步长改由「智能排座」下拉内的「小组轮换」开关 + 步长 −/+ 直接调整,
        // 不再需要独立的轮换设置弹窗。

        function updateRotateOffsetBadge() {
            const badge = document.getElementById('rotateOffsetBadge');
            if (badge) badge.textContent = '+' + groupRotateOffset;
        }

        // 执行一次分组轮换,返回 { warnings, moved };提示文案交给调用方决定
        // (智能排座需要把排座与轮换的 warnings 合并成一条 toast)
        function runGroupRotation(options) {
            groupRotateOffset = normalizeRotateOffset(groupRotateOffset);
            updateRotateOffsetBadge();
            return rotateGroupSeats(groupRotateOffset, options) || {};
        }

        // ==================== 轮换设置结束 ====================

        // 点击 popup 外部关闭
        document.addEventListener('click', function (e) {
            if (!activePairPopup) return;
            if (activePairPopup.popupEl.contains(e.target)) return;
            if (e.target.closest('[data-action="pairSettings"]')) return;
            closePairPopup();
        });

        // Esc 关闭
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && activePairPopup) {
                closePairPopup();
            }
        });

        // ==================== 配对设置结束 ====================

        // ==================== 分组导入相关函数 ====================

        // 预定义一组对比度良好的颜色（已去重）
        const distinctColors = [
            '#4ECDC4', '#FF6B6B', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
            '#F8C471', '#82E0AA', '#F1948A', '#D2B4DE', '#D7BDE2',
            '#AED6F1', '#F9E79F', '#ABEBC6', '#F5B7B1', '#D4EFDF',
            '#FCF3CF', '#E8DAEF', '#D6EAF8', '#FAD7A0', '#A9DFBF'
        ];

        let colorIndex = 0;

        // 获取下一个唯一颜色
        function getNextDistinctColor() {
            const color = distinctColors[colorIndex % distinctColors.length];
            colorIndex++;
            return color;
        }

        // 初始化颜色索引
        function resetColorIndex() {
            colorIndex = 0;
        }

        function getCellText(value) {
            return value === null || value === undefined ? '' : String(value).trim();
        }

        function getImportRows() {
            if (!excelData || excelData.length < 2) return [];
            const rows = excelData.slice(1);
            if (!isGroupImportEnabled || !enableRowFilter.checked || selectedFilterColumnIndex < 0) return rows;
            return rows.filter(row => getCellText(row[selectedFilterColumnIndex]) === selectedFilterValue);
        }

        function populateColumnSelect(select, includeEmptyOption) {
            select.innerHTML = '';
            if (includeEmptyOption) {
                const emptyOption = document.createElement('option');
                emptyOption.value = -1;
                emptyOption.textContent = '-- 不使用分组 --';
                select.appendChild(emptyOption);
            }
            excelData[0].forEach((cell, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = getCellText(cell) || `列 ${index + 1}`;
                select.appendChild(option);
            });
        }

        function initGroupColumnSelector() {
            if (!excelData || excelData.length === 0) return;
            populateColumnSelect(groupColumnSelect, true);
            let detectedIndex = -1;
            excelData[0].forEach((cell, index) => {
                const name = getCellText(cell).toLowerCase();
                if (detectedIndex < 0 && (name.includes('分组') || name.includes('group') || name.includes('班级') || name.includes('class'))) {
                    detectedIndex = index;
                }
            });
            groupColumnSelect.value = detectedIndex;
            selectedGroupColumnIndex = detectedIndex;
        }

        function initFilterColumnSelector() {
            if (!excelData || excelData.length === 0) return;
            populateColumnSelect(filterColumnSelect, false);
            selectedFilterColumnIndex = 0;
            filterColumnSelect.value = 0;
            updateFilterValueOptions();
        }

        function updateFilterValueOptions() {
            const previousValue = selectedFilterValue;
            const values = [];
            const seen = new Set();
            excelData.slice(1).forEach(row => {
                const value = getCellText(row[selectedFilterColumnIndex]);
                if (!seen.has(value)) {
                    seen.add(value);
                    values.push(value);
                }
            });
            filterValueSelect.innerHTML = '';
            values.forEach(value => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value || '（空白）';
                filterValueSelect.appendChild(option);
            });
            selectedFilterValue = seen.has(previousValue) ? previousValue : (values[0] || '');
            filterValueSelect.value = selectedFilterValue;
        }

        function generateGroupsFromColumn(groupColumnIndex) {
            if (groupColumnIndex < 0 || !excelData || excelData.length < 2) {
                tempImportGroups = [];
                return;
            }
            resetColorIndex();
            const groupMap = new Map();
            getImportRows().forEach(row => {
                const sourceValue = getCellText(row[groupColumnIndex]);
                if (!sourceValue) return;
                if (!groupMap.has(sourceValue)) {
                    groupMap.set(sourceValue, {
                        id: generateId('g'),
                        sourceValue: sourceValue,
                        name: sourceValue,
                        color: getNextDistinctColor(),
                        count: 0
                    });
                }
                groupMap.get(sourceValue).count++;
            });
            tempImportGroups = Array.from(groupMap.values());
        }

        // 渲染分组预览（纯渲染，事件由委托处理）
        function renderGroupPreview() {
            if (tempImportGroups.length === 0) {
                groupPreviewSection.style.display = 'none';
                return;
            }

            groupPreviewSection.style.display = 'block';

            groupPreviewList.innerHTML = tempImportGroups.map((group, index) => {
                return (
                    '<div class="group-preview-item" data-index="' + index + '">' +
                        '<div class="group-preview-color" style="background-color: ' + escapeHtml(group.color) + ';"></div>' +
                        '<div class="group-preview-info">' +
                            '<div class="group-preview-name">' +
                                '<input type="text" value="' + escapeHtml(group.name) + '" class="preview-group-name-input">' +
                            '</div>' +
                            '<div class="group-preview-count">数据行数: ' + group.count + '</div>' +
                        '</div>' +
                        '<div class="group-preview-edit">' +
                            '<input type="color" value="' + escapeHtml(group.color) + '" class="preview-group-color-input">' +
                        '</div>' +
                    '</div>'
                );
            }).join('');
        }

        // 分组预览事件委托
        groupPreviewList.addEventListener('change', function (e) {
            const target = e.target;
            const item = target.closest('.group-preview-item');
            if (!item) return;
            const index = parseInt(item.getAttribute('data-index'));
            if (!tempImportGroups[index]) return;
            if (target.classList.contains('preview-group-name-input')) {
                tempImportGroups[index].name = target.value;
                renderGroupPreview();
            } else if (target.classList.contains('preview-group-color-input')) {
                tempImportGroups[index].color = target.value;
                renderGroupPreview();
            }
        });

        // 处理分组导入启用状态变化
        function handleGroupImportToggle() {
            isGroupImportEnabled = enableGroupImport.checked;
            groupImportControls.style.display = isGroupImportEnabled ? 'block' : 'none';
            if (isGroupImportEnabled) {
                initFilterColumnSelector();
                initGroupColumnSelector();
                refreshImportPreview();
            } else {
                groupPreviewSection.style.display = 'none';
                rowFilterControls.style.display = 'none';
                filterSummary.textContent = '';
                tempImportGroups = [];
                tablePreview.innerHTML = createPreviewTable(excelData, selectedColumnIndex);
            }
        }

        // 处理分组列选择变化
        function handleGroupColumnChange() {
            selectedGroupColumnIndex = parseInt(groupColumnSelect.value);
            if (selectedGroupColumnIndex >= 0) {
                generateGroupsFromColumn(selectedGroupColumnIndex);
                renderGroupPreview();
            } else {
                groupPreviewSection.style.display = 'none';
                tempImportGroups = [];
            }
        }

        function refreshImportPreview() {
            const rows = getImportRows();
            const previewData = [excelData[0]].concat(rows);
            tablePreview.innerHTML = createPreviewTable(previewData, selectedColumnIndex);
            if (isGroupImportEnabled && enableRowFilter.checked) {
                filterSummary.textContent = '筛选后保留 ' + rows.length + ' 行，共 ' + Math.max(0, excelData.length - 1) + ' 行数据';
            } else {
                filterSummary.textContent = '';
            }
            if (isGroupImportEnabled && selectedGroupColumnIndex >= 0) {
                generateGroupsFromColumn(selectedGroupColumnIndex);
                renderGroupPreview();
            }
        }

        // ==================== Excel 导入辅助函数 ====================

        // 判断一个字符是否为 emoji（覆盖常用 emoji 范围）
        function isEmojiChar(ch) {
            if (!ch) return false;
            const code = ch.codePointAt(0);
            // 常见 emoji 范围
            if (code >= 0x1F000 && code <= 0x1FAFF) return true;
            if (code >= 0x2600 && code <= 0x27BF) return true; // 杂项符号 + dingbats
            if (code === 0xFE0F) return true; // variation selector
            if (code >= 0x1F300 && code <= 0x1F9FF) return true;
            if (code >= 0x1FA70 && code <= 0x1FAFF) return true; // 扩展 emoji
            if (code >= 0x2B00 && code <= 0x2BFF) return true; // 箭头 & 几何
            if (code >= 0x2300 && code <= 0x23FF) return true; // 技术符号
            return false;
        }

        // 从字符串开头提取 emoji（可能是多个 code point 的组合）
        function extractLeadingEmoji(str) {
            if (!str) return { emoji: '', rest: '' };
            let emoji = '';
            let i = 0;
            while (i < str.length) {
                const ch = str[i];
                if (isEmojiChar(ch)) {
                    emoji += ch;
                    i++;
                    // 处理 surrogate pair
                    if (ch >= '\uD800' && ch <= '\uDBFF' && i < str.length) {
                        emoji += str[i];
                        i++;
                    }
                } else {
                    break;
                }
            }
            return { emoji: emoji, rest: str.slice(i).trim() };
        }

        // 解析性别文本
        function parseGenderText(text) {
            if (!text) return '';
            // 去除 VS16 变体选择符(♂️ = ♂ + U+FE0F)及首尾空白,保证 emoji 与裸符号互通
            const lower = text.trim().toLowerCase().replace(/\uFE0F/g, '');
            if (lower === '男' || lower === 'male' || lower === 'm' || lower === '♂' || lower === 'boy' || lower === '1') return 'male';
            if (lower === '女' || lower === 'female' || lower === 'f' || lower === '♀' || lower === 'girl' || lower === '2') return 'female';
            return '';
        }

        // 根据标签文本自动选择一个 emoji（尽量与语义相关，且不与已有 emoji 重复）
        // 关键词 → emoji 映射（覆盖常见学校场景）
        const EMOJI_KEYWORD_MAP = [
            { keywords: ['班长', '班主任', '班干部', 'leader', 'chief'], emoji: '👑', boundary: true },
            { keywords: ['副班长', 'vice'], emoji: '🥈', boundary: true },
            { keywords: ['学习委员', '学霸'], emoji: '📚', boundary: true },
            { keywords: ['学习', '成绩', '第一名', 'top', 'study'], emoji: '📚' },
            { keywords: ['体育委员'], emoji: '⚽', boundary: true },
            { keywords: ['体育', '运动', '跑步', '篮球', '足球', 'sport'], emoji: '⚽' },
            { keywords: ['文艺委员'], emoji: '🎨', boundary: true },
            { keywords: ['艺术', '音乐', '唱歌', '舞蹈', 'art', 'music'], emoji: '🎨' },
            { keywords: ['文艺', '美术', '画', 'painting', 'draw'], emoji: '🖌' },
            { keywords: ['科学', '实验', 'science', 'lab'], emoji: '🔬' },
            { keywords: ['数学', 'math', '计算'], emoji: '➗' },
            { keywords: ['英语', 'english', '外语'], emoji: '🔤' },
            { keywords: ['语文', 'chinese'], emoji: '📖' },
            { keywords: ['物理', 'physics'], emoji: '⚛' },
            { keywords: ['化学', 'chemistry'], emoji: '🧪' },
            { keywords: ['生物', 'biology'], emoji: '🧬' },
            { keywords: ['地理', 'geography'], emoji: '🌍' },
            { keywords: ['历史', 'history'], emoji: '📜' },
            { keywords: ['劳动', '值日', '卫生', 'clean'], emoji: '🧹' },
            { keywords: ['纪律', '安静', 'discipline'], emoji: '🤫' },
            { keywords: ['迟到', 'late', '旷课'], emoji: '⏰' },
            { keywords: ['优秀', '真棒', 'great', 'good'], emoji: '🌟' },
            { keywords: ['进步', 'improve', 'progress'], emoji: '📈' },
            { keywords: ['潜力', 'potential'], emoji: '💎' },
            { keywords: ['需关注', 'attention', 'warning'], emoji: '⚠️', boundary: true },
            { keywords: ['国', 'china', '中国'], emoji: '🇨🇳' },
            { keywords: ['男', 'boy', 'male'], emoji: '♂️' },
            { keywords: ['女', 'girl', 'female'], emoji: '♀️' },
            { keywords: ['小组', 'group', 'team'], emoji: '👥' },
            { keywords: ['家长', 'parent', 'mom', 'dad'], emoji: '👨‍👩‍👧' },
            { keywords: ['走读', 'day'], emoji: '🏠', boundary: true },
            { keywords: ['住宿', '寄宿', 'board'], emoji: '🏫', boundary: true },
            { keywords: ['生日', 'birthday'], emoji: '🎂', boundary: true },
        ];
        // 备用 emoji 池（不依赖关键词匹配时从中选取）
        const FALLBACK_EMOJI_POOL = ['📌', '📍', '💡', '🔥', '🎯', '🚀', '🎉', '🌈', '🔖', '🏷', '🎭', '🎪', '🎁', '✨', '💫', '⚡', '🌊', '🍀', '🌸', '🌻', '🐼', '🦊', '🐰', '🐱', '🐶'];

// P1 批次4:#3 labelToEmojiMap 外置 — 把嵌套的两层数组预展平为 keyword→emoji 一维表,
// 让 autoAssignEmoji 内的命中检查从「31 entries × N keywords × indexOf」改成单层 N 次 indexOf
// (对 1000-行 xlsx 第一遍扫描省一层循环间接)
//
// P1 UX #2:同一表多了 `boundary` 标记 — 整词优先匹配条目(keyword 必须出现在 label 中且其前后不接续字母/汉字)
// 排序:先 boundary=true(整词优先);同优先级按 keyword.length DESC(更具体优先) ——
const KEYWORD_TO_EMOJI_FLAT = (function () {
            const flat = [];
            for (let i = 0; i < EMOJI_KEYWORD_MAP.length; i++) {
                const entry = EMOJI_KEYWORD_MAP[i];
                for (let j = 0; j < entry.keywords.length; j++) {
                    flat.push({
                        keyword: entry.keywords[j],
                        emoji: entry.emoji,
                        boundary: !!entry.boundary
                    });
                }
            }
            flat.sort(function (a, b) {
                if (a.boundary !== b.boundary) return a.boundary ? -1 : 1;
                return b.keyword.length - a.keyword.length;
            });
            return flat;
        })();
// 注:labelToEmojiMap 与 usedEmojis Set 由调用方(parseTagValue 的唯一调用点
// importStudentsWithGroups)在 row 循环外一次性构造并作为参数传入复用 ——
// 一次导入 1000 行只构造一次 Map/Set,而不每行新建。Review v1.3.0 §六 D-3 提到的
// "1000+ 行 xlsx 重复构造"问题已在重构阶段解决。

// P1 UX #2:整词匹配判断 — Chinese chars 视为 word chars,keyword 出现在 label 中且
// 其前、后位置至少一侧不接续字母/汉字(可在 label 端点)。这避免了「学籍」误匹配「学」之类的
// 子串包含场景(若 boundary 项是独立 entry);也避免「top」匹配「stoptop」之类的英文子串。
function isWholeWordMatch(label, keyword) {
            const lower = label.toLowerCase();
            const wordCharRe = /[\u4e00-\u9fa5a-zA-Z0-9]/;
            let idx = lower.indexOf(keyword);
            while (idx >= 0) {
                const before = idx === 0 ? '' : lower.charAt(idx - 1);
                const afterIdx = idx + keyword.length;
                const after = afterIdx >= lower.length ? '' : lower.charAt(afterIdx);
                if (!wordCharRe.test(before) && !wordCharRe.test(after)) {
                    return true;
                }
                idx = lower.indexOf(keyword, idx + 1);
            }
            return false;
        }

        function autoAssignEmoji(label, usedEmojis) {
            if (!usedEmojis) usedEmojis = new Set();
            const labelLower = label.toLowerCase();
            // 1. 整词优先 (boundary=true) — 避免「学籍」误匹配「学」类子串误判
            for (let i = 0; i < KEYWORD_TO_EMOJI_FLAT.length; i++) {
                const entry = KEYWORD_TO_EMOJI_FLAT[i];
                if (!entry.boundary) continue;
                if (labelLower.indexOf(entry.keyword) < 0) continue;
                if (!isWholeWordMatch(label, entry.keyword)) continue;
                if (usedEmojis.has(entry.emoji)) continue;
                usedEmojis.add(entry.emoji);
                return entry.emoji;
            }
            // 2. 子串兜底 — 与 P1 批次4 相同的扁平单层循环
            for (let i = 0; i < KEYWORD_TO_EMOJI_FLAT.length; i++) {
                const entry = KEYWORD_TO_EMOJI_FLAT[i];
                if (entry.boundary) continue; // 整词不匹配的不再来兜底
                if (labelLower.indexOf(entry.keyword) < 0) continue;
                if (usedEmojis.has(entry.emoji)) continue;
                usedEmojis.add(entry.emoji);
                return entry.emoji;
            }
            // 3. 关键词无匹配或 emoji 已被占用：从备用池选第一个未被占用的
            for (let i = 0; i < FALLBACK_EMOJI_POOL.length; i++) {
                if (!usedEmojis.has(FALLBACK_EMOJI_POOL[i])) {
                    usedEmojis.add(FALLBACK_EMOJI_POOL[i]);
                    return FALLBACK_EMOJI_POOL[i];
                }
            }
            // 4. 全部用完：返回🏷（极端情况）
            return '🏷';
        }

        // 解析标签值：如果以 emoji 开头，自动拆分 emoji 和 label；否则自动分配 emoji
        // 检查 emoji 是否被不同 label 占用（已有标签或本次导入中已登记的），是则重新分配
        function resolveEmojiConflict(emoji, label, usedEmojis, emojiToLabelMap) {
            if (!emojiToLabelMap) return emoji;
            const ownerLabel = emojiToLabelMap.get(emoji);
            if (ownerLabel && ownerLabel !== label) {
                // emoji 已被不同 label 占用 → 重新分配一个不冲突的
                const newEmoji = autoAssignEmoji(label, usedEmojis);
                emojiToLabelMap.set(newEmoji, label);
                return newEmoji;
            }
            return emoji;
        }

        function parseTagValue(text, usedEmojis, labelToEmojiMap, emojiToLabelMap) {
            if (!text) return [];
            const trimmed = text.trim();
            if (!trimmed) return [];
            // 支持多个标签用逗号/分号/顿号分隔
            const parts = trimmed.split(/[,，;；、]/);
            const result = [];
            parts.forEach(function (part) {
                const trimmedPart = part.trim();
                if (!trimmedPart) return;
                const extracted = extractLeadingEmoji(trimmedPart);
                const label = extracted.rest || trimmedPart;
                let emoji;
                if (extracted.emoji) {
                    // 有 emoji 前缀：先用，但可能冲突需要替换
                    emoji = extracted.emoji;
                } else if (labelToEmojiMap && labelToEmojiMap.has(label)) {
                    // 无 emoji 前缀，但标签名已存在 → 复用已有 emoji（必然不冲突，因为同名同 emoji）
                    emoji = labelToEmojiMap.get(label);
                } else {
                    // 完全新标签：自动分配 emoji（autoAssignEmoji 已避开 usedEmojis，不会冲突）
                    emoji = autoAssignEmoji(label, usedEmojis);
                    if (labelToEmojiMap) labelToEmojiMap.set(label, emoji);
                    if (emojiToLabelMap) emojiToLabelMap.set(emoji, label);
                    if (usedEmojis) usedEmojis.add(emoji);
                    result.push({ emoji: emoji, label: label });
                    return; // 已经安全分配，不需要后续校验
                }

                // 至此 emoji 已确定（分支1或分支2），需要校验冲突
                emoji = resolveEmojiConflict(emoji, label, usedEmojis, emojiToLabelMap);
                // 登记
                if (usedEmojis) usedEmojis.add(emoji);
                if (emojiToLabelMap) emojiToLabelMap.set(emoji, label);
                if (labelToEmojiMap) labelToEmojiMap.set(label, emoji);
                result.push({ emoji: emoji, label: label });
            });
            return result;
        }

        // 导入学生并应用分组
        function importStudentsWithGroups(nameColumnIndex) {
            const newStudents = [];
            const sourceValueToId = new Map();
            const groupsToAdd = [];
            const groupsToUpdate = [];
            if (isGroupImportEnabled && tempImportGroups.length > 0) {
                tempImportGroups.forEach(group => {
                    const existingGroup = groups.find(item => item.name === group.name);
                    if (existingGroup) {
                        groupsToUpdate.push({ group: existingGroup, color: group.color });
                        sourceValueToId.set(group.sourceValue, existingGroup.id);
                    } else {
                        const newGroup = { id: group.id, name: group.name, color: group.color };
                        groupsToAdd.push(newGroup);
                        sourceValueToId.set(group.sourceValue, newGroup.id);
                    }
                });
            }

            // 收集已有学生的所有标签 emoji，用于自动分配时避免重复
            const usedEmojis = new Set();
            const existingLabelToEmoji = new Map(); // label → emoji 映射，相同标签名复用 emoji
            const existingEmojiToLabel = new Map(); // emoji → label 映射，emoji 冲突检测
            students.forEach(function (s) {
                if (s.tags) s.tags.forEach(function (t) {
                    if (t.emoji) {
                        usedEmojis.add(t.emoji);
                        if (!existingLabelToEmoji.has(t.label)) existingLabelToEmoji.set(t.label, t.emoji);
                        if (!existingEmojiToLabel.has(t.emoji)) existingEmojiToLabel.set(t.emoji, t.label);
                    }
                });
            });

            getImportRows().forEach(row => {
                const name = getCellText(row[nameColumnIndex]);
                if (!name) return;
                let groupId = null;
                if (isGroupImportEnabled && selectedGroupColumnIndex >= 0) {
                    groupId = sourceValueToId.get(getCellText(row[selectedGroupColumnIndex])) || null;
                }
                // 解析性别
                let gender = '';
                if (isGenderImportEnabled && selectedGenderColumnIndex >= 0) {
                    gender = parseGenderText(getCellText(row[selectedGenderColumnIndex]));
                }
                // 解析标签
                let tags = [];
                if (isTagImportEnabled && selectedTagColumnIndex >= 0) {
                    tags = parseTagValue(getCellText(row[selectedTagColumnIndex]), usedEmojis, existingLabelToEmoji, existingEmojiToLabel);
                }
                newStudents.push({ id: generateId('s'), name: name, groupId: groupId, checkedIn: false, gender: gender, tags: tags });
            });

            if (newStudents.length === 0) {
                fileInfo.innerHTML = '<span style="color:red">筛选结果中未找到学生名单，请检查筛选条件和姓名列</span>';
                return;
            }

            pushSnapshot('import');
            students = newStudents;
            groupsToUpdate.forEach(item => {
                item.group.color = item.color;
            });
            groups.push(...groupsToAdd);

            // 更新UI
            fileInfo.innerHTML = '<span style="color:green">成功导入 ' + students.length + ' 名学生' +
                (isGroupImportEnabled && tempImportGroups.length > 0 ? '，' + tempImportGroups.length + '个分组' : '') + '</span>';
            generateStudentList();
            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            previewArea.style.display = 'none';

            // 尝试按姓名匹配旧座位配置（兼容旧数据）
            const savedConfig = localStorage.getItem('classroomConfig');
            if (savedConfig) {
                try {
                    const config = JSON.parse(savedConfig);
                    migrateConfig(config);
                    if (config.seats && config.students) {
                        const oldNameToNewId = new Map(newStudents.map(s => [s.name, s.id]));
                        const oldIdToName = new Map(config.students.map(s => [s.id, s.name]));
                        currentSeats = config.seats.map(seatVal => {
                            if (!seatVal) return null;
                            const oldName = oldIdToName.get(seatVal) || seatVal;
                            return oldNameToNewId.get(oldName) || null;
                        });
                        // 调整座位数组长度
                        const targetLen = rows * cols;
                        if (currentSeats.length < targetLen) {
                            currentSeats = currentSeats.concat(Array(targetLen - currentSeats.length).fill(null));
                        } else if (currentSeats.length > targetLen) {
                            currentSeats = currentSeats.slice(0, targetLen);
                        }
                    }
                    generateSeats();
                } catch (e) {
                    console.error('匹配旧座位配置失败:', e);
                    generateSeats();
                }
            } else {
                generateSeats();
            }
            commit({ students: students, groups: groups, seats: currentSeats });
            autoSave();
        }

        // ==================== 分组导入相关函数结束 ====================

        // ─────────── 座位网格渲染模块 (modules/seat-grid.js) ───────────
        // 4 个原 IIFE 函数已抽离到独立 ES module:
        //   - generateSeats()               渲染整个座位表(讲台/座位/走道/统计)
        //   - generateGridTemplateColumns() CSS grid 列模板(含走道)
        //   - updateStatistics()            头部统计卡(总数/已排/未排)
        //   - updateCheckinStats()          签到模式进度条与统计
        // 模块内部从 state.* 直读(path-A2 等价行为);
        // 实例化时显式注入依赖(classroom / getView / helpers / callbacks),
        // 主 IIFE 内 50+ 处既有调用点零修改(顶层 const 别名承接)。
        const seatGrid = createSeatGrid({
            classroom,                                              // #classroom DOM 引用(IIFE 顶部缓存)
            getView: () => isTeacherView,                            // 懒读:每次 generateSeats 调用时取最新视角
            helpers: {
                escapeHtml,
                adjustColor,
                isLightColor,
                getStudentById,
                getStudentGroupColor
            },
            callbacks: {
                onUpdateToggleIconsBtnText: updateToggleIconsBtnText,
                onToggleCheckinMode: toggleCheckinMode,
                onPushSnapshot: pushSnapshot,
                onGenerateStudentList: generateStudentList,
                onAutoSave: autoSave,
                // 分组 banner 每次全量重建后回填内容(视角切换 / 行列变更 / 走道变更等)
                onRenderGroupBannerContent: renderGroupBannerContent,
                // 座位渲染出口:刷新配对设置弹窗里各配对的满足状态底色
                onAfterSeatsRender: afterSeatsRender,
                // 座位附加 class:性别规则未达成的同桌座位 ⇒ 缓慢闪烁提示
                onGetSeatExtraClass: getSeatGenderHintClass
            }
        });
        // 顶层别名 — 保留主 IIFE 内既有调用点零修改
        const generateSeats = seatGrid.generateSeats;
        const generateGridTemplateColumns = seatGrid.generateGridTemplateColumns;
        const updateStatistics = seatGrid.updateStatistics;
        const updateCheckinStats = seatGrid.updateCheckinStats;
        const refreshSeatExtraClasses = seatGrid.refreshSeatExtraClasses;

        // 退出分组模式(进入其他模式 / 退出时调用)
        function exitGroupMode() {
            if (!isGroupMode) return;
            isGroupMode = false;
            state.isGroupMode = false;
            commit({ isGroupMode: false });
            classroom.classList.remove('group-mode');
            groupModeSelectedIds.clear();
            clearGroupModeSelection();
            groupFocusId = null;
            groupCurrentStudentId = null;
            applyGroupFocusHighlight();
            setStatsRowMode('normal');
            updateModeSwitchButton();
        }

        // 「切换模式」按钮:点击在 普通 → 签到 → 分组 → 普通 三态间轮换
        function cycleMode() {
            if (isCheckinMode) {
                toggleGroupMode();      // 签到 → 分组(内部先退出签到)
            } else if (isGroupMode) {
                toggleGroupMode();      // 分组 → 普通
            } else {
                toggleCheckinMode();    // 普通 → 签到
            }
        }

        // 进入/退出签到模式(与分组模式互斥)
        function toggleCheckinMode() {
            if (typeof clearTapSelection === 'function') clearTapSelection();
            clearDragHighlights();
            // 与分组模式互斥:进入签到前先退出分组模式
            if (!isCheckinMode && isGroupMode) exitGroupMode();
            isCheckinMode = !isCheckinMode;
            state.isCheckinMode = isCheckinMode;
            commit({ isCheckinMode: isCheckinMode });
            updateModeSwitchButton();
            if (isCheckinMode) {
                classroom.classList.add('checkin-mode');
                setStatsRowMode('checkin');
            } else {
                classroom.classList.remove('checkin-mode');
                setStatsRowMode('normal');
            }
            generateSeats();
            updateCheckinStats();
            if (typeof updateMobileBanner === 'function') updateMobileBanner();
        }

        // 进入/退出分组模式(座位表多选学生 → 批量分配到分组;与签到模式互斥)
        function toggleGroupMode() {
            if (typeof clearTapSelection === 'function') clearTapSelection();
            clearDragHighlights();
            // 与签到模式互斥:进入分组前先退出签到
            if (!isGroupMode && isCheckinMode) {
                isCheckinMode = false;
                state.isCheckinMode = false;
                commit({ isCheckinMode: false });
                classroom.classList.remove('checkin-mode');
                setStatsRowMode('normal');
                updateCheckinStats();
            }
            isGroupMode = !isGroupMode;
            state.isGroupMode = isGroupMode;
            commit({ isGroupMode: isGroupMode });
            updateModeSwitchButton();
            if (isGroupMode) {
                classroom.classList.add('group-mode');
                setStatsRowMode('group');
            } else {
                classroom.classList.remove('group-mode');
                groupModeSelectedIds.clear();
                clearGroupModeSelection();
                groupFocusId = null;
                groupCurrentStudentId = null;
                applyGroupFocusHighlight();
                setStatsRowMode('normal');
            }
            generateSeats();
            // 分组 banner 由 generateSeats 重建,内容需在重建后回填
            if (isGroupMode) {
                renderGroupModeList();
                updateGroupModeCount();
            }
            if (typeof updateMobileBanner === 'function') updateMobileBanner();
        }

        // 从预设调色板取一个分组颜色(按现有分组数循环)
        function pickGroupColor() {
            const palette = ['#FF9F9F', '#9FCFFF', '#9FFFBE', '#FFE59F', '#E59FFF', '#9FFFF0', '#FFB39F', '#C9F59F'];
            return palette[groups.length % palette.length];
        }

        // 渲染分组模式工具栏中的分组按钮(点击即把选中的座位学生分配到该组)
        function renderGroupModeList() {
            // banner 会随座位表重建 ⇒ 每次按 id 现取,不用缓存引用
            const list = document.getElementById('groupModeList');
            if (!list) return;
            if (groups.length === 0) {
                list.innerHTML = '<span class="group-mode-empty">暂无分组</span>';
                return;
            }
            list.innerHTML = groups.map(function (g) {
                return '<button type="button" class="group-mode-group-btn' +
                    (g.id === groupFocusId ? ' active' : '') + '" data-group-id="' +
                    escapeHtml(g.id) + '" title="未选学生时点击：查看「' +
                    escapeHtml(g.name) + '」成员；选中学生后点击：分配到该组；长按：删除该分组"' +
                    (g.color ? ' style="background:' + escapeHtml(g.color) + '"' : '') + '>' +
                    escapeHtml(g.name) + '</button>';
            }).join('');
        }

        // 清除座位表上的选中高亮
        function clearGroupModeSelection() {
            document.querySelectorAll('.seat.group-selected').forEach(function (el) {
                el.classList.remove('group-selected');
            });
            updateGroupModeCount();
        }

        // 把当前选中的座位学生统一分配到指定分组(并清空选择)
        function assignSelectedToGroup(groupId) {
            if (groupModeSelectedIds.size === 0) return;
            pushSnapshot('group');
            groupModeSelectedIds.forEach(function (id) {
                const student = getStudentById(id);
                if (student) student.groupId = groupId;
            });
            groupModeSelectedIds.clear();
            groupCurrentStudentId = null;
            // 分配完成 ⇒ 顺势查看目标分组(高亮其成员 + 统计栏展示),给出完成反馈
            groupFocusId = groupId;
            clearGroupModeSelection();
            generateSeats();
            updateStudentAssignmentDisplay();
            generateStudentList();
            updateGroupDisplay();
            autoSave();
        }

        function updateGroupModeCount() {
            const el = document.getElementById('groupModeCount');
            if (el) {
                el.textContent = '已选 ' + groupModeSelectedIds.size + ' 名学生';
            }
            // 「取消选择」仅在已有多选时出现
            const clearBtn = document.getElementById('groupModeClearBtn');
            if (clearBtn) {
                clearBtn.style.display = groupModeSelectedIds.size > 0 ? '' : 'none';
            }
            // 普通模式下一旦有多选,统计栏要切到三槽的「多选视图」
            updateStatsRowVisibility();
            // 选中人数变化 ⇒ 统计栏在多选视图 / 分组视图之间切换
            updateGroupStatsRow();
        }

        // 统计行可见性(四选一):签到 > 分组 > 普通模式多选 > 普通
        // 普通模式多选时复用分组那套三槽行(当前学生 / 所属分组 / 已选人数)。
        function updateStatsRowVisibility() {
            if (isCheckinMode) { setStatsRowMode('checkin'); return; }
            if (isGroupMode) { setStatsRowMode('group'); return; }
            if (groupModeSelectedIds.size > 0) { setStatsRowMode('group'); return; }
            setStatsRowMode('normal');
        }

        // 一键取消当前多选(分组 banner「取消选择」按钮 / 普通模式点空白区域)
        function clearMultiSelection(options) {
            options = options || {};
            if (groupModeSelectedIds.size === 0) return false;
            groupModeSelectedIds.clear();
            clearGroupModeSelection();      // 内部会再调 updateGroupModeCount → 刷新统计栏
            if (options.toast !== false && typeof showStatToast === 'function') {
                showStatToast('已取消选择');
            }
            return true;
        }

        // 分组 banner 的壳子由 seat-grid 在每次全量重建时重新生成(节点全新),
        // 内容必须重建后回填 — 否则切换视角 / 改行列 / 改走道后分组按钮会整排消失。
        function renderGroupBannerContent() {
            if (!isGroupMode) return;
            renderGroupModeList();
            updateGroupModeCount();
            // 座位表重建会抹掉自定义 class ⇒ 每次渲染出口重新贴高亮
            applyGroupFocusHighlight();
            updateGroupStatsRow();
        }

        // 切换统计栏:普通 / 签到 / 分组 三选一可见
        function setStatsRowMode(mode) {
            const ns = document.getElementById('normalStatsRow');
            const cs = document.getElementById('checkinStatsRow');
            const gs = document.getElementById('groupStatsRow');
            if (ns) ns.style.display = mode === 'normal' ? 'flex' : 'none';
            if (cs) cs.style.display = mode === 'checkin' ? 'flex' : 'none';
            if (gs) gs.style.display = mode === 'group' ? 'flex' : 'none';
        }

        // 按当前轮换步长,算出 groupId 将轮换到的目标分组
        function getGroupRotateTarget(groupId) {
            if (!groups.length) return null;
            if (groups.length === 1) return groups[0];
            const idx = groups.findIndex(function (g) { return g.id === groupId; });
            if (idx < 0) return null;
            const step = normalizeRotateOffset(groupRotateOffset);
            return groups[(idx + step) % groups.length];
        }

        // 分组模式统计栏(三项等宽,风格与签到/普通模式一致):
        //   多选学生中 ⇒ 当前学生 / 所属分组 / 已选人数(可点菜单)
        //   查看某分组 ⇒ 当前分组 / 分组人数(可点菜单) / 即将轮换到
        //   其余情况   ⇒ 未选择 / 0 / —
        function updateGroupStatsRow() {
            const slots = [1, 2, 3].map(function (i) {
                return {
                    box: document.getElementById('groupStatSlot' + i),
                    val: document.getElementById('groupStatVal' + i),
                    label: document.getElementById('groupStatLabel' + i)
                };
            });
            if (!slots[0].box || !slots[0].val || !slots[0].label) return;

            // statId 非空 ⇒ 该块可点击(弹出复制姓名 / 下载 Excel 菜单)
            const setSlot = function (i, value, label, statId, color, title) {
                const s = slots[i];
                s.val.textContent = value;
                s.val.style.color = color || '';
                s.val.title = title || String(value);
                s.label.textContent = label;
                if (statId) {
                    s.box.setAttribute('data-stat', statId);
                    s.box.classList.remove('stat-block-static');
                    s.box.removeAttribute('tabindex');
                    s.box.title = '点击：复制姓名 / 下载 Excel';
                    s.box.setAttribute('aria-label', label + '，点击复制姓名或下载 Excel');
                } else {
                    s.box.removeAttribute('data-stat');
                    s.box.classList.add('stat-block-static');
                    s.box.setAttribute('tabindex', '-1');
                    s.box.removeAttribute('title');
                    s.box.removeAttribute('aria-label');
                }
            };

            // ── 多选学生中:优先展示本次多选的上下文 ──
            if (groupModeSelectedIds.size > 0) {
                const cur = groupCurrentStudentId ? getStudentById(groupCurrentStudentId) : null;
                const grp = cur && cur.groupId
                    ? groups.find(function (g) { return g.id === cur.groupId; })
                    : null;
                setSlot(0, cur ? cur.name : '—', '当前学生', '', '', '');
                setSlot(1, grp ? grp.name : '未分组', '所属分组', '', grp ? grp.color : '', '');
                setSlot(2, String(groupModeSelectedIds.size), '已选人数', 'groupSelected', '', '');
                return;
            }

            // ── 查看某分组 ──
            const group = groupFocusId
                ? groups.find(function (g) { return g.id === groupFocusId; })
                : null;
            if (!group) {
                // 分组被删除 / 配置变更后聚焦项失效 ⇒ 清掉,避免残留高亮
                groupFocusId = null;
                setSlot(0, '未选择', '当前分组', '', '', '点击 banner 中的分组按钮查看该组');
                setSlot(1, '0', '分组人数', '', '', '');
                setSlot(2, '—', '即将轮换到', '', '', '');
                return;
            }

            const members = students.filter(function (s) { return s.groupId === group.id; });
            const target = getGroupRotateTarget(group.id);
            const step = normalizeRotateOffset(groupRotateOffset);
            setSlot(0, group.name, '当前分组', '', group.color, group.name);
            setSlot(1, String(members.length), '分组人数', 'groupMembers', '', '');
            setSlot(2, target ? target.name : '—', '即将轮换到',
                '', target ? target.color : '', target ? ('+' + step + ' → ' + target.name) : '');
        }

        // 分组统计栏里「可点」的块由 updateGroupStatsRow 动态赋予 data-stat,
        // initStatBlockActions 在初始化时绑定不到 ⇒ 这里单独走事件委托。
        (function bindGroupStatsRowActions() {
            const row = document.getElementById('groupStatsRow');
            if (!row) return;
            row.addEventListener('click', function (e) {
                const block = e.target.closest('.stat-block[data-stat]');
                if (!block) return;
                const statId = block.getAttribute('data-stat');
                if (!statId) return;
                e.stopPropagation();
                const ctx = getStatContext(statId);
                if (!ctx.students.length) {
                    showStatToast(ctx.title + '：暂无学生');
                    return;
                }
                const rect = block.getBoundingClientRect();
                showStatActionMenu(statId, rect.left + rect.width / 2, rect.bottom);
            });
        })();

        // 高亮聚焦分组的成员:座位表 .seat + 未入座名单 .student-item
        function applyGroupFocusHighlight() {
            const idSet = new Set();
            if (groupFocusId) {
                students.forEach(function (s) {
                    if (s.groupId === groupFocusId) idSet.add(s.id);
                });
            }
            classroom.querySelectorAll('.seat').forEach(function (seat) {
                const sid = seat.getAttribute('data-student');
                seat.classList.toggle('group-highlight', !!(sid && idSet.has(sid)));
            });
            studentList.querySelectorAll('.student-item').forEach(function (item) {
                const sid = item.getAttribute('data-student');
                item.classList.toggle('group-highlight', !!(sid && idSet.has(sid)));
            });
        }

        // 聚焦某分组(未选中学生时点击分组按钮);再次点击同一分组 ⇒ 取消聚焦
        function focusGroupMode(groupId) {
            if (!isGroupMode) return;
            groupFocusId = (groupFocusId === groupId) ? null : groupId;
            applyGroupFocusHighlight();
            renderGroupModeList();
            updateGroupStatsRow();
        }

        function clearGroupFocus() {
            groupFocusId = null;
            applyGroupFocusHighlight();
            renderGroupModeList();
            updateGroupStatsRow();
        }

        // 进入多选状态时清掉分组查看态:避免整组橙色高亮抢走「多选学生」的视觉焦点。
        // 查看态只在「点击 banner 分组按钮」这一条路径上进入。
        function dropGroupFocusIfViewing() {
            if (!groupFocusId) return;
            groupFocusId = null;
            applyGroupFocusHighlight();
            renderGroupModeList();
        }

        // 切换学生签到状态
        function toggleStudentCheckin(studentId) {
            const student = getStudentById(studentId);
            if (!student) return;

            pushSnapshot('checkin');
            student.checkedIn = !student.checkedIn;
            generateSeats();
        }

        function getUnassignedStudents() {
            const assignedIds = new Set(currentSeats.filter(s => s !== null));
            return students.filter(s => !assignedIds.has(s.id));
        }

        // 生成学生名单（只显示未安排座位的学生）
        function generateStudentList() {
            studentList.innerHTML = '';
            const unassigned = getUnassignedStudents();

            if (unassigned.length === 0) {
                studentList.innerHTML = '<p style="margin:0;font-size:13px;color:var(--text-muted);text-align:center;padding:20px 0;">所有学生已安排座位</p>';
                if (isGroupMode) applyGroupFocusHighlight();
                updateStatistics();
                updateCheckinStats();
                return;
            }

            unassigned.forEach(student => {
                const studentItem = document.createElement('div');
                studentItem.className = 'student-item';
                studentItem.setAttribute('data-student', student.id);
                studentItem.draggable = !isTouchDevice && !isCheckinMode;

                const nameSpan = document.createElement('span');
                nameSpan.className = 'student-name';
                nameSpan.textContent = student.name;
                studentItem.appendChild(nameSpan);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'student-delete';
                deleteBtn.innerHTML = '×';
                deleteBtn.title = '删除学生';
                deleteBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    removeStudent(student.id);
                });
                studentItem.appendChild(deleteBtn);

                const groupColor = getStudentGroupColor(student.id);
                if (groupColor) {
                    studentItem.style.backgroundColor = groupColor;
                    studentItem.style.color = isLightColor(groupColor) ? '#000' : '#fff';
                }

                if (!isTouchDevice && !isCheckinMode) {
                    dragdrop.attachStudentItemDragstart(studentItem, student);
                }

                studentList.appendChild(studentItem);
            });

            // 名单整体重建 ⇒ 重新贴上聚焦分组的高亮
            if (isGroupMode) applyGroupFocusHighlight();
            updateStatistics();
            updateCheckinStats();
        }

        // ─────────── 拖放模块 (modules/dragdrop.js) ───────────
        // 7 个原 IIFE 函数 + studentList/deleteZone/classroom 静态区域事件绑定
        // + generateStudentList 中 student-item 的 batch dragstart 绑定
        // 全部抽离到独立 ES module。
        //
        // 模块私有 closure 状态(draggedStudentId / draggedFromIndex / dragStartTime)
        // 替代原 IIFE 顶层 let 别名,避免跨模块共享可变状态。
        // 模块内部从 state.* 直读(path-A2 等价行为);写路径通过 commit() 派发 change。
        const dragdrop = createDragdrop({
            classroom,                              // #classroom DOM
            studentList,                            // #studentList DOM
            deleteZone,                             // #deleteZone DOM
            dragHint,                               // #dragHint DOM
            helpers: {
                getStudentById
            },
            callbacks: {
                onPushSnapshot: pushSnapshot,
                onUpdateStudentAssignmentDisplay: updateStudentAssignmentDisplay,
                onGenerateSeats: generateSeats
            }
        });
        // 一次性绑定 studentList / deleteZone / classroom 静态区域事件
        dragdrop.attachEventListeners();
        // 顶层别名 — 保留主 IIFE 内既有调用点零修改(toggleCheckinMode 等)
        const clearDragHighlights = dragdrop.clearDragHighlights;
        const handleDrop = dragdrop.handleDrop;

        // 标题旁的日期(打印 / 导出图片时显示;屏幕上由 CSS 隐藏)
        function getTodayStr() {
            const now = new Date();
            return now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
        }

        function updateTitleDate() {
            if (titleDate) titleDate.textContent = getTodayStr();
        }

        // 标题编辑后自动保存
        pageTitle.addEventListener('input', autoSave);
        pageTitle.addEventListener('blur', function () {
            if (pageTitle.textContent.trim() === '') {
                pageTitle.textContent = '班级座位表';
                autoSave();
            }
        });

        // 导出座位表为图片
        function exportSeatImage() {
            // 临时隐藏班级座位内的按钮 + 拖拽提示(只动 #classroom 子树,绝不误伤 toolbar/popup)
            // 修复 P2-1:document.querySelectorAll('button') 会选到页面所有按钮,
            // 包括工具栏、弹窗、配置下拉等;它们不该被隐藏(导出图不含这些元素,
            // 但短暂闪烁体验差;且 30+ 节点遍历比 49 节点慢)。
            const buttons = classroom.querySelectorAll('button');
            buttons.forEach(btn => btn.style.visibility = 'hidden');
            dragHint.style.display = 'none';

            // 创建临时容器，包含标题和座位表，用于导出
            const exportWrapper = document.createElement('div');
            exportWrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;background:#fff;padding:20px;border-radius:8px;';
            // 复用页面上的标题行(标题 + 日期同一行),与打印保持一致。
            // 克隆后去掉 id/contenteditable,并强制显示日期(屏幕样式下它是 display:none)。
            const titleRow = document.querySelector('.page-title-row');
            const titleRowClone = titleRow ? titleRow.cloneNode(true) : null;
            if (titleRowClone) {
                const cloneTitle = titleRowClone.querySelector('h1');
                if (cloneTitle) {
                    cloneTitle.removeAttribute('id');
                    cloneTitle.removeAttribute('contenteditable');
                    cloneTitle.removeAttribute('spellcheck');
                    cloneTitle.style.cssText = 'margin:0 0 16px 0;font-size:24px;font-weight:700;text-align:center;cursor:default;background:none;box-shadow:none;position:static;transform:none;display:inline-block;left:auto;';
                }
                const cloneDate = titleRowClone.querySelector('.title-date');
                if (cloneDate) {
                    cloneDate.removeAttribute('id');
                    cloneDate.textContent = getTodayStr();
                    cloneDate.style.display = 'inline-block';
                    cloneDate.style.fontSize = '15px';
                    cloneDate.style.fontWeight = '400';
                    cloneDate.style.color = '#94a3b8';
                    cloneDate.style.marginLeft = '12px';
                }
                titleRowClone.style.cssText = 'text-align:center;margin-bottom:16px;';
                exportWrapper.appendChild(titleRowClone);
            }
            exportWrapper.appendChild(classroom.cloneNode(true));

            // 临时挂载到页面外
            exportWrapper.style.position = 'fixed';
            exportWrapper.style.left = '-9999px';
            exportWrapper.style.top = '0';
            document.body.appendChild(exportWrapper);

            // 使用html2canvas捕获包含标题的座位表
            html2canvas(exportWrapper, {
                backgroundColor: '#fff',
                scale: 2 // 提高导出图片质量
            }).then(canvas => {
                // 清理临时容器
                document.body.removeChild(exportWrapper);
                // 恢复按钮显示
                buttons.forEach(btn => btn.style.visibility = 'visible');

                // 创建下载链接，文件名使用当前标题
                const title = pageTitle.textContent.trim() || '班级座位表';
                const link = document.createElement('a');
                link.download = title + '_' + new Date().toLocaleDateString() + '.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
            }).catch(err => {
                document.body.removeChild(exportWrapper);
                console.error('导出图片失败:', err);
                buttons.forEach(btn => btn.style.visibility = 'visible');
                alert(MESSAGES.EXPORT_FAILED);
            });
        }

        // P1 UX #3:统一封装下拉按钮 — 同步 ARIA + 键盘 Enter/↓/Space 触发 + 内部 ↑↓/Enter/Esc 导航。
        // 取代原先智能排座/打印按钮的零散 click handler,既闭环 ARIA,又修下拉键盘可达性。
        // dropdown 元素 → 其 controller 的注册表。
        // 用途:两个下拉互斥关闭时,必须走对方的 close() 同步内部 isOpen;
        // 若只改 style.display,对方闭包里的 isOpen 会停留在 true,
        // 下次点它就执行了「关闭」—— 表现为「要点两下才弹出」。
        const dropdownCtrls = new WeakMap();

        function setupActionDropdown(btn, dropdown, peerBtn, peerDropdown) {
            let isOpen = false;
            // 将下拉改为 fixed 定位并按视口钳制,避免被 .controls 的 overflow:hidden 裁剪,
            // 也保证任何按钮(最左/最右)的下拉都不会超出屏幕。
            function positionDropdown() {
                const b = btn.getBoundingClientRect();
                const ddW = dropdown.offsetWidth;
                const ddH = dropdown.offsetHeight;
                let left = b.right - ddW;            // 自然对齐:下拉右缘对齐按钮右缘
                if (left < 8) left = b.left;         // 左缘越界则改左对齐
                left = Math.max(8, Math.min(left, window.innerWidth - ddW - 8));
                let top = b.bottom + 6;              // 自然对齐:下拉在按钮下方
                top = Math.max(8, Math.min(top, window.innerHeight - ddH - 8));
                dropdown.style.position = 'fixed';
                dropdown.style.left = left + 'px';
                dropdown.style.top = top + 'px';
                dropdown.style.right = 'auto';
            }
            function setOpen(open) {
                isOpen = open;
                dropdown.style.display = open ? 'block' : 'none';
                btn.setAttribute('aria-expanded', String(open));
                if (open) {
                    positionDropdown();
                    const firstItem = dropdown.querySelector('[role="menuitem"]');
                    if (firstItem) firstItem.focus();
                }
            }
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                // 关闭另一个下拉(互斥):走 close() 才能同步对方的 isOpen 与 aria-expanded
                const peerCtrl = peerDropdown ? dropdownCtrls.get(peerDropdown) : null;
                if (peerCtrl) {
                    peerCtrl.close();
                } else if (peerDropdown && peerBtn) {
                    peerDropdown.style.display = 'none';
                    peerBtn.setAttribute('aria-expanded', 'false');
                }
                // 以 DOM 实际显示状态为准翻转,避免 isOpen 被外部直接改 display 的操作带偏
                setOpen(dropdown.style.display !== 'block');
            });
            // 键盘 Enter / ↓ / Space 在按钮上 → 展开并聚焦首项
            btn.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (dropdown.style.display !== 'block') setOpen(true);
                } else if (e.key === 'Escape' && isOpen) {
                    e.preventDefault();
                    setOpen(false);
                }
            });
            // 内部菜单项的键盘导航
            dropdown.addEventListener('keydown', function (e) {
                const items = Array.from(dropdown.querySelectorAll('[role="menuitem"]'));
                const idx = items.indexOf(document.activeElement);
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = items[(idx + 1 + items.length) % items.length];
                    if (next) next.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = items[(idx - 1 + items.length) % items.length];
                    if (prev) prev.focus();
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    if (items[0]) items[0].focus();
                } else if (e.key === 'End') {
                    e.preventDefault();
                    const last = items[items.length - 1];
                    if (last) last.focus();
                } else if (e.key === 'Enter' || e.key === ' ') {
                    if (idx >= 0) {
                        e.preventDefault();
                        items[idx].click();
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setOpen(false);
                    btn.focus();
                }
            });
            // 用于外部点击关闭时同步 ARIA:返回 helper
            const ctrl = {
                get isOpen() { return isOpen; },
                // 无条件 setOpen(false):即使 isOpen 已与外部失步,也要把 DOM 收干净
                close: function () { setOpen(false); }
            };
            dropdownCtrls.set(dropdown, ctrl);
            return ctrl;
        }
        const randomDropdown = document.getElementById('randomDropdown');
        const printDropdown = document.getElementById('printDropdown');
        const randomDropdownCtrl = setupActionDropdown(randomDropdownBtn, randomDropdown, printBtn, printDropdown);
        // 「切换模式」:点击即轮换 普通 → 签到 → 分组 → 普通(不再是下拉)
        modeSwitchBtn.addEventListener('click', cycleMode);
        const printDropdownCtrl = setupActionDropdown(printBtn, printDropdown, randomDropdownBtn, randomDropdown);

        // 点击关闭 randomDropdown / printDropdown（事件委托，在 printBtn 的 document click handler 里统一处理）

        // ─────────── 随机排座模块 (modules/random-arrange.js) ───────────
        // randomSeatArrange + 模块私有 helpers(getDeskMatePairs / getGender)
        // 全部抽离到独立 ES module。
        // shuffle 是通用工具(主文件 line 185 定义 + 两处其他使用),通过 deps.helpers 注入。
        // 模块内部从 state.* 直读(path-A2 等价);写路径
        // state.seats = Array(...) 重新指向 + commit() 派发 change + 末尾 generateSeats 重渲染。
        const randomArrange = createRandomArrange({
            helpers: {
                shuffle              // 通用洗牌工具(主文件 IIFE 内 line 185 定义)
            },
            callbacks: {
                onPushSnapshot: pushSnapshot,
                onGenerateSeats: generateSeats
            }
        });
        // 顶层别名 — 保留既有调用点零修改
        const randomSeatArrange = randomArrange.randomSeatArrange;
        const rotateGroupSeats = randomArrange.rotateGroupSeats;

        // 本地预览专用测试钩子:冒烟测试借此驱动「应用内真实实例」
        // (带撤销快照 / UI 刷新回调),而不是另建一份工厂实例。
        if (typeof window !== 'undefined' &&
            /^(127\.0\.0\.1|localhost)$/.test(window.location.hostname)) {
            window.__seatsTest = {
                rotateGroupSeats: rotateGroupSeats,
                randomSeatArrange: randomSeatArrange
            };
        }

        // ==================== 智能排座(按钮 + 选项开关) ====================
        // 上段按钮:按下方开关的组合直接执行;下段按钮:展开选项菜单。
        // 开关状态持久化在 config 的 smartArrange* 三个字段里。

        function setSwitchState(name, on) {
            // 直接按 id 现取:本函数可能在初始化早期(randomDropdown 别名就绪前)被调用
            const dd = document.getElementById('randomDropdown');
            const row = dd && dd.querySelector('[data-toggle="' + name + '"]');
            if (row) row.setAttribute('aria-checked', on ? 'true' : 'false');
        }

        // 把三个开关 + 步长行的 UI 同步到当前状态
        function syncSmartArrangeUI() {
            setSwitchState('mixed', smartArrangeMixed);
            setSwitchState('samegender', smartArrangeSameGender);
            setSwitchState('rotate', smartArrangeRotate);
            const stepRow = document.getElementById('rotateStepRow');
            if (stepRow) stepRow.style.display = smartArrangeRotate ? '' : 'none';
            syncRotateStepButtons();
            updateRotateOffsetBadge();
        }

        // 步长 −/+ 的可用边界:1 ~ 分组数-1
        function syncRotateStepButtons() {
            const maxOffset = Math.max(1, groups.length - 1);
            const minus = document.getElementById('rotateStepMinus');
            const plus = document.getElementById('rotateStepPlus');
            if (minus) minus.disabled = groupRotateOffset <= 1;
            if (plus) plus.disabled = groupRotateOffset >= maxOffset;
        }

        function toggleSmartSwitch(name) {
            if (name === 'mixed') {
                smartArrangeMixed = !smartArrangeMixed;
                // 与「男女不同桌」互斥:开启一个即关掉另一个
                if (smartArrangeMixed) smartArrangeSameGender = false;
            } else if (name === 'samegender') {
                smartArrangeSameGender = !smartArrangeSameGender;
                if (smartArrangeSameGender) smartArrangeMixed = false;
            } else if (name === 'rotate') {
                smartArrangeRotate = !smartArrangeRotate;
            }
            syncSmartArrangeUI();
            // 性别开关一开一合 ⇒ 立刻重新检测并刷新闪烁提示
            refreshGenderHints();
            autoSave();
        }

        function adjustRotateOffset(delta) {
            groupRotateOffset = normalizeRotateOffset(groupRotateOffset + delta);
            syncRotateStepButtons();
            updateRotateOffsetBadge();
            // 分组模式下统计栏的「即将轮换到」跟着步长实时变化
            if (isGroupMode) updateGroupStatsRow();
            autoSave();
        }

        // 两个性别开关都关闭 ⇒ 完全随机
        function smartArrangeMode() {
            if (smartArrangeMixed) return 'mixed';
            if (smartArrangeSameGender) return 'samegender';
            return 'random';
        }

        // 上段按钮:按当前开关组合执行一次智能排座
        function runSmartArrange() {
            const genderMode = smartArrangeMode();   // 'mixed' | 'samegender' | 'random'
            const warnings = [];
            let rotateMsg = '';
            if (smartArrangeRotate) {
                // 开启「小组轮换」:**只做轮换**,不做全班随机排座。
                //   全班座位保持原样(无分组学生原地不动),仅把各分组整体迁移到
                //   往下第 N 组的座位区;随后按当前性别规则在**各组座位区内部**
                //   做有限调整(由 rotateGroupSeats 的 options.genderMode 完成后处理),
                //   绝不把学生挪到别的小组座位区域。
                //   也因此全程只有一条轮换确认,不会有「完全随机」确认。
                const rot = runGroupRotation({
                    genderMode: genderMode === 'random' ? null : genderMode
                });
                if (rot.warnings && rot.warnings.length > 0) {
                    warnings.push.apply(warnings, rot.warnings);
                } else if (rot.moved > 0) {
                    rotateMsg = MESSAGES.ROTATE_DONE(groupRotateOffset, rot.moved);
                }
            } else {
                // 「排座选项」设置项已移除 ⇒ 走 random-arrange 内置默认尝试次数
                const result = randomSeatArrange(genderMode) || {};
                if (result.warnings && result.warnings.length > 0) {
                    warnings.push.apply(warnings, result.warnings);
                }
            }
            // 排座与轮换的提示合并为一条 toast,避免后一条盖掉前一条
            if (warnings.length > 0) {
                showStatToast(warnings.join(' / '));
            } else if (rotateMsg) {
                showStatToast(rotateMsg);
            }
        }

        smartArrangeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            // 执行即收起选项菜单(与「点菜单项后关闭」的既有行为保持一致)
            if (randomDropdownCtrl) randomDropdownCtrl.close();
            runSmartArrange();
        });

        // 开关行 / 步长按钮:点击只改变设置,不关闭下拉(与菜单项行为区分开)
        document.addEventListener('click', function (e) {
            const sw = e.target.closest('.dropdown-switch-row');
            if (sw) {
                toggleSmartSwitch(sw.getAttribute('data-toggle'));
                return;
            }
            const stepBtn = e.target.closest('.dropdown-step-btn');
            if (stepBtn && !stepBtn.disabled) {
                adjustRotateOffset(parseInt(stepBtn.getAttribute('data-step'), 10) || 0);
            }
        });

        // 重置座位
        document.getElementById('resetBtn').addEventListener('click', function () {
            if (confirm(MESSAGES.CONFIRM_RESET_SEATS)) {
                pushSnapshot('reset');
                currentSeats = Array(rows * cols).fill(null);
                commit({ seats: currentSeats });
                generateSeats();
            }
        });

        // 切换视角
        toggleViewBtn.addEventListener('click', function () {
            isTeacherView = !isTeacherView;
            state.viewMode = isTeacherView ? 'teacher' : 'student';
            commit({ viewMode: state.viewMode });
            toggleViewBtn.textContent = isTeacherView ? '学生视角' : '教师视角';
            generateSeats();
        });

        // 切换图标显示
        const toggleIconsBtn = document.getElementById('toggleIconsBtn');
        function updateToggleIconsBtnText() {
            if (!toggleIconsBtn) return;
            toggleIconsBtn.textContent = showStudentIcons ? '隐藏图标' : '显示图标';
        }
        updateToggleIconsBtnText();
        toggleIconsBtn.addEventListener('click', function () {
            showStudentIcons = !showStudentIcons;
            state.showStudentIcons = showStudentIcons;
            commit({ showStudentIcons: showStudentIcons });
            updateToggleIconsBtnText();
            generateSeats();
            autoSave();
        });

        // 应用座位表配置
        applyConfigBtn.addEventListener('click', () => {
            const newRows = parseInt(rowsInput.value) || 7;
            const newCols = parseInt(colsInput.value) || 7;

            if (newRows < 1 || newRows > 20 || newCols < 1 || newCols > 20) {
                alert(MESSAGES.ROW_COL_RANGE);
                return;
            }

            // 检查是否存在因列数缩减而失效的走道
            const invalidAisles = aisles.filter(a => a.afterCol >= newCols);
            if (invalidAisles.length > 0) {
                if (!confirm(MESSAGES.CONFIRM_REDUCE_AISLES(invalidAisles.length, invalidAisles.map(a => a.afterCol)))) {
                    return;
                }
                aisles = aisles.filter(a => a.afterCol < newCols);
                commit({ aisles: aisles });
            }

            // 保存当前座位安排
            const oldSeats = [...currentSeats];
            const oldRows = rows;
            const oldCols = cols;
            const newTotal = newRows * newCols;

            // 创建新的座位数组
            const newSeats = Array(newTotal).fill(null);

            // 尽可能保留原有的座位安排（按行列映射，只迁移在新范围内有效的座位）
            for (let r = 0; r < oldRows; r++) {
                if (r >= newRows) break; // 超出新行数，跳过
                for (let c = 0; c < oldCols; c++) {
                    if (c >= newCols) break; // 超出新列数，跳过
                    const oldIndex = r * oldCols + c;
                    const newIndex = r * newCols + c;
                    if (oldIndex < oldSeats.length && oldSeats[oldIndex] && newIndex < newTotal) {
                        newSeats[newIndex] = oldSeats[oldIndex];
                    }
                }
            }

            // 更新配置
            rows = newRows;
            cols = newCols;
            currentSeats = newSeats;
            commit({ rows: rows, cols: cols, seats: currentSeats });

            updateAisleDisplay();
            generateSeats();
        });

        // 清除所有数据
        clearStorageBtn.addEventListener('click', function () {
            if (confirm(MESSAGES.CONFIRM_CLEAR_ALL)) {
                localStorage.removeItem('classroomConfig');
                localStorage.removeItem(CONFIGS_KEY);
                localStorage.removeItem(ACTIVE_CONFIG_KEY);
                students = [];
                groups = [];
                rows = 8;
                cols = 8;
                rowsInput.value = 8;
                colsInput.value = 8;
                currentSeats = Array(rows * cols).fill(null);
                isTeacherView = false;
                aisles = [
                    { afterCol: 2, width: 30 },
                    { afterCol: 4, width: 30 },
                    { afterCol: 6, width: 30 }
                ];
                showStudentIcons = true;
                state.viewMode = 'student';
                commit({
                    students: students, groups: groups, rows: rows, cols: cols,
                    seats: currentSeats, aisles: aisles, viewMode: state.viewMode,
                    showStudentIcons: showStudentIcons
                });
                toggleViewBtn.textContent = '教师视角';
                updateAisleDisplay();
                updateGroupDisplay();
                updateStudentAssignmentDisplay();
                generateSeats();
                renderConfigList();
                alert(MESSAGES.ALL_DATA_CLEARED);
            }
        });

        // ==================== 多配置管理 ====================

        const configListEl = document.getElementById('configList');
        const saveConfigAsBtn = document.getElementById('saveConfigAsBtn');

        function getSavedConfigs() {
            try {
                return JSON.parse(localStorage.getItem(CONFIGS_KEY)) || {};
            } catch { return {}; }
        }

        function setSavedConfigs(configs) {
            localStorage.setItem(CONFIGS_KEY, JSON.stringify(configs));
        }

        function getActiveConfigName() {
            return localStorage.getItem(ACTIVE_CONFIG_KEY) || '';
        }

        function setActiveConfigName(name) {
            localStorage.setItem(ACTIVE_CONFIG_KEY, name);
        }

        function renderConfigList() {
            const configs = getSavedConfigs();
            const activeName = getActiveConfigName();
            const names = Object.keys(configs);

            if (names.length === 0) {
                configListEl.innerHTML = '<div class="config-empty">暂无保存的配置</div>';
                return;
            }

            configListEl.innerHTML = names.map(name => {
                const isActive = name === activeName;
                const time = configs[name].savedAt ? new Date(configs[name].savedAt).toLocaleString() : '';
                return '<div class="config-item' + (isActive ? ' active' : '') + '">' +
                    '<span class="config-item-name" data-config="' + escapeHtml(name) + '" title="点击切换到此配置">' + escapeHtml(name) + '</span>' +
                    '<span class="config-item-time">' + time + '</span>' +
                    '<button class="config-item-del" data-del="' + escapeHtml(name) + '" title="删除此配置">×</button>' +
                '</div>';
            }).join('');
        }

        // 点击配置名切换
        configListEl.addEventListener('click', function (e) {
            const nameEl = e.target.closest('.config-item-name');
            const delEl = e.target.closest('.config-item-del');

            if (nameEl) {
                const name = nameEl.getAttribute('data-config');
                const configs = getSavedConfigs();
                if (!configs[name]) return;
                applyConfig(configs[name]);
                setActiveConfigName(name);
                renderConfigList();
            }

            if (delEl) {
                const name = delEl.getAttribute('data-del');
                if (!confirm(MESSAGES.CONFIRM_DELETE_CONFIG(name))) return;
                const configs = getSavedConfigs();
                delete configs[name];
                setSavedConfigs(configs);
                if (getActiveConfigName() === name) setActiveConfigName('');
                renderConfigList();
            }
        });

        // 双击配置名重命名
        configListEl.addEventListener('dblclick', function (e) {
            const nameEl = e.target.closest('.config-item-name');
            if (!nameEl) return;
            const oldName = nameEl.getAttribute('data-config');
            const newName = prompt('请输入新名称：', oldName);
            if (!newName || newName === oldName) return;
            const configs = getSavedConfigs();
            if (configs[newName]) { alert(MESSAGES.CONFIG_NAME_EXISTS); return; }
            configs[newName] = configs[oldName];
            delete configs[oldName];
            setSavedConfigs(configs);
            if (getActiveConfigName() === oldName) setActiveConfigName(newName);
            renderConfigList();
        });

        // 保存为…
        saveConfigAsBtn.addEventListener('click', function () {
            let name = getActiveConfigName();
            if (!name) name = pageTitle.textContent.trim() || '班级座位表';
            const input = prompt('请输入配置名称：', name);
            if (!input) return;
            const configs = getSavedConfigs();
            configs[input] = { ...getCurrentConfig(), savedAt: Date.now() };
            setSavedConfigs(configs);
            setActiveConfigName(input);
            renderConfigList();
        });

        // 应用配置的通用函数
        function applyConfig(config) {
            migrateConfig(config);
            students = config.students || [];
            groups = config.groups || [];
            rows = config.rows || 7;
            cols = config.cols || 7;
            currentSeats = config.seats || Array(rows * cols).fill(null);
            isTeacherView = config.viewMode === 'teacher';
            aisles = config.aisles || [];
            showStudentIcons = config.showStudentIcons !== false;
            forcedPairs = config.forcedPairs || [];
            avoidPairs = config.avoidPairs || [];

            const targetLen = rows * cols;
            if (currentSeats.length < targetLen) {
                currentSeats = currentSeats.concat(Array(targetLen - currentSeats.length).fill(null));
            } else if (currentSeats.length > targetLen) {
                currentSeats = currentSeats.slice(0, targetLen);
            }

            state.viewMode = isTeacherView ? 'teacher' : 'student';
            commit({
                students: students, groups: groups, rows: rows, cols: cols,
                seats: currentSeats, aisles: aisles, viewMode: state.viewMode,
                showStudentIcons: showStudentIcons,
                forcedPairs: forcedPairs, avoidPairs: avoidPairs
            });

            if (config.title) pageTitle.textContent = config.title;
            rowsInput.value = rows;
            colsInput.value = cols;
            toggleViewBtn.textContent = isTeacherView ? '学生视角' : '教师视角';
            updateAisleDisplay();
            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            generateSeats();
        }

        // 初始渲染配置列表
        renderConfigList();

        // 同步版本号到页面显示
        const versionEl = document.getElementById('appVersion');
        if (versionEl) versionEl.textContent = APP_VERSION;

        const appVersionButton = document.getElementById('appVersionButton');
        const appInfoModal = document.getElementById('appInfoModal');
        const appInfoClose = document.getElementById('appInfoClose');
        const appInfoVersion = document.getElementById('appInfoVersion');

        function closeAppInfo() {
            appInfoModal.classList.remove('visible');
        }

        function openAppInfo() {
            appInfoVersion.textContent = APP_VERSION;
            appInfoModal.classList.add('visible');
            appInfoClose.focus();
        }

        appVersionButton.addEventListener('click', openAppInfo);
        appVersionButton.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openAppInfo();
            }
        });
        appInfoClose.addEventListener('click', closeAppInfo);
        appInfoModal.addEventListener('click', function (e) {
            if (e.target === appInfoModal) closeAppInfo();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && appInfoModal.classList.contains('visible')) closeAppInfo();
        });

        // ==================== GitHub API 同步 ====================

        const GITHUB_SETTINGS_KEY = 'githubSettings';
        const GITHUB_TOKEN_KEY = 'githubToken';
        const githubOwner = document.getElementById('githubOwner');
        const githubRepo = document.getElementById('githubRepo');
        const githubPath = document.getElementById('githubPath');
        const githubToken = document.getElementById('githubToken');
        const githubTokenClearBtn = document.getElementById('githubTokenClearBtn');
        const githubTokenStatus = document.getElementById('githubTokenStatus');
        const githubStatus = document.getElementById('githubStatus');
        const githubSaveSettingsBtn = document.getElementById('githubSaveSettingsBtn');
        const githubTestBtn = document.getElementById('githubTestBtn');
        const githubSyncUpBtn = document.getElementById('githubSyncUpBtn');
        const githubSyncDownBtn = document.getElementById('githubSyncDownBtn');

        // 显示当前会话中 Token 的状态(P0-c 安全 UX 强化)。
        // 三种状态:
        //   1. 未设置 — 输入框空 + sessionStorage 空
        //   2. 已输入(未保存) — 输入框有值但 sessionStorage 还没存
        //   3. 已保存 — sessionStorage 存了,关闭标签页后失效
        // 不显示 Token 本身(密码框 + sessionStorage + type=password),只显示状态文字。
        function updateGithubTokenStatus() {
            const sessionToken = sessionStorage.getItem(GITHUB_TOKEN_KEY) || '';
            const inputToken = githubToken.value || '';
            const hasSession = sessionToken.length > 0;
            const hasInput = inputToken.length > 0;
            const inputMatchesSession = inputToken === sessionToken;

            let text, cls;
            if (!hasInput && !hasSession) {
                text = 'Token 未设置(请填入 Personal Access Token 后点击「保存设置」)';
                cls = 'no-token';
            } else if (hasInput && !hasSession) {
                text = 'Token 已输入但尚未保存(需点击「保存设置」才会持久化到本会话)';
                cls = 'pending-token';
            } else if (hasInput && hasSession && !inputMatchesSession) {
                text = 'Token 已修改(需点击「保存设置」才能更新已保存的 Token)';
                cls = 'pending-token';
            } else {
                text = 'Token 已保存(仅本会话,关闭标签页后失效)';
                cls = 'has-token';
            }
            githubTokenStatus.textContent = text;
            githubTokenStatus.className = 'github-token-status ' + cls;
            // 清除按钮:有 sessionStorage 的 token 时才启用
            githubTokenClearBtn.disabled = !hasSession;
        }

        function clearGithubToken() {
            sessionStorage.removeItem(GITHUB_TOKEN_KEY);
            githubToken.value = '';
            updateGithubTokenStatus();
            setGithubStatus('Token 已从本会话清除', 'success');
        }

        (function loadGithubSettings() {
            try {
                const s = JSON.parse(localStorage.getItem(GITHUB_SETTINGS_KEY));
                if (s) {
                    githubOwner.value = s.owner || '';
                    githubRepo.value = s.repo || '';
                    githubPath.value = s.path || 'data/seats-configs.json';
                }
                // Token 只存 sessionStorage(随标签页关闭清除,不持久落盘)— P0-d 安全修复
                const token = sessionStorage.getItem(GITHUB_TOKEN_KEY);
                if (token) githubToken.value = token;
                updateGithubTokenStatus();
            } catch {
                updateGithubTokenStatus();
            }
        })();

        // 监听输入:用户改 token 立即更新状态指示
        githubToken.addEventListener('input', updateGithubTokenStatus);
        // 清除按钮:移除 sessionStorage 中的 token + 清空输入框
        githubTokenClearBtn.addEventListener('click', clearGithubToken);

        function setGithubStatus(msg, type) {
            githubStatus.textContent = msg;
            githubStatus.className = 'webdav-status' + (type ? ' ' + type : '');
        }

        function getGithubSettings() {
            return {
                owner: githubOwner.value.trim(),
                repo: githubRepo.value.trim(),
                path: githubPath.value.trim() || 'data/seats-configs.json',
                token: githubToken.value.trim()
            };
        }

        // 对 GitHub 文件路径做分段编码（保留斜杠，避免路径被整体编码破坏 API 语义）
        function encodeGitHubPath(path) {
            return path.split('/').map(function (seg) {
                return encodeURIComponent(seg);
            }).join('/');
        }

        function githubApiRequest(method, endpoint, body) {
            const s = getGithubSettings();
            if (!s.owner || !s.repo || !s.token) {
                setGithubStatus('请先填写 GitHub 设置', 'error');
                return Promise.reject(new Error('未设置 GitHub'));
            }

            // 对 owner/repo 做 URL 编码，防止注入/非法字符（P0-d 修复）
            const url = `https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}${endpoint}`;
            const headers = {
                'Authorization': 'token ' + s.token,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            };

            const options = { method, headers, mode: 'cors' };
            if (body) {
                headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }

            return fetch(url, options).then(res => {
                if (!res.ok) {
                    return res.json().then(err => {
                        const msg = err.message || err.error || '请求失败';
                        if (res.status === 401) {
                            throw new Error('认证失败：Token 无效或已过期');
                        } else if (res.status === 403) {
                            throw new Error('权限不足：Token 缺少 repo 权限');
                        } else if (res.status === 404) {
                            throw new Error('仓库或文件不存在');
                        }
                        throw new Error('请求失败: ' + msg);
                    }).catch(() => {
                        throw new Error('请求失败 (HTTP ' + res.status + ')');
                    });
                }
                return res;
            });
        }

        githubSaveSettingsBtn.addEventListener('click', function () {
            const s = getGithubSettings();
            if (!s.owner) { setGithubStatus('请填写 GitHub 用户名', 'error'); return; }
            if (!s.repo) { setGithubStatus('请填写仓库名', 'error'); return; }
            if (!s.token) { setGithubStatus('请填写 Personal Access Token', 'error'); return; }

            // 非敏感字段存 localStorage；Token 只存 sessionStorage（P0-d 安全修复）
            localStorage.setItem(GITHUB_SETTINGS_KEY, JSON.stringify({
                owner: s.owner, repo: s.repo, path: s.path
            }));
            sessionStorage.setItem(GITHUB_TOKEN_KEY, s.token);
            updateGithubTokenStatus();
            setGithubStatus('设置已保存（Token 仅本会话有效），正在测试连接…', '');
            testGithubConnection();
        });

        githubTestBtn.addEventListener('click', testGithubConnection);

        function testGithubConnection() {
            const s = getGithubSettings();
            if (!s.owner || !s.repo || !s.token) {
                setGithubStatus('请先填写完整的 GitHub 设置', 'error');
                return;
            }

            setGithubStatus('正在测试连接…', '');

            githubApiRequest('GET', '')
                .then(res => res.json())
                .then(data => {
                    if (data.name === s.repo) {
                        setGithubStatus('连接成功！仓库: ' + data.full_name, 'success');
                    } else {
                        throw new Error('仓库名称不匹配');
                    }
                })
                .catch(err => {
                    setGithubStatus('连接失败: ' + err.message, 'error');
                });
        }

        githubSyncUpBtn.addEventListener('click', function () {
            const s = getGithubSettings();
            if (!s.owner || !s.repo || !s.token) {
                setGithubStatus('请先填写完整的 GitHub 设置', 'error');
                return;
            }

            setGithubStatus('正在上传…', '');
            const configs = getSavedConfigs();
            const activeName = getActiveConfigName();
            const content = JSON.stringify({ configs, activeName, current: getCurrentConfig(), savedAt: Date.now() }, null, 2);
            const encodedContent = utf8ToBase64(content);

            githubApiRequest('GET', `/contents/${encodeGitHubPath(s.path)}`)
                .then(res => res.json())
                .then(existing => {
                    return githubApiRequest('PUT', `/contents/${encodeGitHubPath(s.path)}`, {
                        message: '[Seats Generator] 同步配置',
                        content: encodedContent,
                        sha: existing.sha
                    });
                })
                .catch(err => {
                    if (err.message.includes('404')) {
                        return githubApiRequest('PUT', `/contents/${encodeGitHubPath(s.path)}`, {
                            message: '[Seats Generator] 初始化配置',
                            content: encodedContent
                        });
                    }
                    throw err;
                })
                .then(() => {
                    setGithubStatus('上传成功 (' + new Date().toLocaleTimeString() + ')', 'success');
                })
                .catch(err => {
                    setGithubStatus('上传失败: ' + err.message, 'error');
                });
        });

        githubSyncDownBtn.addEventListener('click', function () {
            const s = getGithubSettings();
            if (!s.owner || !s.repo || !s.token) {
                setGithubStatus('请先填写完整的 GitHub 设置', 'error');
                return;
            }

            setGithubStatus('正在下载…', '');

            githubApiRequest('GET', `/contents/${encodeGitHubPath(s.path)}`)
                .then(res => res.json())
                .then(data => {
                    if (!data.content) throw new Error('文件内容为空');
                    const decoded = base64ToUtf8(data.content);
                    return JSON.parse(decoded);
                })
                .then(data => {
                    if (!data.configs || typeof data.configs !== 'object') {
                        throw new Error('数据格式无效');
                    }

                    const localConfigs = getSavedConfigs();
                    const localNames = Object.keys(localConfigs);
                    const cloudNames = Object.keys(data.configs);

                    // P0-c 修复：检测云端与本地「同名但内容不同」的配置冲突，交给用户决定，
                    // 避免直接覆盖导致本地已修改但尚未上传的配置静默丢失。
                    const collisions = cloudNames.filter(function (name) {
                        return localNames.indexOf(name) >= 0 &&
                            JSON.stringify(localConfigs[name]) !== JSON.stringify(data.configs[name]);
                    });

                    let cloudWins = true; // 无冲突时默认云端为准（保持原有行为）
                    if (collisions.length > 0) {
                        cloudWins = confirm(MESSAGES.CONFIRM_CLOUD_WINS(collisions.length, collisions));
                    }

                    const merged = {};
                    localNames.forEach(function (name) { merged[name] = localConfigs[name]; });
                    cloudNames.forEach(function (name) {
                        if (collisions.indexOf(name) >= 0 && !cloudWins) return; // 冲突且选择保留本地
                        merged[name] = data.configs[name];
                    });
                    setSavedConfigs(merged);

                    // 切换活动配置：仅在不会覆盖本地正在编辑的同名配置时才应用云端版本
                    const activeFromCloud = data.activeName && data.configs[data.activeName];
                    if (activeFromCloud && (cloudWins || collisions.indexOf(data.activeName) < 0)) {
                        applyConfig(data.configs[data.activeName]);
                        setActiveConfigName(data.activeName);
                    } else if (!activeFromCloud && data.current) {
                        applyConfig(data.current);
                    }

                    renderConfigList();
                    setGithubStatus(
                        '下载成功，已合并 ' + cloudNames.length + ' 个云端配置' +
                        (collisions.length > 0 ? '（' + collisions.length + ' 个同名冲突已处理）' : ''),
                        'success'
                    );
                })
                .catch(err => {
                    if (err.message.includes('404')) {
                        setGithubStatus('云端配置文件不存在', 'error');
                    } else {
                        setGithubStatus('下载失败: ' + err.message, 'error');
                    }
                });
        });

        // 创建表格预览
        function createPreviewTable(data, selectedColumn) {
            let tableHTML = '<table class="preview-table"><thead><tr>';

            // 表头
            for (let i = 0; i < data[0].length; i++) {
                const isSelected = i === selectedColumn;
                const cellContent = escapeHtml(data[0][i] || '列' + (i + 1));
                tableHTML += `<th${isSelected ? ' style="background-color:#c8e6c9"' : ''}>${cellContent}</th>`;
            }
            tableHTML += '</tr></thead><tbody>';

            // 表内容（最多显示10行）
            const rowCount = Math.min(data.length, 11); // 包括标题行
            for (let i = 1; i < rowCount; i++) {
                tableHTML += '<tr>';
                for (let j = 0; j < data[i].length; j++) {
                    const isSelected = j === selectedColumn;
                    const cellContent = escapeHtml(data[i][j] || '');
                    tableHTML += `<td${isSelected ? ' style="background-color:#e8f5e9"' : ''}>${cellContent}</td>`;
                }
                tableHTML += '</tr>';
            }

            if (data.length > 11) {
                tableHTML += '<tr><td colspan="' + data[0].length + '" style="text-align:center;">...更多数据未显示...</td></tr>';
            }

            tableHTML += '</tbody></table>';
            return tableHTML;
        }



        function loadSelectedSheet() {
            if (!excelWorkbook) return;
            const sheetName = sheetSelect.value;
            const worksheet = excelWorkbook.Sheets[sheetName];
            // P0 修复：限制最大导入行数，防止超大表格一次性读入内存导致页面卡死/内存溢出
            const MAX_IMPORT_ROWS = 2000;
            excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            while (excelData.length && excelData[excelData.length - 1].every(cell => !getCellText(cell))) {
                excelData.pop();
            }
            let importTruncated = false;
            if (excelData.length > MAX_IMPORT_ROWS) {
                excelData = excelData.slice(0, MAX_IMPORT_ROWS);
                importTruncated = true;
            }
            if (excelData.length === 0 || excelData[0].every(cell => !getCellText(cell))) {
                previewArea.style.display = 'none';
                fileInfo.innerHTML = '<span style="color:red">工作表“' + escapeHtml(sheetName) + '”中没有可导入的数据</span>';
                return;
            }

            columnSelect.innerHTML = '';
            let nameColumnIndex = 0;
            let detectedGenderCol = -1;
            let detectedTagCol = -1;
            const allSelects = [columnSelect, groupColumnSelect, genderColumnSelect, tagColumnSelect];
            allSelects.forEach(function (sel) { sel.innerHTML = ''; });
            excelData[0].forEach((cell, index) => {
                const colName = getCellText(cell);
                const colNameLower = colName.toLowerCase();
                const displayName = colName || '列 ' + (index + 1);
                allSelects.forEach(function (sel) {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = displayName;
                    sel.appendChild(option);
                });
                if (colNameLower.includes('姓名') || colNameLower.includes('name')) nameColumnIndex = index;
                if (colNameLower.includes('性别') || colNameLower.includes('gender') || colNameLower.includes('sex')) detectedGenderCol = index;
                if (colNameLower.includes('标签') || colNameLower.includes('tag') || colNameLower.includes('label')) detectedTagCol = index;
            });
            columnSelect.value = nameColumnIndex;
            selectedColumnIndex = nameColumnIndex;
            if (detectedGenderCol >= 0) genderColumnSelect.value = detectedGenderCol;
            if (detectedTagCol >= 0) tagColumnSelect.value = detectedTagCol;
            enableGroupImport.checked = false;
            enableRowFilter.checked = false;
            enableGenderImport.checked = false;
            enableTagImport.checked = false;
            isGroupImportEnabled = false;
            isGenderImportEnabled = false;
            isTagImportEnabled = false;
            selectedGroupColumnIndex = -1;
            selectedGenderColumnIndex = -1;
            selectedTagColumnIndex = -1;
            selectedFilterColumnIndex = -1;
            selectedFilterValue = '';
            tempImportGroups = [];
            groupImportControls.style.display = 'none';
            rowFilterControls.style.display = 'none';
            genderImportControls.style.display = 'none';
            tagImportControls.style.display = 'none';
            groupPreviewSection.style.display = 'none';
            filterSummary.textContent = '';
            const colCount = excelData[0].length;
            const hasMultipleCols = colCount > 1;
            groupImportSection.style.display = hasMultipleCols ? 'block' : 'none';
            genderImportSection.style.display = hasMultipleCols ? 'block' : 'none';
            tagImportSection.style.display = hasMultipleCols ? 'block' : 'none';
            tablePreview.innerHTML = createPreviewTable(excelData, nameColumnIndex);
            previewArea.style.display = 'block';
            const columnName = escapeHtml(excelData[0][nameColumnIndex] || '列' + (nameColumnIndex + 1));
            let infoHtml = '<span>当前工作表：“' + escapeHtml(sheetName) + '”，已自动选择姓名列“' + columnName + '"';
            if (detectedGenderCol >= 0) infoHtml += '，检测到性别列"' + escapeHtml(excelData[0][detectedGenderCol]) + '"';
            if (detectedTagCol >= 0) infoHtml += '，检测到标签列"' + escapeHtml(excelData[0][detectedTagCol]) + '"';
            infoHtml += '</span>';
            if (importTruncated) {
                infoHtml += '<span style="color:#e67e22">（表格超过 ' + MAX_IMPORT_ROWS + ' 行，已仅加载前 ' + MAX_IMPORT_ROWS + ' 行）</span>';
            }
            fileInfo.innerHTML = infoHtml;
        }

        fileInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            fileInfo.textContent = `正在处理文件: ${file.name}`;
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    if (typeof XLSX === 'undefined') throw new Error('Excel 解析组件加载失败，请检查网络后刷新页面');
                    const data = new Uint8Array(e.target.result);
                    excelWorkbook = XLSX.read(data, { type: 'array' });
                    if (!excelWorkbook.SheetNames.length) throw new Error('Excel 工作簿中没有工作表');
                    sheetSelect.innerHTML = excelWorkbook.SheetNames.map(name =>
                        '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>'
                    ).join('');
                    sheetSelectArea.style.display = excelWorkbook.SheetNames.length > 1 ? 'block' : 'none';
                    sheetSelect.value = excelWorkbook.SheetNames[0];
                    loadSelectedSheet();
                } catch (error) {
                    fileInfo.innerHTML = `<span style="color:red">文件处理错误: ${escapeHtml(error.message)}</span>`;
                    console.error(error);
                }
            };
            reader.onerror = function () {
                fileInfo.innerHTML = '<span style="color:red">文件读取失败，请重新选择 Excel 文件</span>';
            };
            reader.readAsArrayBuffer(file);
        });

        sheetSelect.addEventListener('change', loadSelectedSheet);

        // 列选择变化事件
        columnSelect.addEventListener('change', function () {
            selectedColumnIndex = parseInt(this.value);
            refreshImportPreview();
        });

        // 分组导入启用复选框事件
        enableGroupImport.addEventListener('change', handleGroupImportToggle);

        enableRowFilter.addEventListener('change', function () {
            rowFilterControls.style.display = this.checked ? 'block' : 'none';
            refreshImportPreview();
        });

        filterColumnSelect.addEventListener('change', function () {
            selectedFilterColumnIndex = parseInt(this.value);
            selectedFilterValue = '';
            updateFilterValueOptions();
            refreshImportPreview();
        });

        filterValueSelect.addEventListener('change', function () {
            selectedFilterValue = this.value;
            refreshImportPreview();
        });

        // 分组列选择变化事件
        groupColumnSelect.addEventListener('change', handleGroupColumnChange);

        // 性别导入启用复选框事件
        enableGenderImport.addEventListener('change', function () {
            isGenderImportEnabled = this.checked;
            genderImportControls.style.display = this.checked ? 'block' : 'none';
            selectedGenderColumnIndex = this.checked ? parseInt(genderColumnSelect.value) : -1;
        });

        genderColumnSelect.addEventListener('change', function () {
            if (isGenderImportEnabled) {
                selectedGenderColumnIndex = parseInt(this.value);
            }
        });

        // 标签导入启用复选框事件
        enableTagImport.addEventListener('change', function () {
            isTagImportEnabled = this.checked;
            tagImportControls.style.display = this.checked ? 'block' : 'none';
            selectedTagColumnIndex = this.checked ? parseInt(tagColumnSelect.value) : -1;
        });

        tagColumnSelect.addEventListener('change', function () {
            if (isTagImportEnabled) {
                selectedTagColumnIndex = parseInt(this.value);
            }
        });

        // 确认导入按钮点击事件
        confirmImportBtn.addEventListener('click', function () {
            selectedColumnIndex = parseInt(columnSelect.value);
            importStudentsWithGroups(selectedColumnIndex);
        });

        // 初始化 — 尝试从本地存储加载配置
        function initialize() {
            const savedConfig = localStorage.getItem('classroomConfig');

            if (savedConfig) {
                try {
                    const config = JSON.parse(savedConfig);
                    migrateConfig(config);

                    students = config.students || [];
                    groups = config.groups || [];
                    rows = config.rows || 8;
                    cols = config.cols || 8;
                    currentSeats = config.seats || Array(rows * cols).fill(null);
                    isTeacherView = config.viewMode === 'teacher';
                    aisles = config.aisles || [];
                    showStudentIcons = config.showStudentIcons !== false;
                    forcedPairs = config.forcedPairs || [];
                    avoidPairs = config.avoidPairs || [];
                    isCheckinMode = !!config.isCheckinMode;
                    isGroupMode = !!config.isGroupMode;
                    groupRotateOffset = normalizeRotateOffset(config.groupRotateOffset);
                    smartArrangeMixed = !!config.smartArrangeMixed;
                    smartArrangeSameGender = !!config.smartArrangeSameGender;
                    smartArrangeRotate = !!config.smartArrangeRotate;
                    if (config.title) pageTitle.textContent = config.title;

                    // 调整座位数组长度以匹配当前行列
                    const targetLen = rows * cols;
                    if (currentSeats.length < targetLen) {
                        currentSeats = currentSeats.concat(Array(targetLen - currentSeats.length).fill(null));
                    } else if (currentSeats.length > targetLen) {
                        currentSeats = currentSeats.slice(0, targetLen);
                    }

                    rowsInput.value = rows;
                    colsInput.value = cols;
                    toggleViewBtn.textContent = isTeacherView ? '学生视角' : '教师视角';
                    updateAisleDisplay();
                    updateGroupDisplay();
                    updateStudentAssignmentDisplay();
                } catch (error) {
                    console.error('加载本地存储配置失败，使用默认配置:', error);
                    students = [];
                    groups = [];
                    rows = 8;
                    cols = 8;
                    currentSeats = Array(rows * cols).fill(null);
                    isTeacherView = false;
                    aisles = [
                        { afterCol: 2, width: 30 },
                        { afterCol: 4, width: 30 },
                        { afterCol: 6, width: 30 }
                    ];
                    showStudentIcons = true;
                    forcedPairs = [];
                    avoidPairs = [];
                    rowsInput.value = rows;
                    colsInput.value = cols;
                    toggleViewBtn.textContent = '教师视角';
                    updateAisleDisplay();
                    updateGroupDisplay();
                    updateStudentAssignmentDisplay();
                    localStorage.removeItem('classroomConfig');
                    alert(MESSAGES.STORAGE_CORRUPT);
                }
            } else {
                // 新用户首次进入：无配置文件、无分组、无学生，渲染新增分组与新增学生输入行
                // 默认 8×8 + 第 2/4/6 列后 30px 走道(state.js 初始值),同步到输入框显示
                rowsInput.value = rows;
                colsInput.value = cols;
                updateAisleDisplay();
                updateGroupDisplay();
                updateStudentAssignmentDisplay();
            }

            state.viewMode = isTeacherView ? 'teacher' : 'student';
            commit({
                students: students, groups: groups, rows: rows, cols: cols,
                seats: currentSeats, aisles: aisles, viewMode: state.viewMode,
                showStudentIcons: showStudentIcons,
                forcedPairs: forcedPairs, avoidPairs: avoidPairs,
                isCheckinMode: isCheckinMode, isGroupMode: isGroupMode
            });

            // 恢复模式 UI(签到 / 分组互斥,分组优先)
            if (isGroupMode) {
                classroom.classList.add('group-mode');
                setStatsRowMode('group');
            } else if (isCheckinMode) {
                classroom.classList.add('checkin-mode');
                setStatsRowMode('checkin');
            } else {
                setStatsRowMode('normal');
            }
            updateModeSwitchButton();
            updateRotateOffsetBadge();

            generateSeats();
            // 分组 banner 由 generateSeats 重建,内容需在重建后回填
            if (isGroupMode) {
                renderGroupModeList();
                updateGroupModeCount();
                updateGroupStatsRow();
            }
            isInitialized = true;
        }

        // 导出配置按钮
        document.getElementById('exportConfigBtn').addEventListener('click', function () {
            const configStr = JSON.stringify(getCurrentConfig(), null, 2);
            const blob = new Blob([configStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = (pageTitle.textContent.trim() || '班级座位表') + '_配置_' + new Date().toLocaleDateString() + '.json';
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
        });

        // 导入配置按钮
        document.getElementById('importConfigBtn').addEventListener('click', function () {
            document.getElementById('configFileInput').click();
        });

        // 配置文件选择事件
        document.getElementById('configFileInput').addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const config = JSON.parse(e.target.result);
                    if (!config.rows || !config.cols || !Array.isArray(config.seats) || !Array.isArray(config.students)) {
                        throw new Error('无效的配置文件格式');
                    }

                    migrateConfig(config);

                    students = config.students;
                    groups = config.groups || [];
                    rows = config.rows;
                    cols = config.cols;
                    currentSeats = config.seats;
                    isTeacherView = config.viewMode === 'teacher';
                    aisles = config.aisles || [];
                    showStudentIcons = config.showStudentIcons !== false;
                    forcedPairs = config.forcedPairs || [];
                    avoidPairs = config.avoidPairs || [];
                    isCheckinMode = !!config.isCheckinMode;
                    isGroupMode = !!config.isGroupMode;
                    groupRotateOffset = normalizeRotateOffset(config.groupRotateOffset);
                    smartArrangeMixed = !!config.smartArrangeMixed;
                    smartArrangeSameGender = !!config.smartArrangeSameGender;
                    smartArrangeRotate = !!config.smartArrangeRotate;
                    if (config.title) pageTitle.textContent = config.title;

                    const targetLen = rows * cols;
                    if (currentSeats.length < targetLen) {
                        currentSeats = currentSeats.concat(Array(targetLen - currentSeats.length).fill(null));
                    } else if (currentSeats.length > targetLen) {
                        currentSeats = currentSeats.slice(0, targetLen);
                    }

                    updateAisleDisplay();
                    updateGroupDisplay();
                    updateStudentAssignmentDisplay();
                    rowsInput.value = rows;
                    colsInput.value = cols;
                    toggleViewBtn.textContent = isTeacherView ? '学生视角' : '教师视角';
                    state.viewMode = isTeacherView ? 'teacher' : 'student';
                    commit({
                        students: students, groups: groups, rows: rows, cols: cols,
                        seats: currentSeats, aisles: aisles, viewMode: state.viewMode,
                        showStudentIcons: showStudentIcons,
                        forcedPairs: forcedPairs, avoidPairs: avoidPairs
                    });
                    generateSeats();
                    alert(MESSAGES.IMPORT_SUCCESS);
                } catch (error) {
                    console.error('导入配置失败:', error);
                    alert(MESSAGES.IMPORT_FAILED(error.message));
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });

        // ==================== 撤销/重做按钮 + 键盘快捷键 ====================
        undoBtn.addEventListener('click', undo);
        redoBtn.addEventListener('click', redo);

        document.addEventListener('keydown', function (e) {
            // 在输入框中不触发快捷键
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                redo();
            }
        });

        // ==================== 打印/PDF ====================
        let printScaleValue = 1;
        let printPrepared = false;

        function applyPrintScale(force) {
            if (printPrepared && !force) return;
            printPrepared = true;
            // 清除旧样式
            classroom.style.transform = '';
            classroom.style.transformOrigin = '';

            // 日期写进标题旁的 #titleDate(CSS 只在 @media print 下显示),
            // 不再 appendChild 进 contenteditable 的标题 —— 否则会污染标题文本并被自动保存写进配置。
            updateTitleDate();

            printScaleValue = calculatePrintScale();

            // 使用 transform: scale() 缩放，保持宽高比不变
            classroom.style.transformOrigin = 'top left';
            classroom.style.transform = 'scale(' + printScaleValue + ')';

            // 显式设置 wrapper 为缩放后的尺寸，使用 offsetWidth/offsetHeight 包含边框，避免裁剪
            const scaledWidth = Math.ceil(classroom.offsetWidth * printScaleValue);
            const scaledHeight = Math.ceil(classroom.offsetHeight * printScaleValue);
            classroomWrapper.style.width = scaledWidth + 'px';
            classroomWrapper.style.height = scaledHeight + 'px';
        }

        function resetPrintScale() {
            classroom.style.transform = '';
            classroom.style.transformOrigin = '';
            classroomWrapper.style.width = '';
            classroomWrapper.style.height = '';
            printPrepared = false;
        }

        function calculatePrintScale() {
            const pageWidthMm = 297 - 10 - 6;
            const pageHeightMm = 210 - 10 - 6;
            const mmToPx = 96 / 25.4;

            const pageWidthPx = pageWidthMm * mmToPx;
            // 扣除标题高度约 7mm
            const pageHeightPx = (pageHeightMm - 7) * mmToPx;

            const classroomWidth = classroom.offsetWidth;
            const classroomHeight = classroom.offsetHeight;

            if (classroomWidth === 0 || classroomHeight === 0) return 1;

            // 取宽高方向的最小比例，确保座位区域完整放入页面的同时保持宽高比不变
            const scaleX = pageWidthPx / classroomWidth;
            const scaleY = pageHeightPx / classroomHeight;

            return Math.min(scaleX, scaleY);
        }

        // printBtn 的 click 由 setupActionDropdown 统一处理 (P1 UX #3)

        // 下拉菜单项点击
        document.addEventListener('click', function (e) {
            const item = e.target.closest('.print-dropdown-item');
            if (item) {
                const action = item.getAttribute('data-action');
                // 关闭所有下拉菜单(同步 ARIA)
                randomDropdownCtrl.close();
                printDropdownCtrl.close();
                randomDropdown.style.display = 'none';
                printDropdown.style.display = 'none';

                // printDropdown 动作
                if (action === 'print') {
                    printPrepared = false;
                    applyPrintScale();
                    setTimeout(function () {
                        window.print();
                    }, 150);
                } else if (action === 'exportImage') {
                    exportSeatImage();
                }
                // 智能排座下拉里的「配对设置」菜单项
                else if (action === 'pairSettings') {
                    if (activePairPopup) {
                        closePairPopup();
                    } else {
                        // 焦点先还给触发按钮:焦点陷阱会把「打开瞬间的 activeElement」
                        // 记为恢复目标,菜单项随下拉隐藏后无法聚焦,会导致恢复落空
                        randomDropdownBtn.focus();
                        openPairPopup(randomDropdownBtn);
                    }
                }
                return;
            }
            // 点击外部关闭所有下拉菜单(同步 ARIA 与 setupActionDropdown)
            const printDd = document.getElementById('printDropdown');
            const randDd = document.getElementById('randomDropdown');
            if (printDd && !printDd.contains(e.target) && !printBtn.contains(e.target)) {
                printDd.style.display = 'none';
                printBtn.setAttribute('aria-expanded', 'false');
            }
            if (randDd && !randDd.contains(e.target) && !randomDropdownBtn.contains(e.target)) {
                randDd.style.display = 'none';
                randomDropdownBtn.setAttribute('aria-expanded', 'false');
            }
        });

        if (window.matchMedia) {
            const mediaQueryList = window.matchMedia('print');
            const handleMediaChange = function (mql) {
                if (mql.matches) {
                    applyPrintScale(true);
                } else {
                    setTimeout(resetPrintScale, 300);
                }
            };
            if (mediaQueryList.addEventListener) {
                mediaQueryList.addEventListener('change', handleMediaChange);
            } else if (mediaQueryList.addListener) {
                mediaQueryList.addListener(handleMediaChange);
            }
        }

        // ==================== 移动端触摸交互 ====================

        const MOBILE_BANNER_DEFAULT = '移动端模式：点击学生或座位选中，再点击目标位置完成移动。点击已选中的元素可取消选择。';

        function updateMobileBanner() {
            if (!isTouchDevice) return;
            // 签到模式不显示移动端操作提示
            if (isCheckinMode) {
                mobileBanner.classList.remove('visible');
                return;
            }
            if (tapSelectedStudentId !== null) {
                const student = getStudentById(tapSelectedStudentId);
                const name = student ? student.name : '学生';
                mobileBanner.textContent = '已选中：' + name + '，请点击目标座位（再次点击可取消）';
            } else if (tapSelectedSeatIndex !== null) {
                const seatStudentId = currentSeats[tapSelectedSeatIndex];
                if (seatStudentId) {
                    const student = getStudentById(seatStudentId);
                    const name = student ? student.name : '学生';
                    mobileBanner.textContent = '已选中：' + name + '（' + (tapSelectedSeatIndex + 1) + '号座位），请点击目标位置（再次点击可取消）';
                } else {
                    mobileBanner.textContent = '已选中：' + (tapSelectedSeatIndex + 1) + '号空座位，请点击目标学生（再次点击可取消）';
                }
            } else {
                mobileBanner.textContent = MOBILE_BANNER_DEFAULT;
            }
        }

        function clearTapSelection() {
            tapSelectedStudentId = null;
            tapSelectedSeatIndex = null;
            document.querySelectorAll('.selected-for-move').forEach(el => {
                el.classList.remove('selected-for-move');
            });
            updateMobileBanner();
        }

        // 点击学生名单区域（包括学生项和空白处）
        studentList.addEventListener('click', function (e) {
            if (!isTouchDevice || isCheckinMode) return;
            const item = e.target.closest('.student-item');

            // 点击空白处
            if (!item) {
                // 如果有选中的座位，将座位上的学生移回未安排座位区（即从座位中移除）
                if (tapSelectedSeatIndex !== null) {
                    const selectedStudentId = currentSeats[tapSelectedSeatIndex];
                    if (selectedStudentId) {
                        pushSnapshot('seat');
                        currentSeats[tapSelectedSeatIndex] = null;
                        clearTapSelection();
                        generateSeats();
                        return;
                    }
                }
                // 没有选中座位或选中座位为空，取消选择
                clearTapSelection();
                return;
            }

            const studentId = item.getAttribute('data-student');
            if (!studentId) return;

            // 如果已有选中的座位，将学生放入该座位
            if (tapSelectedSeatIndex !== null) {
                pushSnapshot('seat');
                const existingIdx = currentSeats.indexOf(studentId);
                if (existingIdx >= 0) currentSeats[existingIdx] = null;
                const targetId = currentSeats[tapSelectedSeatIndex];
                if (existingIdx >= 0 && targetId) {
                    currentSeats[existingIdx] = targetId;
                }
                currentSeats[tapSelectedSeatIndex] = studentId;
                clearTapSelection();
                generateSeats();
                return;
            }

            // 切换选中状态
            if (tapSelectedStudentId === studentId) {
                clearTapSelection();
            } else {
                clearTapSelection();
                tapSelectedStudentId = studentId;
                item.classList.add('selected-for-move');
                updateMobileBanner();
            }
        });

        // 点击座位
        classroom.addEventListener('click', function (e) {
            // 点击删除按钮：删除学生
            const deleteBtn = e.target.closest('.seat-delete-btn');
            if (deleteBtn) {
                e.stopPropagation();
                const seat = deleteBtn.closest('.seat');
                const studentId = seat.getAttribute('data-student');
                if (studentId) {
                    const student = getStudentById(studentId);
                    if (student && confirm(MESSAGES.CONFIRM_DELETE_STUDENT(student.name))) {
                        pushSnapshot('student');
                        currentSeats = currentSeats.map(id => id === studentId ? null : id);
                        students = students.filter(s => s.id !== studentId);
                        commit({ seats: currentSeats, students: students });
                        updateStudentAssignmentDisplay();
                        generateSeats();
                    }
                }
                return;
            }

            const seat = e.target.closest('.seat');

            // 签到模式：点击座位签到/取消签到（支持桌面端和移动端）
            if (isCheckinMode && seat) {
                const studentId = seat.getAttribute('data-student');
                if (studentId) {
                    toggleStudentCheckin(studentId);
                }
                return;
            }

            // 分组模式：点击有学生的座位 → 切换选中(高亮),可多选;再点分组即可批量分配
            if (isGroupMode && seat) {
                const studentId = seat.getAttribute('data-student');
                if (studentId) {
                    if (groupModeSelectedIds.has(studentId)) {
                        groupModeSelectedIds.delete(studentId);
                        seat.classList.remove('group-selected');
                    } else {
                        groupModeSelectedIds.add(studentId);
                        seat.classList.add('group-selected');
                        // 选中学生 ⇒ 退出分组查看态,焦点留在多选高亮上
                        dropGroupFocusIfViewing();
                    }
                    // 统计栏展示「当前学生」(最后点击的那位)
                    groupCurrentStudentId = studentId;
                    updateGroupModeCount();
                }
                return;
            }

            // 普通模式:点击座位多选学生(与分组模式同一套选中态 + 统计栏三槽视图)。
            // 仅非触屏生效 —— 触屏的「点选 → 点目标位置移动」交互要保持原样。
            if (!isGroupMode && !isCheckinMode && !isTouchDevice && seat) {
                const studentId = seat.getAttribute('data-student');
                if (studentId) {
                    if (groupModeSelectedIds.has(studentId)) {
                        groupModeSelectedIds.delete(studentId);
                        seat.classList.remove('group-selected');
                    } else {
                        groupModeSelectedIds.add(studentId);
                        seat.classList.add('group-selected');
                    }
                    // 统计栏展示「当前学生」(最后点击的那位)
                    groupCurrentStudentId = studentId;
                    updateGroupModeCount();
                    return;
                }
                // 空白座位 = 空白区域 ⇒ 一键取消选择
                if (groupModeSelectedIds.size > 0) clearMultiSelection({ toast: false });
                return;
            }

            if (!isTouchDevice) return;
            if (!seat) return;

            const seatIndex = parseInt(seat.getAttribute('data-index'));
            if (Number.isNaN(seatIndex)) return;

            const seatStudentId = seat.getAttribute('data-student');

            // 如果有选中的学生（来自学生名单），将其放入此座位
            if (tapSelectedStudentId !== null) {
                pushSnapshot('seat');
                const existingIdx = currentSeats.indexOf(tapSelectedStudentId);
                if (existingIdx >= 0) currentSeats[existingIdx] = null;
                const targetId = currentSeats[seatIndex];
                if (existingIdx >= 0 && targetId) {
                    currentSeats[existingIdx] = targetId;
                }
                currentSeats[seatIndex] = tapSelectedStudentId;
                clearTapSelection();
                commit({ seats: currentSeats });
                generateSeats();
                return;
            }

            // 如果有选中的座位
            if (tapSelectedSeatIndex !== null) {
                // 点击同一个座位：取消选择
                if (tapSelectedSeatIndex === seatIndex) {
                    clearTapSelection();
                    return;
                }

                pushSnapshot('seat');

                // 获取选中座位上的学生
                const selectedStudentId = currentSeats[tapSelectedSeatIndex];

                // 场景1：选中座位有学生，目标座位有学生 → 交换
                if (selectedStudentId && seatStudentId) {
                    currentSeats[tapSelectedSeatIndex] = seatStudentId;
                    currentSeats[seatIndex] = selectedStudentId;
                }
                // 场景2：选中座位有学生，目标座位是空座位 → 移动到空座位
                else if (selectedStudentId && !seatStudentId) {
                    currentSeats[seatIndex] = selectedStudentId;
                    currentSeats[tapSelectedSeatIndex] = null;
                }
                // 场景3：选中座位是空座位，目标座位有学生 → 将学生移动到空座位
                else if (!selectedStudentId && seatStudentId) {
                    currentSeats[tapSelectedSeatIndex] = seatStudentId;
                    currentSeats[seatIndex] = null;
                }
                // 场景4：两个都是空座位 → 取消选择
                else {
                    clearTapSelection();
                    generateSeats();
                    return;
                }

                clearTapSelection();
                commit({ seats: currentSeats });
                generateSeats();
                return;
            }

            // 选中此座位（无论是否有学生）
            if (tapSelectedSeatIndex === seatIndex) {
                clearTapSelection();
            } else {
                clearTapSelection();
                tapSelectedSeatIndex = seatIndex;
                seat.classList.add('selected-for-move');
                updateMobileBanner();
                seat.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
        });

        // 点击空白区域取消选择
        document.addEventListener('click', function (e) {
            if (!isTouchDevice) return;
            // 点击删除区域：删除选中的学生
            if (e.target.closest('#deleteZone')) {
                if (tapSelectedStudentId !== null || tapSelectedSeatIndex !== null) {
                    const studentId = tapSelectedStudentId || (tapSelectedSeatIndex !== null ? currentSeats[tapSelectedSeatIndex] : null);
                    if (studentId) {
                        const student = getStudentById(studentId);
                        if (student && confirm(MESSAGES.CONFIRM_DELETE_STUDENT(student.name))) {
                            pushSnapshot('student');
                            currentSeats = currentSeats.map(id => id === studentId ? null : id);
                            students = students.filter(s => s.id !== studentId);
                            commit({ seats: currentSeats, students: students });
                            updateStudentAssignmentDisplay();
                            generateSeats();
                        }
                    }
                    clearTapSelection();
                }
                return;
            }
            if (!e.target.closest('.seat') && !e.target.closest('.student-item')) {
                clearTapSelection();
            }
        });

        // （批量分配功能已移除：改为「切换模式 ▾ → 分组模式」，
        //   在座位表上点击多选学生后，点分组按钮即可批量分配到该组，或「＋新建分组并分配」）

        // 快速随机入座：将所有未安排座位的学生随机分配到空座位
        quickRandomBtn.addEventListener('click', function () {
            const unassigned = getUnassignedStudents();
            if (unassigned.length === 0) {
                alert(MESSAGES.ALL_STUDENTS_SEATED);
                return;
            }
            const emptyIndices = [];
            for (let i = 0; i < currentSeats.length; i++) {
                if (currentSeats[i] === null) emptyIndices.push(i);
            }
            if (emptyIndices.length === 0) {
                alert(MESSAGES.NO_EMPTY_SEATS);
                return;
            }
            if (confirm(MESSAGES.CONFIRM_QUICK_RANDOM(unassigned.length))) {
                pushSnapshot('batch');
                const shuffled = shuffle(unassigned.map(s => s.id));
                const assigned = Math.min(shuffled.length, emptyIndices.length);
                for (let i = 0; i < assigned; i++) {
                    currentSeats[emptyIndices[i]] = shuffled[i];
                }
                generateSeats();
                generateStudentList();
                autoSave();
            }
        });

        // 分组模式 banner：新建分组并把当前选中学生分配进去
        function createGroupAndAssign() {
            if (groupModeSelectedIds.size === 0) {
                alert(MESSAGES.GROUP_MODE_NO_SELECTION || '请先在座位表中点击选择学生');
                return;
            }
            const name = prompt(MESSAGES.GROUP_MODE_NEW_NAME || '请输入新分组名称：');
            if (!name) return;
            const trimmed = name.trim();
            if (!trimmed) return;
            if (groups.some(g => g.name === trimmed)) {
                alert(MESSAGES.GROUP_NAME_EXISTS);
                return;
            }
            const newGroup = { id: generateId('g'), name: trimmed, color: pickGroupColor() };
            groups.push(newGroup);
            commit({ groups: groups });
            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            renderGroupModeList();
            // 把当前选中的座位学生分配到新分组
            assignSelectedToGroup(newGroup.id);
        }

        // 分组 banner 内按钮走事件委托(banner 会随座位表重建,直接绑 listener 会失效)
        classroom.addEventListener('click', function (e) {
            if (e.target.closest('#groupModeExitBtn')) {
                toggleGroupMode();          // × 关闭 ⇒ 退出分组模式(回到普通)
                return;
            }
            if (e.target.closest('#groupModeNewBtn')) {
                createGroupAndAssign();
                return;
            }
            if (e.target.closest('#groupModeClearBtn')) {
                // 一键清空已有选择(不清分组查看态,仅退多选)
                clearMultiSelection();
                return;
            }
            const gBtn = e.target.closest('.group-mode-group-btn');
            if (gBtn) {
                // 长按删除已在 pointerup 前触发 ⇒ 抑制这次 click,避免「删完又分配」
                if (groupLongPressFired) {
                    groupLongPressFired = false;
                    return;
                }
                const groupId = gBtn.getAttribute('data-group-id');
                if (!groupId) return;
                if (groupModeSelectedIds.size === 0) {
                    // 未选中任何学生 ⇒ 查看该分组:高亮其成员 + 统计栏展示(再点一次取消)
                    focusGroupMode(groupId);
                    return;
                }
                assignSelectedToGroup(groupId);
                return;
            }
        });

        // 普通模式多选:点击空白区域(座位表空白处 / 面板 / 页面其他位置)自动取消选择。
        // 座位本身由上面的 classroom 委托处理(选中/取消/空白座位),这里跳过,避免刚选中就被清掉。
        document.addEventListener('click', function (e) {
            if (isGroupMode || isCheckinMode || isTouchDevice) return;
            if (groupModeSelectedIds.size === 0) return;
            if (e.target.closest('.seat')) return;                  // 座位走上面的分支
            if (e.target.closest('#groupStatsRow')) return;          // 点「已选人数」弹菜单
            if (e.target.closest('.stat-action-menu')) return;       // 菜单本身
            if (e.target.closest('.pair-popup')) return;             // 配对设置弹窗内操作
            clearMultiSelection({ toast: false });
        });

        // ── 分组按钮长按删除(鼠标 + 触摸) ────────────────────────────────
        // 短按 = 分配选中学生到该组;长按 600ms = 直接删除该分组(可撤销)。
        // banner 会随座位表重建,故一律走 #classroom 事件委托。
        const GROUP_LONG_PRESS_MS = 600;
        const GROUP_PRESS_MOVE_TOLERANCE = 10;   // px,超过视为滑动 ⇒ 取消长按
        let groupPress = null;                   // { timer, btn, x, y }
        let groupLongPressFired = false;         // 供 click 委托判断是否需要抑制

        function cancelGroupPress() {
            if (!groupPress) return;
            clearTimeout(groupPress.timer);
            if (groupPress.btn) groupPress.btn.classList.remove('long-pressing');
            groupPress = null;
        }

        function beginGroupPress(btn, x, y) {
            cancelGroupPress();
            groupLongPressFired = false;
            btn.classList.add('long-pressing');
            groupPress = {
                btn: btn,
                x: x,
                y: y,
                timer: setTimeout(function () {
                    const groupId = btn.getAttribute('data-group-id');
                    cancelGroupPress();
                    groupLongPressFired = true;
                    if (groupId) deleteGroupFromBanner(groupId);
                }, GROUP_LONG_PRESS_MS)
            };
        }

        function deleteGroupFromBanner(groupId) {
            const group = groups.find(function (g) { return g.id === groupId; });
            if (!group) return;
            pushSnapshot('group');
            students.forEach(function (s) {
                if (s.groupId === groupId) s.groupId = null;
            });
            groups = groups.filter(function (g) { return g.id !== groupId; });
            if (groupFocusId === groupId) groupFocusId = null;
            commit({ students: students, groups: groups });
            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            generateSeats();
            renderGroupModeList();
            updateGroupModeCount();
            autoSave();
            showStatToast('已删除分组「' + group.name + '」,可点「撤销」恢复');
        }

        function isGroupPressMoved(x, y) {
            if (!groupPress) return false;
            return Math.abs(x - groupPress.x) > GROUP_PRESS_MOVE_TOLERANCE
                || Math.abs(y - groupPress.y) > GROUP_PRESS_MOVE_TOLERANCE;
        }

        function onGroupPressDown(btn, x, y) {
            beginGroupPress(btn, x, y);
        }

        if (window.PointerEvent) {
            classroom.addEventListener('pointerdown', function (e) {
                const btn = e.target.closest('.group-mode-group-btn');
                if (btn) onGroupPressDown(btn, e.clientX, e.clientY);
            });
            classroom.addEventListener('pointermove', function (e) {
                if (groupPress && isGroupPressMoved(e.clientX, e.clientY)) cancelGroupPress();
            });
            ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
                classroom.addEventListener(type, cancelGroupPress);
            });
        } else {
            // 老版 iOS Safari 等无 PointerEvent 的环境,回退到 touch 事件
            classroom.addEventListener('touchstart', function (e) {
                const btn = e.target.closest('.group-mode-group-btn');
                if (!btn || !e.touches.length) return;
                onGroupPressDown(btn, e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: true });
            classroom.addEventListener('touchmove', function (e) {
                if (!groupPress || !e.touches.length) return;
                if (isGroupPressMoved(e.touches[0].clientX, e.touches[0].clientY)) cancelGroupPress();
            }, { passive: true });
            ['touchend', 'touchcancel'].forEach(function (type) {
                classroom.addEventListener(type, cancelGroupPress);
            });
        }

        // 长按期间屏蔽系统右键菜单 / 移动端长按选择,避免打断删除手势
        classroom.addEventListener('contextmenu', function (e) {
            if (e.target.closest('.group-mode-group-btn')) e.preventDefault();
        });

        // 折叠面板交互
        document.querySelectorAll('.collapse-header').forEach(function (header) {
            header.addEventListener('click', function () {
                const panel = header.closest('.collapse-panel');
                const willExpand = panel.classList.contains('collapsed');
                document.querySelectorAll('.collapse-panel').forEach(function (otherPanel) {
                    if (otherPanel !== panel) otherPanel.classList.add('collapsed');
                });
                panel.classList.toggle('collapsed', !willExpand);
            });
        });

        // 「切换模式」按钮:显示当前模式(普通 / 签到 / 分组),非普通模式高亮
        function updateModeSwitchButton() {
            let icon = '▦';
            let label = '普通模式';
            if (isCheckinMode) {
                icon = '✓';
                label = '签到模式';
            } else if (isGroupMode) {
                icon = '👥';
                label = '分组模式';
            }
            if (modeSwitchIcon) modeSwitchIcon.textContent = icon;
            if (modeSwitchLabel) modeSwitchLabel.textContent = label;
            if (modeSwitchBtn) {
                modeSwitchBtn.classList.toggle('action-btn-primary', !!(isCheckinMode || isGroupMode));
                modeSwitchBtn.title = '当前：' + label + '，点击切换到下一模式（普通 → 签到 → 分组）';
            }
        }

        // ==================== 统计项点击：复制姓名 / 下载 Excel ====================

        let statActionMenuEl = null;
        let statToastEl = null;
        let statToastTimer = null;
        let currentStatContext = null; // { statId, title, students }

        function ensureStatActionMenu() {
            if (statActionMenuEl) return;
            statActionMenuEl = document.createElement('div');
            statActionMenuEl.className = 'stat-action-menu';
            statActionMenuEl.setAttribute('role', 'menu');
            statActionMenuEl.innerHTML =
                '<div class="stat-action-menu-header" id="statActionHeader"></div>' +
                '<button class="stat-action-menu-item" data-action="copy" role="menuitem">' +
                    '<span class="stat-action-icon">📋</span><span>复制姓名</span>' +
                '</button>' +
                '<button class="stat-action-menu-item" data-action="excel" role="menuitem">' +
                    '<span class="stat-action-icon">📊</span><span>下载 Excel</span>' +
                '</button>';
            document.body.appendChild(statActionMenuEl);

            statActionMenuEl.addEventListener('click', function (e) {
                const btn = e.target.closest('.stat-action-menu-item');
                if (!btn) return;
                const action = btn.getAttribute('data-action');
                const ctx = currentStatContext;
                if (!ctx) return;
                hideStatActionMenu();
                if (action === 'copy') copyStatNames(ctx);
                else if (action === 'excel') downloadStatExcel(ctx);
            });

            statActionMenuEl.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    hideStatActionMenu();
                }
            });
        }

        function ensureStatToast() {
            if (statToastEl) return;
            statToastEl = document.createElement('div');
            statToastEl.className = 'stat-toast';
            statToastEl.setAttribute('role', 'status');
            statToastEl.setAttribute('aria-live', 'polite');
            document.body.appendChild(statToastEl);
        }

        function showStatToast(message) {
            ensureStatToast();
            statToastEl.textContent = message;
            requestAnimationFrame(function () {
                statToastEl.classList.add('visible');
            });
            clearTimeout(statToastTimer);
            statToastTimer = setTimeout(function () {
                statToastEl.classList.remove('visible');
            }, 2200);
        }

        // 根据统计项 id 计算 { title, students }
        function getStatContext(statId) {
            const block = document.querySelector('.stat-block[data-stat="' + statId + '"]');
            let title = statId;
            if (block) {
                const labelEl = block.querySelector('.stat-label');
                if (labelEl) title = labelEl.textContent.trim();
            }

            const assignedIds = new Set(currentSeats.filter(function (s) { return s !== null; }));
            const assignedStudentsArr = students.filter(function (s) { return assignedIds.has(s.id); });

            let list = [];
            switch (statId) {
                case 'totalStudents':
                    list = students.slice();
                    break;
                case 'assignedStudents':
                case 'assignedStudentsCheckin':
                    list = assignedStudentsArr.slice();
                    break;
                case 'unassignedStudents':
                    list = students.filter(function (s) { return !assignedIds.has(s.id); });
                    break;
                case 'checkedInCount':
                    list = assignedStudentsArr.filter(function (s) { return s.checkedIn; });
                    break;
                case 'notCheckedInCount':
                    list = assignedStudentsArr.filter(function (s) { return !s.checkedIn; });
                    break;
                case 'groupMembers':
                    // 分组模式下统计栏的「分组人数」⇒ 取当前聚焦分组的成员
                    if (groupFocusId) {
                        const fg = groups.find(function (g) { return g.id === groupFocusId; });
                        if (fg) {
                            title = fg.name;
                            list = students.filter(function (s) { return s.groupId === fg.id; });
                        }
                    }
                    break;
                case 'groupSelected':
                    // 分组模式下统计栏的「已选人数」⇒ 取当前多选中的学生(按名单顺序)
                    title = '已选学生';
                    list = students.filter(function (s) { return groupModeSelectedIds.has(s.id); });
                    break;
            }
            return { statId: statId, title: title, students: list };
        }

        function showStatActionMenu(statId, anchorX, anchorY) {
            const ctx = getStatContext(statId);
            currentStatContext = ctx;
            ensureStatActionMenu();

            const header = statActionMenuEl.querySelector('#statActionHeader');
            header.textContent = ctx.title + ' · ' + ctx.students.length + ' 人';

            statActionMenuEl.classList.add('visible');

            const w = statActionMenuEl.offsetWidth || 172;
            const h = statActionMenuEl.offsetHeight || 120;
            let left = anchorX - w / 2;
            let top = anchorY + 6;
            if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
            if (left < 8) left = 8;
            if (top + h > window.innerHeight - 8) top = anchorY - h - 6;
            if (top < 8) top = 8;
            statActionMenuEl.style.left = left + 'px';
            statActionMenuEl.style.top = top + 'px';
        }

        function hideStatActionMenu() {
            if (statActionMenuEl) statActionMenuEl.classList.remove('visible');
            currentStatContext = null;
        }

        function copyStatNames(ctx) {
            if (!ctx.students.length) {
                showStatToast(ctx.title + '：暂无学生');
                return;
            }
            const names = ctx.students.map(function (s) { return s.name; }).join('，');
            const text = ctx.title + '：' + names;

            function onSuccess() {
                showStatToast('已复制 ' + ctx.students.length + ' 个姓名到剪贴板');
            }
            function onFail() {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.setAttribute('readonly', '');
                    ta.style.position = 'fixed';
                    ta.style.top = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    const ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                    if (ok) onSuccess();
                    else showStatToast('复制失败，请手动复制');
                } catch (err) {
                    showStatToast('复制失败，请手动复制');
                }
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(onSuccess).catch(function () { onFail(); });
            } else {
                onFail();
            }
        }

        function downloadStatExcel(ctx) {
            if (!ctx.students.length) {
                showStatToast(ctx.title + '：暂无学生');
                return;
            }
            if (typeof XLSX === 'undefined') {
                showStatToast('Excel 库未加载，无法导出');
                return;
            }
            const aoa = [['姓名', '性别', '标签', '分组', '签到']];
            ctx.students.forEach(function (s) {
                const group = s.groupId ? getGroupById(s.groupId) : null;
                const groupName = group ? group.name : '未分组';
                const checkinText = s.checkedIn ? '是' : '否';
                const genderText = s.gender === 'male' ? '男' : (s.gender === 'female' ? '女' : '');
                const tagsText = (s.tags || []).map(function (t) { return t.label; }).join('、');
                aoa.push([s.name, genderText, tagsText, groupName, checkinText]);
            });
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 20 }, { wch: 16 }, { wch: 8 }];
            const wb = XLSX.utils.book_new();
            const sheetName = (ctx.title || '学生名单').slice(0, 28);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            const d = new Date();
            const dateStr = d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
            const fileName = ctx.title + '_学生名单_' + dateStr + '.xlsx';
            XLSX.writeFile(wb, fileName);
            showStatToast('已下载 ' + ctx.students.length + ' 条学生记录');
        }

        function initStatBlockActions() {
            const blocks = document.querySelectorAll('.stat-block[data-stat]');
            blocks.forEach(function (block) {
                const statId = block.getAttribute('data-stat');
                block.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const ctx = getStatContext(statId);
                    if (!ctx.students.length) {
                        showStatToast(ctx.title + '：暂无学生');
                        return;
                    }
                    const rect = block.getBoundingClientRect();
                    showStatActionMenu(statId, rect.left + rect.width / 2, rect.bottom);
                });
            });

            // 点击菜单外部关闭
            document.addEventListener('click', function (e) {
                if (!statActionMenuEl || !statActionMenuEl.classList.contains('visible')) return;
                if (!statActionMenuEl.contains(e.target)) hideStatActionMenu();
            });
            // Esc 关闭
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && statActionMenuEl && statActionMenuEl.classList.contains('visible')) {
                    hideStatActionMenu();
                }
            });
            // 滚动 / 尺寸变化时关闭，避免菜单飘离锚点
            window.addEventListener('scroll', hideStatActionMenu, true);
            window.addEventListener('resize', hideStatActionMenu);
        }

        // 执行初始化
        initialize();
        initStatBlockActions();

        // P1 (1) 测试桩 — 仅在 URL 带 ?debug=1 时暴露,允许冒烟测试读 undo 栈
        // 生产构建无 query 参数,此分支 dead-code,体积开销为 0 字节。
        if (typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search)) {
            window.__undoTest = {
                pushSnapshot: pushSnapshot,
                undo: undo,
                redo: redo,
                getUndoStackLength: function () { return undoStack.length; },
                getRedoStackLength: function () { return redoStack.length; },
                getLastSnapOpType: function () { return lastSnapOpType; },
                getSmartMergeMs: getSmartMergeMs
            };
        }

    })();
