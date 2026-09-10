// modules/messages.js
// ─────────────────────────────────────────────────────────────────────────────
// 用户可见文案集中层(i18n 雏形)。
//
// 职责:把所有 alert / confirm / toast 出现的字符串集中到一个对象,方便:
//   1. 后续接入 i18n 框架时,只需替换 MESSAGES 的实现 / 提供多语言变体
//   2. 改动措辞时不必满 IIFE grep
//   3. 单测可直接断言 MESSAGES.CONFIRM_DELETE_STUDENT('张三') 的输出格式
//
// 设计要点:
//   - 函数式参数化:`CONFIRM_DELETE_STUDENT: (name) => \`确定要删除学生 ${name} 吗？\``,
//     比 `{name}` 占位符更类型安全(传 undefined 立即暴露)
//   - 常量字符串直接是字面量
//   - 仅放用户可见文案;内部 debug 日志不进此处
//
// 当前语言:zh-CN。后续接 i18n 时,本文件可改造为:
//   `export const MESSAGES = (lang === 'en' ? EN : ZH);`
// ─────────────────────────────────────────────────────────────────────────────

export const MESSAGES = {
    // —— 走道 ——
    AISLE_COL_RANGE: (cols) => `列数必须在1到${cols - 1}之间！`,
    AISLE_EXISTS: '该位置已存在走道！',

    // —— 分组 ——
    GROUP_NAME_REQUIRED: '请输入分组名称',
    GROUP_NAME_EXISTS: '分组名称已存在',
    CONFIRM_DELETE_GROUP: '确定要删除这个分组吗？该分组的学生将变为未分组状态。',

    // —— 学生 ——
    STUDENT_NAME_REQUIRED: '请输入学生姓名',
    STUDENT_NAME_EXISTS_NEW: '该学生已存在',
    STUDENT_NAME_EXISTS_EDIT: '该姓名已存在',
    CONFIRM_DELETE_STUDENT: (name) => `确定要删除学生 ${name} 吗？`,
    STUDENT_ALREADY_SEATED: (name) => `学生 ${name} 已经被安排座位了！`,

    // —— 配对 ——
    PAIR_SELECT_TWO_DIFFERENT: '请选择两位不同的学生',
    PAIR_ALREADY_EXISTS: '该配对已存在',

    // —— 导出 ——
    EXPORT_FAILED: '导出图片失败，请重试！',

    // —— 座位重置 / 行列 ——
    CONFIRM_RESET_SEATS: '确定要重置所有座位吗？',
    ROW_COL_RANGE: '行数和列数必须在1-20之间！',
    CONFIRM_REDUCE_AISLES: (count, cols) =>
        `列数缩减将导致 ${count} 个走道被移除（位于第 ${cols.join('、')} 列后），是否继续？`,

    // —— 全部清除 ——
    CONFIRM_CLEAR_ALL: '确定要清除所有数据吗？此操作不可撤销！',
    ALL_DATA_CLEARED: '所有数据已清除！',

    // —— 配置管理 ——
    CONFIRM_DELETE_CONFIG: (name) => `确定删除配置「${name}」吗？`,
    CONFIG_NAME_EXISTS: '该名称已存在！',

    // —— GitHub 同步 ——
    CONFIRM_CLOUD_WINS: (count, names) =>
        `检测到 ${count} 个配置在云端与本地同名但内容不同：\n` +
        `${names.join('、')}\n\n` +
        `点「确定」：用云端版本覆盖这些同名配置（本地修改将被覆盖）\n` +
        `点「取消」：保留本地版本，仅合并云端独有的新配置`,

    // —— 存储 / 导入 ——
    STORAGE_CORRUPT: '检测到本地存储数据损坏，已重置为默认配置。',
    IMPORT_SUCCESS: '配置导入成功！',
    IMPORT_FAILED: (error) => `导入配置失败: ${error}`,

    // —— 批量 ——
    BATCH_SELECT_STUDENTS_FIRST: '请先选择学生',
    BATCH_SELECT_GROUP_FIRST: '请选择要分配的分组',
    CONFIRM_BATCH_DELETE: (count) => `确定要删除选中的 ${count} 名学生吗？`,
    ALL_STUDENTS_SEATED: '所有学生都已安排座位',
    NO_EMPTY_SEATS: '没有空座位可分配',
    GROUP_MODE_NO_SELECTION: '请先在座位表中点击选择学生',
    GROUP_MODE_NEW_NAME: '请输入新分组名称：',
    CONFIRM_QUICK_RANDOM: (count) => `确定要将 ${count} 名未安排的学生随机入座吗？`,

    // —— 随机排座 ——
    NO_STUDENTS_YET: '请先导入学生名单！',
    NO_STUDENTS_YET_WARN: '请先导入学生名单',
    CONFIRM_RANDOM_MODE: (mode) => {
        const labels = {
            random: '完全随机',
            mixed: '男女同桌',
            samegender: '男女不同桌'
        };
        return `确定要执行「${labels[mode] || mode}」排座吗？`;
    },
    RANDOM_WARNING_INCOMPLETE_SWAP: (count, attempts) =>
        `未能完全保证换位:仍 ${count} 名学生在原座位(超过 ${attempts} 次尝试)`,
    RANDOM_WARNING_NOT_SEATED: (count) => `${count} 名学生未入座(座位不足)`,

    // —— 分组轮换 ——
    ROTATE_NO_GROUPS: '请先创建至少 2 个分组,再进行分组轮换！',
    ROTATE_NO_GROUPS_WARN: '至少需要 2 个分组才能轮换',
    ROTATE_NO_SEATED: '当前没有已安排座位的分组学生,无法轮换！',
    ROTATE_NO_SEATED_WARN: '没有已入座的分组学生',
    CONFIRM_ROTATE: (offset, n) =>
        `确定要将各分组轮换到往下第 ${offset} 组吗？(共 ${n} 个分组)`,
    ROTATE_DONE: (offset, moved) =>
        `分组轮换完成(步长 +${offset},移动 ${moved} 人)`,
    ROTATE_BAD_OFFSET: (n) => `轮换步长需为 1 ~ ${n - 1} 之间的整数`,
    // 轮换溢出:源组人数 > 目标组座位数,多出来的人改归「占了其原座位的上游组」
    ROTATE_OVERFLOW_REGROUP: (count, fromName, toName) =>
        `${count} 名学生未能轮换(目标组座位不足),已自动改归「${toName}」(原「${fromName}」)`,

    // —— 性别规则(男女同桌 / 男女不同桌)——
    GENDER_RULE_LABEL: (mode) => (mode === 'mixed' ? '男女同桌' : '男女不同桌'),
    // 小组轮换后,受「只能在同组座位区内调整」约束,仍有若干桌未达成
    GENDER_RULE_PARTIAL: (mode, count) =>
        `小组轮换后仍有 ${count} 桌未达成「${mode === 'mixed' ? '男女同桌' : '男女不同桌'}」` +
        `(受小组座位区限制,无法进一步调整)`,
    // 随机排座后仍有若干桌未达成(多为男女比例为奇数等数学上做不到的情形)
    GENDER_RULE_UNSATISFIED: (mode, count) =>
        `已安排座位,但仍有 ${count} 桌未达成「${mode === 'mixed' ? '男女同桌' : '男女不同桌'}」` +
        `(受男女生人数比例限制,无法进一步调整)`,

    // —— 配对设置满足情况 ——
    PAIR_UNSATISFIED: (forcedCount, avoidCount) => {
        const parts = [];
        if (forcedCount > 0) parts.push(`${forcedCount} 对强制同桌未能安排在一起`);
        if (avoidCount > 0) parts.push(`${avoidCount} 对回避同桌未能分开`);
        return `已安排座位,但配对设置未能完全满足:${parts.join('；')}`;
    }
};