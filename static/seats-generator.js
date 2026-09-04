import { state, bus, commit, subscribe, selectors } from './modules/state.js';

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
const batchSelectedIds = state.batchSelectedIds;  // Set 引用稳定,用 const 安全
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
let isBatchMode = state.isBatchMode;
let showStudentIcons = state.showStudentIcons;
let isTouchDevice = state.isTouchDevice;

        // DOM 引用
        const classroom = document.getElementById('classroom');
        const classroomWrapper = classroom.parentElement;
        const pageTitle = document.getElementById('pageTitle');
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
        const batchModeBtn = document.getElementById('batchModeBtn');
        const batchToolbar = document.getElementById('batchToolbar');
        const batchGroupSelect = document.getElementById('batchGroupSelect');
        const batchAssignBtn = document.getElementById('batchAssignBtn');
        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        const batchSelectAllBtn = document.getElementById('batchSelectAllBtn');
        const batchCancelBtn = document.getElementById('batchCancelBtn');
        const batchCountEl = document.getElementById('batchCount');
        const quickRandomBtn = document.getElementById('quickRandomBtn');
        const pairSettingsBtn = document.getElementById('pairSettingsBtn');
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

        let draggedStudentId = null;
        let draggedFromIndex = null;
        let excelData = null;
        let selectedColumnIndex = 0;
        let dragStartTime = 0;

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

        // 批量操作状态
        // let isBatchMode = false;        // 见顶部 path-A1 别名
        // const batchSelectedIds = new Set();  // 见顶部 path-A1 别名

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

        // ==================== 撤销/重做 ====================

        function pushSnapshot() {
            if (isUndoing) return;
            undoStack.push({
                seats: [...currentSeats],
                students: JSON.parse(JSON.stringify(students)),
                groups: JSON.parse(JSON.stringify(groups)),
                aisles: JSON.parse(JSON.stringify(aisles)),
                rows: rows,
                cols: cols
            });
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            redoStack.length = 0;
            updateUndoRedoButtons();
        }

        function undo() {
            if (undoStack.length === 0) return;
            isUndoing = true;
            redoStack.push({
                seats: [...currentSeats],
                students: JSON.parse(JSON.stringify(students)),
                groups: JSON.parse(JSON.stringify(groups)),
                aisles: JSON.parse(JSON.stringify(aisles)),
                rows: rows,
                cols: cols
            });
            const snap = undoStack.pop();
            currentSeats = [...snap.seats];
            students = JSON.parse(JSON.stringify(snap.students));
            groups = JSON.parse(JSON.stringify(snap.groups));
            aisles = JSON.parse(JSON.stringify(snap.aisles));
            rows = snap.rows;
            cols = snap.cols;
            commit({ seats: currentSeats, students: students, groups: groups, aisles: aisles, rows: rows, cols: cols });
            rowsInput.value = rows;
            colsInput.value = cols;
            updateAisleDisplay();
            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            generateSeats();
            isUndoing = false;
            updateUndoRedoButtons();
        }

        function redo() {
            if (redoStack.length === 0) return;
            isUndoing = true;
            undoStack.push({
                seats: [...currentSeats],
                students: JSON.parse(JSON.stringify(students)),
                groups: JSON.parse(JSON.stringify(groups)),
                aisles: JSON.parse(JSON.stringify(aisles)),
                rows: rows,
                cols: cols
            });
            const snap = redoStack.pop();
            currentSeats = [...snap.seats];
            students = JSON.parse(JSON.stringify(snap.students));
            groups = JSON.parse(JSON.stringify(snap.groups));
            aisles = JSON.parse(JSON.stringify(snap.aisles));
            rows = snap.rows;
            cols = snap.cols;
            commit({ seats: currentSeats, students: students, groups: groups, aisles: aisles, rows: rows, cols: cols });
            rowsInput.value = rows;
            colsInput.value = cols;
            updateAisleDisplay();
            updateGroupDisplay();
            updateStudentAssignmentDisplay();
            generateSeats();
            isUndoing = false;
            updateUndoRedoButtons();
        }

        function updateUndoRedoButtons() {
            undoBtn.disabled = undoStack.length === 0;
            redoBtn.disabled = redoStack.length === 0;
        }

        // ==================== 配置迁移（向后兼容） ====================

        function migrateConfig(config) {
            if (!config) return config;
            // 处理极旧格式：students 是字符串数组
            if (config.students && config.students.length > 0 && typeof config.students[0] === 'string') {
                config.students = config.students.map(function (name) {
                    return { id: generateId('s'), name: name, groupId: null, gender: '', tags: [] };
                });
            }
            // 处理旧格式：students 对象没有 id 字段
            if (config.students && config.students.length > 0 && !config.students[0].id) {
                config.students.forEach(function (s) {
                    if (!s.id) s.id = generateId('s');
                });
            }
            // 如果 seats 中存的是姓名而非 ID，转换为 ID
            if (config.seats && config.students && config.students.length > 0) {
                const idSet = new Set(config.students.map(function (s) { return s.id; }));
                const nameToId = new Map(config.students.map(function (s) { return [s.name, s.id]; }));
                config.seats = config.seats.map(function (seatVal) {
                    if (seatVal == null) return null;
                    if (idSet.has(seatVal)) return seatVal; // 已经是 ID
                    return nameToId.get(seatVal) || null;   // 旧格式姓名 → ID
                });
            }
            // 为旧数据补充 checkedIn 字段
            if (config.students && config.students.length > 0) {
                config.students.forEach(function (s) {
                    if (s.checkedIn == null) s.checkedIn = false;
                    if (s.gender == null) s.gender = '';
                    if (s.tags == null || !Array.isArray(s.tags)) s.tags = [];
                });
            }
            // 为旧数据补充配对约束
            if (!Array.isArray(config.forcedPairs)) config.forcedPairs = [];
            if (!Array.isArray(config.avoidPairs)) config.avoidPairs = [];
            // 补全 v1.3.0 新增的顶层字段默认值（P0-a 修复）
            if (!Array.isArray(config.aisles)) config.aisles = [];
            if (config.showStudentIcons === undefined) config.showStudentIcons = true;
            if (!config.viewMode) config.viewMode = 'student';
            if (typeof config.title !== 'string' || !config.title.trim()) config.title = '班级座位表';
            config.version = APP_VERSION;
            return config;
        }

        // 添加走道按钮事件
        document.getElementById('addAisleBtn').addEventListener('click', function () {
            const afterCol = parseInt(document.getElementById('aisleAfterCol').value);
            const width = parseInt(document.getElementById('aisleWidth').value);

            if (afterCol < 1 || afterCol >= cols) {
                alert('列数必须在1到' + (cols - 1) + '之间！');
                return;
            }

            if (aisles.some(a => a.afterCol === afterCol)) {
                alert('该位置已存在走道！');
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
                alert('请输入分组名称');
                return;
            }

            if (groups.some(g => g.name === name)) {
                alert('分组名称已存在');
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
            if (confirm('确定要删除这个分组吗？该分组的学生将变为未分组状态。')) {
                pushSnapshot();
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
                    if (isBatchMode && batchSelectedIds.has(student.id)) {
                        classes += ' batch-selected';
                    }
                    const checkbox = isBatchMode
                        ? '<input type="checkbox" class="batch-checkbox" ' + (batchSelectedIds.has(student.id) ? 'checked' : '') + '>'
                        : '';
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
                    alert('请输入学生姓名');
                    return;
                }
                if (students.some(s => s.name === name)) {
                    alert('该学生已存在');
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
                alert('请输入学生姓名');
                updateStudentAssignmentDisplay();
                return;
            }

            const student = getStudentById(studentId);
            if (!student) return;

            if (students.some(s => s.name === newName && s.id !== studentId)) {
                alert('该姓名已存在');
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
            if (confirm('确定要删除学生 ' + student.name + ' 吗？')) {
                pushSnapshot();
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

            const container = ensureTagPopupContainer();
            const popup = document.createElement('div');
            popup.className = 'tag-popup';
            popup.innerHTML =
                '<div class="tag-popup-title">管理标签 — 新增学生</div>' +
                '<div class="tag-chips-container"></div>' +
                '<div class="tag-popup-row">' +
                    '<input type="text" class="tag-popup-emoji" placeholder="🏷" maxlength="4" title="emoji图标">' +
                    '<input type="text" class="tag-popup-input" placeholder="标签名称">' +
                    '<button class="mini-btn primary tag-popup-add">添加</button>' +
                '</div>' +
                '<div class="tag-suggestions" style="display:none;"></div>';

            container.appendChild(popup);

            const rect = anchorEl.getBoundingClientRect();
            const popupWidth = 280;
            let left = rect.right + 8;
            let top = rect.top;
            if (left + popupWidth > window.innerWidth - 8) {
                left = Math.max(8, rect.left - popupWidth - 8);
            }
            popup.style.left = left + 'px';
            popup.style.top = top + 'px';

            // 用一个伪对象让 renderTagPopup 复用
            var tempStudent = { name: '新增学生', tags: tempTags };
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

            requestAnimationFrame(function () {
                popup.classList.add('visible');
            });

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

            // 回车添加
            popup.querySelector('.tag-popup-input').addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    popup.querySelector('.tag-popup-add').click();
                }
            });

            // 标签建议
            var labelInput = popup.querySelector('.tag-popup-input');
            var suggestionHideTimer = null;
            labelInput.addEventListener('focus', function () {
                if (suggestionHideTimer) { clearTimeout(suggestionHideTimer); suggestionHideTimer = null; }
                var suggestionsEl = popup.querySelector('.tag-suggestions');
                var existingTags = collectExistingTags(tempStudent);
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
                suggestionHideTimer = setTimeout(function () {
                    var el = popup.querySelector('.tag-suggestions');
                    if (el) el.style.display = 'none';
                }, 150);
            });
            popup.querySelector('.tag-suggestions').addEventListener('click', function (e) {
                var sItem = e.target.closest('.tag-suggestion-item');
                if (!sItem) return;
                e.preventDefault();
                popup.querySelector('.tag-popup-emoji').value = sItem.getAttribute('data-emoji') || '';
                popup.querySelector('.tag-popup-input').value = sItem.getAttribute('data-label');
                popup.querySelector('.tag-suggestions').style.display = 'none';
            });

            popup.addEventListener('click', function (e) {
                e.stopPropagation();
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
                activeTagPopup.popupEl.classList.remove('visible');
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

            const container = ensureTagPopupContainer();
            const popup = document.createElement('div');
            popup.className = 'tag-popup';
            popup.innerHTML =
                '<div class="tag-popup-title">管理标签 — ' + escapeHtml(student.name) + '</div>' +
                '<div class="tag-chips-container"></div>' +
                '<div class="tag-popup-row">' +
                    '<input type="text" class="tag-popup-emoji" placeholder="🏷" maxlength="4" title="emoji图标">' +
                    '<input type="text" class="tag-popup-input" placeholder="标签名称">' +
                    '<button class="mini-btn primary tag-popup-add">添加</button>' +
                '</div>' +
                '<div class="tag-suggestions" style="display:none;"></div>';

            container.appendChild(popup);

            // 定位 popup
            const rect = anchorEl.getBoundingClientRect();
            const popupWidth = 280;
            let left = rect.right + 8;
            let top = rect.top;
            if (left + popupWidth > window.innerWidth - 8) {
                left = Math.max(8, rect.left - popupWidth - 8);
            }
            popup.style.left = left + 'px';
            popup.style.top = top + 'px';

            activeTagPopup = { studentId: studentId, popupEl: popup };

            renderTagPopup(popup, student);

            // 显示 popup
            requestAnimationFrame(function () {
                popup.classList.add('visible');
            });

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
                pushSnapshot();
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
                pushSnapshot();
                student.tags.splice(idx, 1);
                renderTagPopup(popup, student);
                generateSeats();
                updateStudentAssignmentDisplay();
                autoSave();
            });

            // 回车添加
            popup.querySelector('.tag-popup-input').addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    popup.querySelector('.tag-popup-add').click();
                }
            });

            // 标签名称输入框 focus 时显示已有标签建议
            const labelInput = popup.querySelector('.tag-popup-input');
            let suggestionHideTimer = null;
            labelInput.addEventListener('focus', function () {
                if (suggestionHideTimer) {
                    clearTimeout(suggestionHideTimer);
                    suggestionHideTimer = null;
                }
                const suggestionsEl = popup.querySelector('.tag-suggestions');
                const existingTags = collectExistingTags(student);
                if (existingTags.length === 0) {
                    suggestionsEl.style.display = 'none';
                    return;
                }
                suggestionsEl.innerHTML = existingTags.map(function (t) {
                    return '<button type="button" class="tag-suggestion-item" data-emoji="' + escapeHtml(t.emoji || '') + '" data-label="' + escapeHtml(t.label) + '">' +
                        '<span class="tag-suggestion-emoji">' + escapeHtml(t.emoji || '🏷') + '</span>' +
                        '<span class="tag-suggestion-label">' + escapeHtml(t.label) + '</span>' +
                    '</button>';
                }).join('');
                suggestionsEl.style.display = 'block';
            });
            labelInput.addEventListener('blur', function () {
                // 延迟隐藏，让点击建议项能触发
                suggestionHideTimer = setTimeout(function () {
                    const el = popup.querySelector('.tag-suggestions');
                    if (el) el.style.display = 'none';
                }, 150);
            });

            // 点击建议项填充
            popup.querySelector('.tag-suggestions').addEventListener('click', function (e) {
                const item = e.target.closest('.tag-suggestion-item');
                if (!item) return;
                e.preventDefault();
                const emojiInput = popup.querySelector('.tag-popup-emoji');
                const labelInput = popup.querySelector('.tag-popup-input');
                emojiInput.value = item.getAttribute('data-emoji') || '';
                labelInput.value = item.getAttribute('data-label');
                popup.querySelector('.tag-suggestions').style.display = 'none';
            });

            // 防止点击 popup 内部关闭
            popup.addEventListener('click', function (e) {
                e.stopPropagation();
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

        function renderPairList(container, pairArr, type) {
            if (pairArr.length === 0) {
                container.innerHTML = '<div class="pair-empty">暂无' + (type === 'forced' ? '强制' : '回避') + '配对</div>';
                return;
            }
            container.innerHTML = pairArr.map(function (pair, idx) {
                var sA = students.find(function (s) { return s.id === pair[0]; });
                var sB = students.find(function (s) { return s.id === pair[1]; });
                var nameA = sA ? sA.name : '(已删除)';
                var nameB = sB ? sB.name : '(已删除)';
                return '<div class="pair-item">' +
                    '<span class="pair-item-names">' + escapeHtml(nameA) + ' ↔ ' + escapeHtml(nameB) + '</span>' +
                    '<button class="pair-item-remove" data-pair-type="' + type + '" data-pair-idx="' + idx + '" title="删除">×</button>' +
                '</div>';
            }).join('');
        }

        function openPairPopup(anchorEl) {
            if (activePairPopup) closePairPopup();

            var container = ensureTagPopupContainer();
            var popup = document.createElement('div');
            popup.className = 'pair-popup';

            var studentOpts = students.length > 0
                ? students.map(function (s) { return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>'; }).join('')
                : '';

            popup.innerHTML =
                '<div class="pair-popup-title">配对设置</div>' +
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
                // 更新按钮文字
                pairSettingsBtn.textContent = '配对设置' +
                    (forcedPairs.length > 0 ? ' [' + forcedPairs.length + '强' : '') +
                    (avoidPairs.length > 0 ? (forcedPairs.length > 0 ? '/' : ' [') + avoidPairs.length + '避' : '') +
                    (forcedPairs.length > 0 || avoidPairs.length > 0 ? ']' : '');
            }

            renderAll();

            requestAnimationFrame(function () {
                popup.classList.add('visible');
            });

            // 添加强制配对
            popup.querySelector('.pair-forced-add').addEventListener('click', function () {
                var a = popup.querySelector('.pair-forced-a').value;
                var b = popup.querySelector('.pair-forced-b').value;
                if (!a || !b || a === b) { alert('请选择两位不同的学生'); return; }
                var key = pairKey(a, b);
                if (forcedPairs.some(function (p) { return pairKey(p[0], p[1]) === key; })) {
                    alert('该配对已存在'); return;
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
                if (!a || !b || a === b) { alert('请选择两位不同的学生'); return; }
                var key = pairKey(a, b);
                if (avoidPairs.some(function (p) { return pairKey(p[0], p[1]) === key; })) {
                    alert('该配对已存在'); return;
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
        }

        function closePairPopup() {
            if (activePairPopup) {
                activePairPopup.popupEl.classList.remove('visible');
                setTimeout(function () {
                    if (activePairPopup && activePairPopup.popupEl.parentNode) {
                        activePairPopup.popupEl.parentNode.removeChild(activePairPopup.popupEl);
                    }
                    activePairPopup = null;
                }, 150);
            }
        }

        // 配对设置按钮事件
        pairSettingsBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (activePairPopup) {
                closePairPopup();
            } else {
                openPairPopup(pairSettingsBtn);
            }
        });

        // 点击 popup 外部关闭
        document.addEventListener('click', function (e) {
            if (!activePairPopup) return;
            if (activePairPopup.popupEl.contains(e.target)) return;
            if (e.target.closest('#pairSettingsBtn')) return;
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
            const lower = text.trim().toLowerCase();
            if (lower === '男' || lower === 'male' || lower === 'm' || lower === '♂' || lower === 'boy' || lower === '1') return 'male';
            if (lower === '女' || lower === 'female' || lower === 'f' || lower === '♀' || lower === 'girl' || lower === '2') return 'female';
            return '';
        }

        // 根据标签文本自动选择一个 emoji（尽量与语义相关，且不与已有 emoji 重复）
        // 关键词 → emoji 映射（覆盖常见学校场景）
        const EMOJI_KEYWORD_MAP = [
            { keywords: ['班长', '班主任', '干部', 'leader', 'chief'], emoji: '👑' },
            { keywords: ['副班长', 'vice'], emoji: '🥈' },
            { keywords: ['学习', '学霸', '成绩', '第一名', 'top', 'study'], emoji: '📚' },
            { keywords: ['体育', '运动', '跑步', '篮球', '足球', 'sport'], emoji: '⚽' },
            { keywords: ['艺术', '音乐', '唱歌', '舞蹈', 'art', 'music'], emoji: '🎨' },
            { keywords: ['文艺', '艺术', '美术', '画', 'painting', 'draw'], emoji: '🖌' },
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
            { keywords: ['需关注', 'attention', 'warning'], emoji: '⚠️' },
            { keywords: ['国', 'china', '中国'], emoji: '🇨🇳' },
            { keywords: ['男', 'boy', 'male'], emoji: '♂️' },
            { keywords: ['女', 'girl', 'female'], emoji: '♀️' },
            { keywords: ['小组', 'group', 'team'], emoji: '👥' },
            { keywords: ['家长', 'parent', 'mom', 'dad'], emoji: '👨‍👩‍👧' },
            { keywords: ['走读', 'day'], emoji: '🏠' },
            { keywords: ['住宿', '寄宿', 'board'], emoji: '🏫' },
            { keywords: ['生日', 'birthday'], emoji: '🎂' },
        ];
        // 备用 emoji 池（不依赖关键词匹配时从中选取）
        const FALLBACK_EMOJI_POOL = ['📌', '📍', '💡', '🔥', '🎯', '🚀', '🎉', '🌈', '🔖', '🏷', '🎭', '🎪', '🎁', '✨', '💫', '⚡', '🌊', '🍀', '🌸', '🌻', '🐼', '🦊', '🐰', '🐱', '🐶'];

        function autoAssignEmoji(label, usedEmojis) {
            if (!usedEmojis) usedEmojis = new Set();
            const labelLower = label.toLowerCase();
            // 1. 先尝试关键词匹配
            for (let i = 0; i < EMOJI_KEYWORD_MAP.length; i++) {
                const entry = EMOJI_KEYWORD_MAP[i];
                for (let j = 0; j < entry.keywords.length; j++) {
                    if (labelLower.indexOf(entry.keywords[j]) >= 0) {
                        if (!usedEmojis.has(entry.emoji)) {
                            usedEmojis.add(entry.emoji);
                            return entry.emoji;
                        }
                    }
                }
            }
            // 2. 关键词无匹配或 emoji 已被占用：从备用池选第一个未被占用的
            for (let i = 0; i < FALLBACK_EMOJI_POOL.length; i++) {
                if (!usedEmojis.has(FALLBACK_EMOJI_POOL[i])) {
                    usedEmojis.add(FALLBACK_EMOJI_POOL[i]);
                    return FALLBACK_EMOJI_POOL[i];
                }
            }
            // 3. 全部用完：返回🏷（极端情况）
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

            pushSnapshot();
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

        function generateSeats() {
            updateToggleIconsBtnText();
            classroom.style.gridTemplateColumns = generateGridTemplateColumns();
            classroom.innerHTML = '';

            if (isCheckinMode) {
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
                    if (isCheckinMode) toggleCheckinMode();
                });
                banner.querySelector('#resetCheckinBtn').addEventListener('click', function (e) {
                    e.stopPropagation();
                    pushSnapshot();
                    students.forEach(s => s.checkedIn = false);
                    generateSeats();
                });
                banner.querySelector('#allCheckinBtn').addEventListener('click', function (e) {
                    e.stopPropagation();
                    pushSnapshot();
                    students.forEach(s => s.checkedIn = true);
                    generateSeats();
                });
            }

            if (!isTeacherView) {
                const desk = document.createElement('div');
                desk.className = 'teacher-desk';
                desk.textContent = '讲台';
                classroom.appendChild(desk);
            }

            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    let seatIndex;
                    let actualCol;

                    if (isTeacherView) {
                        const actualRow = rows - 1 - row;
                        actualCol = cols - 1 - col;
                        seatIndex = actualRow * cols + actualCol;
                    } else {
                        actualCol = col;
                        seatIndex = row * cols + col;
                    }

                    const seat = document.createElement('div');
                    const studentId = currentSeats[seatIndex];
                    const student = studentId ? getStudentById(studentId) : null;
                    const isCheckedIn = student && student.checkedIn;
                    let seatClass = studentId ? 'seat' : 'seat empty';
                    if (isCheckedIn) seatClass += ' checked-in';
                    else if (studentId && isCheckinMode) seatClass += ' not-checked-in';
                    seat.className = seatClass;
                    seat.setAttribute('data-index', seatIndex);
                    seat.setAttribute('data-student', studentId || '');

                    const displayRow = Math.floor(seatIndex / cols) + 1;
                    const displayCol = (seatIndex % cols) + 1;

                    if (studentId) {
                        const displayName = student ? student.name : '';
                        const groupColor = getStudentGroupColor(studentId);
                        if (groupColor) {
                            seat.style.backgroundColor = groupColor;
                            seat.style.borderColor = adjustColor(groupColor, -30);
                            seat.style.color = isLightColor(groupColor) ? '#000' : '#fff';
                        }
                        // 签到模式下不显示删除按钮（√ 由 CSS ::before 显示）
                        const deleteBtnHtml = isCheckinMode ? '' : '<button class="seat-delete-btn" title="删除学生">×</button>';
                        // 构建性别和标签图标
                        let iconsHtml = '';
                        if (showStudentIcons && student) {
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
                        seat.draggable = !isTouchDevice && !isCheckinMode;
                    } else {
                        seat.innerHTML =
                            '<span class="seat-number">' + displayRow + '排' + displayCol + '列</span>' +
                            '<span class="seat-name" style="color: #999;">空</span>';
                        seat.draggable = false;
                    }

                    classroom.appendChild(seat);

                    let checkCol = isTeacherView ? actualCol : (col + 1);
                    const aisle = aisles.find(a => a.afterCol === checkCol);
                    if (aisle) {
                        const aislePlaceholder = document.createElement('div');
                        aislePlaceholder.className = 'aisle-placeholder';
                        classroom.appendChild(aislePlaceholder);
                    }
                }
            }

            if (isTeacherView) {
                const desk = document.createElement('div');
                desk.className = 'teacher-desk teacher-view';
                desk.textContent = '讲台';
                classroom.appendChild(desk);
            }

            if (isCheckinMode) {
                classroom.classList.add('checkin-mode');
            } else {
                classroom.classList.remove('checkin-mode');
            }

            generateStudentList();
            updateStatistics();
            updateCheckinStats();
            autoSave();
        }

        // 生成网格列模板（包含走道）
        // 教师视角：网格列模板从右向左构建，走道位置通过 cols - afterCol 映射
        function generateGridTemplateColumns() {
            let template = '';

            if (isTeacherView) {
                // 教师视角：需要镜像，从右向左遍历
                for (let i = cols; i >= 1; i--) {
                    template += 'var(--seat-width) ';

                    // 检查是否需要在此列后添加走道（镜像位置）
                    // 镜像公式：如果走道在学生视角的第X列后，教师视角在第(cols-X)列后
                    const aisle = aisles.find(a => a.afterCol === i - 1);
                    if (aisle) {
                        template += `${aisle.width}px `;
                    }
                }
            } else {
                // 学生视角：正常从左到右遍历
                for (let i = 1; i <= cols; i++) {
                    template += 'var(--seat-width) ';

                    // 检查是否需要在此列后添加走道
                    const aisle = aisles.find(a => a.afterCol === i);
                    if (aisle) {
                        template += `${aisle.width}px `;
                    }
                }
            }

            return template.trim();
        }


        // 更新统计信息
        function updateStatistics() {
            const total = students.length;
            const assigned = currentSeats.filter(seat => seat !== null).length;
            const unassigned = total - assigned;

            document.getElementById('totalStudents').textContent = total;
            document.getElementById('assignedStudents').textContent = assigned;
            document.getElementById('unassignedStudents').textContent = unassigned;
        }

        // 更新签到统计
        function updateCheckinStats() {
            const assignedIds = new Set(currentSeats.filter(s => s !== null));
            const assigned = assignedIds.size;
            const assignedStudents = students.filter(s => assignedIds.has(s.id));
            const checkedIn = assignedStudents.filter(s => s.checkedIn).length;
            const notCheckedIn = assigned - checkedIn;
            const rate = assigned > 0 ? Math.round((checkedIn / assigned) * 100) : 0;

            const rateEl = document.getElementById('checkinRate');
            const progressBar = document.getElementById('checkinProgressBar');

            if (rateEl) rateEl.textContent = rate + '%';
            if (progressBar) progressBar.style.width = rate + '%';

            if (isCheckinMode) {
                const assignedEl = document.getElementById('assignedStudentsCheckin');
                const checkedInEl = document.getElementById('checkedInCount');
                const notCheckedInEl = document.getElementById('notCheckedInCount');

                if (assignedEl) assignedEl.textContent = assigned;
                if (checkedInEl) checkedInEl.textContent = checkedIn;
                if (notCheckedInEl) notCheckedInEl.textContent = notCheckedIn;
            }
        }

        function toggleCheckinMode() {
            if (typeof clearTapSelection === 'function') {
                clearTapSelection();
            }
            clearDragHighlights();
            isCheckinMode = !isCheckinMode;
            state.isCheckinMode = isCheckinMode;
            commit({ isCheckinMode: isCheckinMode });
            updateCheckinModeButton();
            if (isCheckinMode) {
                classroom.classList.add('checkin-mode');
                document.getElementById('normalStatsRow').style.display = 'none';
                document.getElementById('checkinStatsRow').style.display = 'flex';
            } else {
                classroom.classList.remove('checkin-mode');
                document.getElementById('normalStatsRow').style.display = 'flex';
                document.getElementById('checkinStatsRow').style.display = 'none';
            }
            generateSeats();
            updateCheckinStats();
            if (typeof updateMobileBanner === 'function') {
                updateMobileBanner();
            }
        }

        // 切换学生签到状态
        function toggleStudentCheckin(studentId) {
            const student = getStudentById(studentId);
            if (!student) return;

            pushSnapshot();
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
                    studentItem.addEventListener('dragstart', function (e) {
                        dragStartTime = Date.now();
                        draggedStudentId = student.id;
                        draggedFromIndex = null;
                        e.dataTransfer.setData('text/plain', student.id);
                        studentItem.classList.add('dragging');
                        dragHint.style.display = 'block';
                        classroom.classList.add('highlight');
                        studentList.classList.add('highlight');
                        deleteZone.classList.add('visible');
                    });

                    studentItem.addEventListener('dragend', function (e) {
                        clearDragHighlights();
                    });
                }

                studentList.appendChild(studentItem);
            });

            updateStatistics();
            updateCheckinStats();
        }

        function handleDragStart(e) {
            const seat = e.target.closest('.seat');
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
            seat.classList.add('dragging');
            dragHint.style.display = 'block';
            classroom.classList.add('highlight');
            studentList.classList.add('highlight');
            deleteZone.classList.add('visible');
        }

        function handleDragOver(e) {
            e.preventDefault();
        }

        function handleDragEnter(e) {
            e.preventDefault();
            const seat = e.target.closest('.seat');
            if (seat) seat.classList.add('highlight');
        }

        function handleDragLeave(e) {
            const seat = e.target.closest('.seat');
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

            // 仅在有有效拖拽目标时才保存快照
            const hasValidTarget = e.target.closest('#deleteZone') ||
                                   e.target.closest('.student-list') ||
                                   e.target.closest('.seat');
            if (hasValidTarget && draggedStudentId) {
                pushSnapshot();
            }

            // 删除区域
            if (e.target.closest('#deleteZone')) {
                const student = getStudentById(draggedStudentId);
                const displayName = student ? student.name : '';
                if (confirm('确定要删除学生 ' + displayName + ' 吗？')) {
                    students = students.filter(s => s.id !== draggedStudentId);
                    if (draggedFromIndex !== null) {
                        currentSeats[draggedFromIndex] = null;
                    }
                    commit({ seats: currentSeats, students: students });
                    updateStudentAssignmentDisplay();
                    generateSeats();
                }
                clearDragHighlights();
                return;
            }

            // 拖回学生名单区域
            if (e.target.closest('.student-list')) {
                if (draggedFromIndex !== null) {
                    currentSeats[draggedFromIndex] = null;
                    commit({ seats: currentSeats });
                    generateSeats();
                }
                clearDragHighlights();
                return;
            }

            // 拖到座位
            const seat = e.target.closest('.seat');
            if (!seat) {
                clearDragHighlights();
                return;
            }
            const seatIndex = parseInt(seat.getAttribute('data-index'));
            if (Number.isNaN(seatIndex)) {
                clearDragHighlights();
                return;
            }

            // 从名单拖到座位
            if (draggedStudentId && draggedFromIndex === null) {
                if (currentSeats.includes(draggedStudentId)) {
                    const student = getStudentById(draggedStudentId);
                    alert('学生 ' + (student ? student.name : '') + ' 已经被安排座位了！');
                    clearDragHighlights();
                    return;
                }
                currentSeats[seatIndex] = draggedStudentId;
                commit({ seats: currentSeats });
            }
            // 座位间交换
            else if (draggedFromIndex !== null) {
                const targetStudentId = currentSeats[seatIndex];
                currentSeats[seatIndex] = draggedStudentId;
                currentSeats[draggedFromIndex] = targetStudentId;
                commit({ seats: currentSeats });
            }

            generateSeats();
            clearDragHighlights();
        }

        function handleDragEnd(e) {
            clearDragHighlights();
        }

        // 为学生名单区域添加拖放支持
        if (!isTouchDevice) {
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

            // 为删除区域添加拖放支持
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
        }

        // 为座位表区域添加拖放支持（事件委托）
        if (!isTouchDevice) {
            classroom.addEventListener('dragstart', handleDragStart);
            classroom.addEventListener('dragover', handleDragOver);
            classroom.addEventListener('dragenter', handleDragEnter);
            classroom.addEventListener('dragleave', handleDragLeave);
            classroom.addEventListener('drop', handleDrop);
            classroom.addEventListener('dragend', handleDragEnd);
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
            // 临时隐藏操作按钮和拖拽提示
            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => btn.style.visibility = 'hidden');
            dragHint.style.display = 'none';

            // 创建临时容器，包含标题和座位表，用于导出
            const exportWrapper = document.createElement('div');
            exportWrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;background:#fff;padding:20px;border-radius:8px;';
            const titleClone = pageTitle.cloneNode(true);
            titleClone.style.cssText = 'margin:0 0 16px 0;font-size:24px;font-weight:700;text-align:center;cursor:default;background:none;box-shadow:none;position:static;transform:none;display:block;left:auto;';
            // 在标题后追加当前日期
            const now = new Date();
            const dateStr = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
            const dateLabel = document.createElement('span');
            dateLabel.textContent = dateStr;
            dateLabel.style.cssText = 'font-size:0.6em;font-weight:normal;color:#666;margin-left:12px;';
            titleClone.appendChild(dateLabel);
            exportWrapper.appendChild(titleClone);
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
                alert('导出图片失败，请重试！');
            });
        }

        // 随机排座 — 下拉菜单切换
        randomBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            const dropdown = document.getElementById('randomDropdown');
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });

        // 点击关闭 randomDropdown（事件委托，在 printBtn 的 document click handler 里统一处理）

        // 获取所有同桌对（同 row、相邻 col、中间无走道）和单独座位
        function getDeskMatePairs() {
            const pairs = [];     // [[idx1, idx2], ...] 同桌对
            const singles = [];   // 无法配对的单独座位索引
            for (let r = 0; r < rows; r++) {
                let c = 0;
                while (c < cols) {
                    const idx = r * cols + c;
                    if (c + 1 < cols) {
                        // 检查 c 和 c+1 之间是否有走道
                        const aisle = aisles.find(a => a.afterCol === c + 1);
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

        // 判断学生性别（无性别信息视为中性 wildcard）
        function getGender(s) {
            if (s.gender === 'male') return 'M';
            if (s.gender === 'female') return 'F';
            return 'X'; // unknown / wildcard
        }

        // 随机排座核心函数
        function randomSeatArrange(mode) {
            if (students.length === 0) {
                alert('请先导入学生名单！');
                return;
            }
            if (!confirm('确定要执行「' + ({random:'完全随机', mixed:'男女同桌', samegender:'男女不同桌'}[mode]) + '」排座吗？')) return;

            // 保存旧座位映射（学生ID → 旧座位索引），用于后处理确保完全换座
            var prevSeatMap = {};
            for (var i = 0; i < currentSeats.length; i++) {
                if (currentSeats[i]) prevSeatMap[currentSeats[i]] = i;
            }

            pushSnapshot();
            currentSeats = Array(rows * cols).fill(null);

            const totalSeats = rows * cols;
            const seatCount = Math.min(students.length, totalSeats);

            // 获取同桌对结构（所有模式共用，random 模式也需要处理 forcedPairs）
            const { pairs, singles } = getDeskMatePairs();
            const allSeatIndices = [];
            pairs.forEach(p => { allSeatIndices.push(p[0], p[1]); });
            singles.forEach(s => allSeatIndices.push(s));
            const neededIndices = allSeatIndices.slice(0, seatCount);

            // 用于放置的辅助函数
            function placeStudentsInSeats(seatIndices, studentList) {
                const count = Math.min(seatIndices.length, studentList.length);
                for (let i = 0; i < count; i++) {
                    currentSeats[seatIndices[i]] = studentList[i].id;
                }
            }

            // 辅助：检查两个学生是否构成回避配对
            function isAvoided(idA, idB) {
                return avoidPairs.some(function (p) {
                    return (p[0] === idA && p[1] === idB) || (p[0] === idB && p[1] === idA);
                });
            }

            // ==================== 第一步：处理强制配对 ====================
            const placedIds = new Set();
            const occupiedSeats = new Set();
            const availablePairs = pairs.filter(p => neededIndices.includes(p[0]) && neededIndices.includes(p[1]));
            const shuffledPairsForForced = shuffle(availablePairs.slice());

            forcedPairs.forEach(function (fpair) {
                var idA = fpair[0], idB = fpair[1];
                if (placedIds.has(idA) || placedIds.has(idB)) return;
                // 找一个未被占用的同桌 pair
                var pair = shuffledPairsForForced.find(function (p) {
                    return !occupiedSeats.has(p[0]) && !occupiedSeats.has(p[1]);
                });
                if (!pair) return; // 没有可用同桌了
                currentSeats[pair[0]] = idA;
                currentSeats[pair[1]] = idB;
                placedIds.add(idA);
                placedIds.add(idB);
                occupiedSeats.add(pair[0]);
                occupiedSeats.add(pair[1]);
            });

            // ==================== 第二步：按模式分配剩余座位 ====================

            if (mode === 'random') {
                // 完全随机：剩余学生打乱后填入剩余座位
                const remainingSeats = neededIndices.filter(idx => !occupiedSeats.has(idx));
                const remainingStudents = students.filter(s => !placedIds.has(s.id));
                shuffle(remainingStudents);
                placeStudentsInSeats(remainingSeats, remainingStudents);
            } else {

            // mixed / samegender 模式
            // 过滤出尚未占用的同桌 pair
            const remainingPairs = availablePairs.filter(p => !occupiedSeats.has(p[0]) && !occupiedSeats.has(p[1]));

            if (mode === 'mixed') {
                // 男女同桌：优先在剩余 pairs 中放一男一女
                const pool = { M: [], F: [], X: [] };
                shuffle(students.filter(s => !placedIds.has(s.id))).forEach(function (s) {
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
                            // 尝试交换：把 female 放回去，取下一个
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
                            currentSeats[pair[0]] = male.id;
                            currentSeats[pair[1]] = female.id;
                        } else {
                            currentSeats[pair[0]] = female.id;
                            currentSeats[pair[1]] = male.id;
                        }
                        placedIds.add(male.id);
                        placedIds.add(female.id);
                        occupiedSeats.add(pair[0]);
                        occupiedSeats.add(pair[1]);
                    }
                });

                // 收集尚未放置的座位和学生
                const remainingSeats = neededIndices.filter(idx => !occupiedSeats.has(idx));
                const remainingStudents = students.filter(s => !placedIds.has(s.id));
                shuffle(remainingStudents);
                placeStudentsInSeats(remainingSeats, remainingStudents);

            } else if (mode === 'samegender') {
                // 男女不同桌：每对 pair 放同性别
                const mPool = shuffle(students.filter(s => !placedIds.has(s.id) && getGender(s) === 'M'));
                const fPool = shuffle(students.filter(s => !placedIds.has(s.id) && getGender(s) === 'F'));
                const xPool = shuffle(students.filter(s => !placedIds.has(s.id) && getGender(s) === 'X'));
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
                        currentSeats[pair[0]] = m1.id;
                        currentSeats[pair[1]] = m2.id;
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
                        currentSeats[pair[0]] = f1.id;
                        currentSeats[pair[1]] = f2.id;
                        placedIds.add(f1.id); placedIds.add(f2.id);
                        occupiedSeats.add(pair[0]); occupiedSeats.add(pair[1]);
                    }
                });

                // 收集剩余座位和剩余学生
                const remainingSeats = neededIndices.filter(idx => !occupiedSeats.has(idx));
                const remainingStudents = students.filter(s => !placedIds.has(s.id));
                shuffle(remainingStudents);
                placeStudentsInSeats(remainingSeats, remainingStudents);
            }
            } // end else (mixed / samegender)

            // ==================== 后处理：确保每位学生都不在原来的座位 ====================
            // 收集哪些座位属于强制配对学生（不能被交换破坏）
            var forcedPairStudentIds = new Set();
            forcedPairs.forEach(function (fp) {
                forcedPairStudentIds.add(fp[0]);
                forcedPairStudentIds.add(fp[1]);
            });

            // 找出所有仍在原座位的学生（冲突）
            function findConflicts() {
                var conflicts = [];
                for (var i = 0; i < currentSeats.length; i++) {
                    if (currentSeats[i] && prevSeatMap[currentSeats[i]] === i) {
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
                // 交换后：studentBId 在 seatA，studentAId 在 seatB
                // 检查 seatA 的同桌
                if (mateA != null && currentSeats[mateA] && currentSeats[mateA] !== studentAId && currentSeats[mateA] !== studentBId) {
                    if (isAvoided(studentBId, currentSeats[mateA])) return true;
                }
                // 检查 seatB 的同桌
                if (mateB != null && currentSeats[mateB] && currentSeats[mateB] !== studentAId && currentSeats[mateB] !== studentBId) {
                    if (isAvoided(studentAId, currentSeats[mateB])) return true;
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
                var conflictId = currentSeats[ci];

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
                    var swapId = currentSeats[si];
                    if (!swapId) continue; // 空座位不交换
                    if (forcedPairStudentIds.has(swapId)) continue; // 强制配对学生不交换

                    // 交换后：conflictId → si, swapId → ci
                    // 条件1: si 不是 conflictId 的旧座位
                    if (wasOldSeat(conflictId, si)) continue;
                    // 条件2: ci 不是 swapId 的旧座位（避免给 swapId 制造新冲突）
                    if (wasOldSeat(swapId, ci)) continue;
                    // 条件3: 不产生回避配对
                    if (swapCreatesAvoidPair(ci, conflictId, si, swapId)) continue;

                    // 执行交换
                    currentSeats[ci] = swapId;
                    currentSeats[si] = conflictId;
                    resolved = true;
                    break;
                }

                if (!resolved) {
                    // 尝试与空座位交换（如果有空座位的话）
                    for (var si of shuffledNeeded) {
                        if (si === ci) continue;
                        if (currentSeats[si]) continue; // 只找空座位
                        if (wasOldSeat(conflictId, si)) continue;
                        // 移到空座位
                        currentSeats[si] = conflictId;
                        currentSeats[ci] = null;
                        resolved = true;
                        break;
                    }
                }

                // 重新计算冲突
                conflicts = findConflicts();
            }

            commit({ seats: currentSeats });
            generateSeats();
        }

        // 重置座位
        document.getElementById('resetBtn').addEventListener('click', function () {
            if (confirm('确定要重置所有座位吗？')) {
                pushSnapshot();
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
                alert('行数和列数必须在1-20之间！');
                return;
            }

            // 检查是否存在因列数缩减而失效的走道
            const invalidAisles = aisles.filter(a => a.afterCol >= newCols);
            if (invalidAisles.length > 0) {
                if (!confirm(`列数缩减将导致 ${invalidAisles.length} 个走道被移除（位于第 ${invalidAisles.map(a => a.afterCol).join('、')} 列后），是否继续？`)) {
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
            if (confirm('确定要清除所有数据吗？此操作不可撤销！')) {
                localStorage.removeItem('classroomConfig');
                localStorage.removeItem(CONFIGS_KEY);
                localStorage.removeItem(ACTIVE_CONFIG_KEY);
                students = [];
                groups = [];
                rows = 7;
                cols = 7;
                rowsInput.value = 7;
                colsInput.value = 7;
                currentSeats = Array(rows * cols).fill(null);
                isTeacherView = false;
                aisles = [];
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
                alert('所有数据已清除！');
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
                if (!confirm('确定删除配置「' + name + '」吗？')) return;
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
            if (configs[newName]) { alert('该名称已存在！'); return; }
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
        const githubStatus = document.getElementById('githubStatus');
        const githubSaveSettingsBtn = document.getElementById('githubSaveSettingsBtn');
        const githubTestBtn = document.getElementById('githubTestBtn');
        const githubSyncUpBtn = document.getElementById('githubSyncUpBtn');
        const githubSyncDownBtn = document.getElementById('githubSyncDownBtn');

        (function loadGithubSettings() {
            try {
                const s = JSON.parse(localStorage.getItem(GITHUB_SETTINGS_KEY));
                if (s) {
                    githubOwner.value = s.owner || '';
                    githubRepo.value = s.repo || '';
                    githubPath.value = s.path || 'data/seats-configs.json';
                }
                // Token 只存 sessionStorage（随标签页关闭清除，不持久落盘）— P0-d 安全修复
                const token = sessionStorage.getItem(GITHUB_TOKEN_KEY);
                if (token) githubToken.value = token;
            } catch {}
        })();

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
            const encodedContent = btoa(unescape(encodeURIComponent(content)));

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

            githubApiRequest('GET', `/contents/${s.path}`)
                .then(res => res.json())
                .then(data => {
                    if (!data.content) throw new Error('文件内容为空');
                    const decoded = decodeURIComponent(escape(atob(data.content)));
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
                        cloudWins = confirm(
                            '检测到 ' + collisions.length + ' 个配置在云端与本地同名但内容不同：\n' +
                            collisions.join('、') + '\n\n' +
                            '点「确定」：用云端版本覆盖这些同名配置（本地修改将被覆盖）\n' +
                            '点「取消」：保留本地版本，仅合并云端独有的新配置'
                        );
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
                    rows = config.rows || 7;
                    cols = config.cols || 7;
                    currentSeats = config.seats || Array(rows * cols).fill(null);
                    isTeacherView = config.viewMode === 'teacher';
                    aisles = config.aisles || [];
                    showStudentIcons = config.showStudentIcons !== false;
                    forcedPairs = config.forcedPairs || [];
                    avoidPairs = config.avoidPairs || [];
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
                    rows = 7;
                    cols = 7;
                    currentSeats = Array(rows * cols).fill(null);
                    isTeacherView = false;
                    aisles = [];
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
                    alert('检测到本地存储数据损坏，已重置为默认配置。');
                }
            } else {
                // 新用户首次进入：无配置文件、无分组、无学生，渲染新增分组与新增学生输入行
                updateAisleDisplay();
                updateGroupDisplay();
                updateStudentAssignmentDisplay();
            }

            state.viewMode = isTeacherView ? 'teacher' : 'student';
            commit({
                students: students, groups: groups, rows: rows, cols: cols,
                seats: currentSeats, aisles: aisles, viewMode: state.viewMode,
                showStudentIcons: showStudentIcons,
                forcedPairs: forcedPairs, avoidPairs: avoidPairs
            });
            generateSeats();
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
                    alert('配置导入成功！');
                } catch (error) {
                    console.error('导入配置失败:', error);
                    alert('导入配置失败: ' + error.message);
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

            // 在标题后追加当前日期（仅打印时显示）
            let dateLabel = document.getElementById('printDateLabel');
            if (!dateLabel) {
                dateLabel = document.createElement('span');
                dateLabel.id = 'printDateLabel';
                dateLabel.style.cssText = 'font-size:0.7em;font-weight:normal;color:#666;margin-left:12px;';
                pageTitle.appendChild(dateLabel);
            }
            const now = new Date();
            const dateStr = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
            dateLabel.textContent = dateStr;

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
            // 移除打印日期标签
            const dateLabel = document.getElementById('printDateLabel');
            if (dateLabel) dateLabel.remove();
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

        printBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            const dropdown = document.getElementById('printDropdown');
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });

        // 下拉菜单项点击
        document.addEventListener('click', function (e) {
            const item = e.target.closest('.print-dropdown-item');
            if (item) {
                const action = item.getAttribute('data-action');
                // 关闭所有下拉菜单
                document.getElementById('printDropdown').style.display = 'none';
                document.getElementById('randomDropdown').style.display = 'none';

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
                // randomDropdown 动作
                else if (action === 'random' || action === 'mixed' || action === 'samegender') {
                    randomSeatArrange(action);
                }
                return;
            }
            // 点击外部关闭所有下拉菜单
            const printDd = document.getElementById('printDropdown');
            const randDd = document.getElementById('randomDropdown');
            if (printDd && !printDd.contains(e.target) && !printBtn.contains(e.target)) {
                printDd.style.display = 'none';
            }
            if (randDd && !randDd.contains(e.target) && !randomBtn.contains(e.target)) {
                randDd.style.display = 'none';
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
                        pushSnapshot();
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
                pushSnapshot();
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
                    if (student && confirm('确定要删除学生 ' + student.name + ' 吗？')) {
                        pushSnapshot();
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

            if (!isTouchDevice) return;
            if (!seat) return;

            const seatIndex = parseInt(seat.getAttribute('data-index'));
            if (Number.isNaN(seatIndex)) return;

            const seatStudentId = seat.getAttribute('data-student');

            // 如果有选中的学生（来自学生名单），将其放入此座位
            if (tapSelectedStudentId !== null) {
                pushSnapshot();
                const existingIdx = currentSeats.indexOf(tapSelectedStudentId);
                if (existingIdx >= 0) currentSeats[existingIdx] = null;
                const targetId = currentSeats[seatIndex];
                if (existingIdx >= 0 && targetId) {
                    currentSeats[existingIdx] = targetId;
                }
                currentSeats[seatIndex] = tapSelectedStudentId;
                clearTapSelection();
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

                pushSnapshot();

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
                        if (student && confirm('确定要删除学生 ' + student.name + ' 吗？')) {
                            pushSnapshot();
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

        // ==================== 批量操作 ====================

        function updateBatchGroupOptions() {
            batchGroupSelect.innerHTML = '<option value="">选择分组...</option>' +
                groups.map(g =>
                    '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</option>'
                ).join('');
        }

        function updateBatchCount() {
            batchCountEl.textContent = '已选 ' + batchSelectedIds.size;
        }

        function enterBatchMode() {
            isBatchMode = true;
            state.isBatchMode = true;
            commit({ isBatchMode: true });
            batchToolbar.classList.add('visible');
            batchModeBtn.textContent = '退出批量';
            updateBatchGroupOptions();
            updateStudentAssignmentDisplay();
            updateBatchCount();
        }

        function exitBatchMode() {
            isBatchMode = false;
            state.isBatchMode = false;
            commit({ isBatchMode: false });
            batchToolbar.classList.remove('visible');
            batchModeBtn.textContent = '批量操作';
            batchSelectedIds.clear();
            updateStudentAssignmentDisplay();
            updateBatchCount();
        }

        batchModeBtn.addEventListener('click', function () {
            if (isBatchMode) exitBatchMode();
            else enterBatchMode();
        });

        batchCancelBtn.addEventListener('click', exitBatchMode);

        // 点击学生项（批量模式下的多选，作用于分配学生区域）
        studentGroupSelector.addEventListener('click', function (e) {
            if (!isBatchMode) return;
            const item = e.target.closest('.student-group-item');
            if (!item) return;
            const studentId = item.getAttribute('data-student-id');
            if (!studentId) return;
            // 如果点的是输入框、下拉框或新增行，不处理
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;

            if (batchSelectedIds.has(studentId)) {
                batchSelectedIds.delete(studentId);
                item.classList.remove('batch-selected');
            } else {
                batchSelectedIds.add(studentId);
                item.classList.add('batch-selected');
            }
            // 同步 checkbox
            const cb = item.querySelector('.batch-checkbox');
            if (cb) cb.checked = batchSelectedIds.has(studentId);
            updateBatchCount();
        });

        // checkbox 直接点击（作用于分配学生区域）
        studentGroupSelector.addEventListener('change', function (e) {
            if (!isBatchMode) return;
            if (!e.target.classList.contains('batch-checkbox')) return;
            const item = e.target.closest('.student-group-item');
            const studentId = item.getAttribute('data-student-id');
            if (e.target.checked) {
                batchSelectedIds.add(studentId);
                item.classList.add('batch-selected');
            } else {
                batchSelectedIds.delete(studentId);
                item.classList.remove('batch-selected');
            }
            updateBatchCount();
        });

        batchSelectAllBtn.addEventListener('click', function () {
            if (batchSelectedIds.size === students.length) {
                batchSelectedIds.clear();
            } else {
                students.forEach(s => batchSelectedIds.add(s.id));
            }
            // 更新 UI
            studentGroupSelector.querySelectorAll('.student-group-item').forEach(item => {
                const id = item.getAttribute('data-student-id');
                if (!id) return;
                const cb = item.querySelector('.batch-checkbox');
                if (batchSelectedIds.has(id)) {
                    item.classList.add('batch-selected');
                    if (cb) cb.checked = true;
                } else {
                    item.classList.remove('batch-selected');
                    if (cb) cb.checked = false;
                }
            });
            updateBatchCount();
        });

        batchAssignBtn.addEventListener('click', function () {
            if (batchSelectedIds.size === 0) {
                alert('请先选择学生');
                return;
            }
            const groupId = batchGroupSelect.value;
            if (!groupId) {
                alert('请选择要分配的分组');
                return;
            }
            pushSnapshot();
            batchSelectedIds.forEach(id => {
                const student = getStudentById(id);
                if (student) student.groupId = groupId;
            });
            generateSeats();
            updateStudentAssignmentDisplay();
            generateStudentList();
            autoSave();
        });

        batchDeleteBtn.addEventListener('click', function () {
            if (batchSelectedIds.size === 0) {
                alert('请先选择学生');
                return;
            }
            if (confirm('确定要删除选中的 ' + batchSelectedIds.size + ' 名学生吗？')) {
                pushSnapshot();
                const idSet = new Set(batchSelectedIds);
                currentSeats = currentSeats.map(id => idSet.has(id) ? null : id);
                students = students.filter(s => !idSet.has(s.id));
                batchSelectedIds.clear();
                commit({ seats: currentSeats, students: students, batchSelectedIds: batchSelectedIds });
                exitBatchMode();
                generateSeats();
                updateStudentAssignmentDisplay();
                generateStudentList();
                autoSave();
            }
        });

        // 快速随机入座：将所有未安排座位的学生随机分配到空座位
        quickRandomBtn.addEventListener('click', function () {
            const unassigned = getUnassignedStudents();
            if (unassigned.length === 0) {
                alert('所有学生都已安排座位');
                return;
            }
            const emptyIndices = [];
            for (let i = 0; i < currentSeats.length; i++) {
                if (currentSeats[i] === null) emptyIndices.push(i);
            }
            if (emptyIndices.length === 0) {
                alert('没有空座位可分配');
                return;
            }
            if (confirm('确定要将 ' + unassigned.length + ' 名未安排的学生随机入座吗？')) {
                pushSnapshot();
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

        // 签到模式按钮
        const checkinModeBtn = document.getElementById('checkinModeBtn');
        if (checkinModeBtn) {
            checkinModeBtn.addEventListener('click', toggleCheckinMode);
        }

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

        // 签到模式按钮的 active 状态同步
        function updateCheckinModeButton() {
            const btn = document.getElementById('checkinModeBtn');
            if (!btn) return;
            const icon = btn.querySelector('.action-icon');
            const text = btn.querySelector('span:last-child');
            if (isCheckinMode) {
                btn.classList.add('active');
                if (icon) icon.textContent = '✕';
                if (text) text.textContent = '退出签到';
            } else {
                btn.classList.remove('active');
                if (icon) icon.textContent = '✓';
                if (text) text.textContent = '签到模式';
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

    })();
