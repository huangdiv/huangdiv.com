// modules/csv-export.js
// ─────────────────────────────────────────────────────────────────────────────
// 座位表 CSV 导出 —— 纯函数,无 DOM 依赖 ⇒ 可直接被 Node 单测。
//
// 输出结构(3 行 × 3 列、学生视角为例):
//   讲台,,,
//   排\列,第1列,第2列,第3列
//   第1排,张三,,李四
//   第2排,王五,赵六,
//   第3排,,,
//
// 「当前视角」:teacher 视角与屏幕保持一致 —— 行、列都镜像(后排在上、右列在左),
//   讲台行移到末尾;但行/列标签仍写**真实坐标**,与座位角标「X排Y列」一致。
// ─────────────────────────────────────────────────────────────────────────────

/** UTF-8 BOM:Windows 版 Excel 打开无 BOM 的 UTF-8 CSV 会把中文显示成乱码 */
export const CSV_BOM = '\uFEFF';

/** 单值 → 合法 CSV 单元格(含逗号/引号/换行时加引号,内部引号翻倍) */
export function escapeCsvCell(value) {
    const s = value == null ? '' : String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** YYYY-MM-DD(本地时区;避免 toLocaleDateString 在文件名里带 `/`) */
export function formatDateStamp(date) {
    const d = date == null ? new Date() : (date instanceof Date ? date : new Date(date));
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 生成安全文件名:`<标题>_座位表_YYYY-MM-DD.csv`(替换 Windows 非法字符) */
export function buildSeatCsvFilename(title, date) {
    const base = String(title == null ? '' : title).trim() || '班级座位表';
    const safe = base.replace(/[\\/:*?"<>|]/g, '_');
    return safe + '_座位表_' + formatDateStamp(date) + '.csv';
}

function toStudentMap(students) {
    const map = new Map();
    if (students instanceof Map) {
        students.forEach(function (value, key) { map.set(key, value); });
        return map;
    }
    (students || []).forEach(function (s) {
        if (s && s.id != null) map.set(s.id, s);
    });
    return map;
}

/**
 * 生成「当前视角」下的座位表 CSV 文本(**不含 BOM**)。
 *
 * @param {object} opts
 * @param {number} opts.rows                 行数
 * @param {number} opts.cols                 列数
 * @param {Array<string|null>} opts.seats    学生视角 row-major:下标 = row*cols + col
 * @param {Array<{id:string,name:string}>|Map} opts.students
 * @param {'student'|'teacher'} [opts.viewMode='student'] 当前视角
 * @param {boolean} [opts.includeHeader=true]  是否输出列号表头
 * @param {boolean} [opts.includePodium=true]  是否输出「讲台」行
 * @param {string}  [opts.emptyLabel='']       空座位的占位文本
 * @returns {string} CRLF 分隔的 CSV
 */
export function buildSeatCsv(opts) {
    const o = opts || {};
    const rows = Math.max(0, Math.floor(Number(o.rows) || 0));
    const cols = Math.max(0, Math.floor(Number(o.cols) || 0));
    const seats = Array.isArray(o.seats) ? o.seats : [];
    const isTeacher = o.viewMode === 'teacher';
    const includeHeader = o.includeHeader !== false;
    const includePodium = o.includePodium !== false;
    const emptyLabel = o.emptyLabel == null ? '' : String(o.emptyLabel);
    const studentMap = toStudentMap(o.students);

    const lines = [];

    // 按「真实坐标」取名字 —— 视角只影响遍历顺序,不影响坐标含义
    function nameAt(actualRow, actualCol) {
        const id = seats[actualRow * cols + actualCol];
        if (!id) return emptyLabel;
        const student = studentMap.get(id);
        return student && student.name != null ? String(student.name) : '';
    }

    function podiumLine() {
        const cells = ['讲台'];
        for (let c = 0; c < cols; c++) cells.push('');
        return cells.map(escapeCsvCell).join(',');
    }

    // 学生视角:讲台在座位前(顶部);教师视角:讲台在座位后(底部)
    if (includePodium && !isTeacher) lines.push(podiumLine());

    if (includeHeader) {
        const header = ['排\\列'];
        for (let c = 0; c < cols; c++) {
            const actualCol = isTeacher ? cols - c : c + 1;
            header.push('第' + actualCol + '列');
        }
        lines.push(header.map(escapeCsvCell).join(','));
    }

    for (let r = 0; r < rows; r++) {
        // 教师视角:后排先显示(与屏幕上下镜像一致)
        const actualRow = isTeacher ? rows - 1 - r : r;
        const cells = ['第' + (actualRow + 1) + '排'];
        for (let c = 0; c < cols; c++) {
            // 教师视角:右列先显示
            const actualCol = isTeacher ? cols - 1 - c : c;
            cells.push(nameAt(actualRow, actualCol));
        }
        lines.push(cells.map(escapeCsvCell).join(','));
    }

    if (includePodium && isTeacher) lines.push(podiumLine());

    return lines.join('\r\n');
}
