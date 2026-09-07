// =====================================================================
// modules/migrate.js
//
// 配置迁移器(向后兼容)— 把任意旧版本/异常 JSON 配置规整成 v1.3.1+ 标准 schema。
//
// 设计要点:
//   - 纯函数:无副作用,只 mutate 入参对象然后返回;调用方可以安全地用 const 引用
//   - 容错优先:任意字段缺失/类型错误都补默认,不抛错
//   - 可测试:导出 migrateConfig,可被 Node ESM 直接 import 跑单测
//
// 处理链(每一步都可能跳过):
//   1. 极旧格式 students: string[] → {id,name,...} 对象数组
//   2. students 缺 id → 生成 id
//   3. students.id 去重(碰撞时重新生成)
//   4. groups 缺 id → 生成 id
//   5. seats 中的旧姓名引用 → 转换为 id
//   6. students[i] 补 checkedIn/gender/tags 默认
//   7. groups 顶层补 groups/seats/rows/cols/aisles/showStudentIcons/viewMode/title
//   8. aisles[i].afterCol 范围钳制 [0, cols-1]
//   9. version 升级到 APP_VERSION
//
// 调用方:seats-generator.js 三个载入点(本地初始化/导入 JSON/GitHub 同步下载)。
// =====================================================================

// === 常量 ===
export const DEFAULT_ROWS = 8;
export const DEFAULT_COLS = 8;
export const APP_VERSION = '1.3.1';

// === 工具 ===
function generateId(prefix) {
    prefix = prefix || 'g';
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

// === 主函数 ===
export function migrateConfig(config) {
    if (!config) return config;
    if (typeof config !== 'object') return config;

    // ─── 1. 极旧格式:students 是字符串数组 ───
    if (Array.isArray(config.students) && config.students.length > 0 && typeof config.students[0] === 'string') {
        config.students = config.students.map(function (name) {
            return { id: generateId('s'), name: name, groupId: null, gender: '', tags: [], checkedIn: false };
        });
    }

    // ─── 2. students 缺 id → 生成 ───
    if (Array.isArray(config.students) && config.students.length > 0) {
        // 先过滤掉非对象元素(null/string/数字等)
        config.students = config.students.filter(function (s) {
            return s && typeof s === 'object';
        });

        config.students.forEach(function (s) {
            if (!s.id) s.id = generateId('s');
        });

        // ─── 3. students.id 去重(碰撞重新生成)───
        const seen = new Set();
        config.students.forEach(function (s) {
            let id = s.id;
            while (seen.has(id)) {
                id = generateId('s');
            }
            seen.add(id);
            s.id = id;
        });

        // ─── 4. students[i] 补 checkedIn/gender/tags 默认 ───
        config.students.forEach(function (s) {
            if (s.checkedIn == null) s.checkedIn = false;
            if (s.gender == null) s.gender = '';
            if (!Array.isArray(s.tags)) s.tags = [];
        });
    } else {
        // students 缺失、undefined、非数组、空数组 → 重置为 []
        config.students = [];
    }

    // ─── 5. groups 顶层默认 + groups[i].id 补全 ───
    if (!Array.isArray(config.groups)) {
        config.groups = [];
    } else {
        const seenG = new Set();
        config.groups.forEach(function (g) {
            if (!g || typeof g !== 'object') return;
            if (!g.id) g.id = generateId('g');
            let id = g.id;
            while (seenG.has(id)) {
                id = generateId('g');
            }
            seenG.add(id);
            g.id = id;
            if (typeof g.name !== 'string') g.name = '';
            if (typeof g.color !== 'string') g.color = '#4CAF50';
        });
    }

    // ─── 6. rows/cols 默认 + 钳制 ───
    let rows = parseInt(config.rows, 10);
    let cols = parseInt(config.cols, 10);
    if (!Number.isFinite(rows) || rows < 1 || rows > 50) rows = DEFAULT_ROWS;
    if (!Number.isFinite(cols) || cols < 1 || cols > 50) cols = DEFAULT_COLS;
    config.rows = rows;
    config.cols = cols;

    // ─── 7. seats 默认 + 长度矫正 ───
    const totalSeats = rows * cols;
    if (!Array.isArray(config.seats)) {
        config.seats = Array(totalSeats).fill(null);
    } else {
        // 长度不匹配 → 重置(保留有效 id 引用)
        if (config.seats.length !== totalSeats) {
            config.seats = Array(totalSeats).fill(null);
        }
    }

    // ─── 8. aisles 默认 + aisles[i].afterCol 范围钳制 ───
    if (!Array.isArray(config.aisles)) {
        config.aisles = [];
    } else {
        config.aisles = config.aisles.filter(function (a) {
            return a && typeof a === 'object' &&
                Number.isFinite(parseInt(a.afterCol, 10)) &&
                parseInt(a.afterCol, 10) >= 0 &&
                parseInt(a.afterCol, 10) < cols;
        }).map(function (a) {
            const width = parseInt(a.width, 10);
            return {
                afterCol: parseInt(a.afterCol, 10),
                width: Number.isFinite(width) && width > 0 && width <= 200 ? width : 50
            };
        });
    }

    // ─── 9. seats 中的旧姓名引用 → 转换为 id ───
    if (Array.isArray(config.students) && config.students.length > 0) {
        const idSet = new Set(config.students.map(function (s) { return s.id; }));
        const nameToId = new Map(config.students.map(function (s) { return [s.name, s.id]; }));
        config.seats = config.seats.map(function (seatVal) {
            if (seatVal == null) return null;
            if (idSet.has(seatVal)) return seatVal; // 已经是 ID
            return nameToId.get(seatVal) || null;   // 旧格式姓名 → ID
        });
    }

    // ─── 10. 配对约束默认 ───
    if (!Array.isArray(config.forcedPairs)) config.forcedPairs = [];
    if (!Array.isArray(config.avoidPairs)) config.avoidPairs = [];

    // ─── 11. v1.3.0 顶层字段默认 ───
    if (config.showStudentIcons === undefined) config.showStudentIcons = true;
    if (config.viewMode !== 'student' && config.viewMode !== 'teacher') config.viewMode = 'student';
    if (typeof config.title !== 'string' || !config.title.trim()) config.title = '班级座位表';

    // ─── 12. version 升级 ───
    config.version = APP_VERSION;

    return config;
}
