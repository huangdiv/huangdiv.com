// =====================================================================
// 模块: state.js —— 单一数据源 + 事件总线 (path-A0)
//
// 提供:
//   state      集中数据源对象 (students/groups/aisles/pairs/seats/视图模式)
//   bus        EventTarget 事件总线
//   commit()   浅合并修改 state 并派发 'change' 事件
//   subscribe() 订阅状态变化,返回取消订阅函数
//   selectors  派生选择器(常见访问模式)
//
// 迁移策略(渐进,path-A1/A2):
//   主文件顶部仍保留顶层 let 别名与 state 初始同引用,读路径透明;
//   后续逐步把 92 处写点接入 commit,完成 bus 驱动渲染 + 自动保存。
// =====================================================================

// === MODULE: state-center (path-A0) ==================================
//   引入集中数据源 state 对象 + 事件总线 bus。所有新建/改动的代码应通过
//   commit() 修改 state;监听者可订阅 bus 的 'change' 事件执行渲染、
//   自动保存等副作用。
//
//   迁移策略(后续 path-A1/A2/...):
//     1) 当前顶层 `let students = []` 等临时保留(单文件回归零成本)
//     2) 任何本轮新增或被改动的代码必须改走 state + commit
//     3) 后续轮次逐步把已有函数迁到 state;完成前不删除旧变量
//
//   为什么不一次性全替换:
//     此文件 7675 行、283 个函数,全量替换风险极高;集中迁移可在每个
//     编辑时零散完成,review 成本低,git blame 清晰。
// ====================================================================
export const state = {
    // —— 数据(与顶层 let 镜像) ——
    students: [],
    groups: [],
    aisles: [
        { afterCol: 2, width: 30 },
        { afterCol: 4, width: 30 },
        { afterCol: 6, width: 30 }
    ],
    forcedPairs: [],   // [[idA, idB], ...]
    avoidPairs: [],    // [[idA, idB], ...]

    // —— 座位表几何 ——
    rows: 8,
    cols: 8,
    seats: null,        // 长度 rows*cols,占座时为 studentId

    // —— 视图与模式 ——
    viewMode: 'student',     // 'student' | 'teacher'
    isCheckinMode: false,
    isGroupMode: false,     // 分组模式:座位表多选学生 → 批量分配到分组
    showStudentIcons: true,
    isTouchDevice: false,

    // —— 元信息 ——
    title: '班级座位表'
};

// 占用一个数组变量的运行时常驻空间(避免被 GC 回收时与顶层 seats 脱节)
if (!state.seats || state.seats.length !== state.rows * state.cols) {
    state.seats = Array(state.rows * state.cols).fill(null);
}

// —— 轻量事件总线 ——
export const bus = new EventTarget();

/**
 * 修改状态 + 派发 change 事件(浅合并)。
 * @param {Partial<typeof state>} patch
 */
export function commit(patch) {
    if (!patch) return;
    // 简单 deep-frozen guard:顶层浅合并;数组/集合引用会被同步替换
    for (const key of Object.keys(patch)) {
        state[key] = patch[key];
    }
    try {
        bus.dispatchEvent(new CustomEvent('change', { detail: patch }));
    } catch (e) {
        // CustomEvent 在某些老环境下可能失败,降级到 Event
        bus.dispatchEvent(new Event('change'));
    }
}

/**
 * 订阅状态变化。返回取消订阅函数。
 * @param {(event: {detail:object}) => void} listener
 */
export function subscribe(listener) {
    const handler = (e) => listener(e);
    bus.addEventListener('change', handler);
    return () => bus.removeEventListener('change', handler);
}

// —— 派生选择器(常见访问模式抽到这里,降低后续迁移成本) ——
export const selectors = {
    getStudentById: (id) => state.students.find(s => s.id === id),
    getGroupById: (gid) => state.groups.find(g => g.id === gid),
    getSeatRows: () => state.rows,
    getSeatCols: () => state.cols,
    getSeats: () => state.seats,
    getAssignedIds: () => new Set(state.seats.filter(s => s !== null)),
    getUnassignedStudents: () => {
        const assigned = selectors.getAssignedIds();
        return state.students.filter(s => !assigned.has(s.id));
    }
};

// —— 调试助手(可移除) ——
// 开发期挂一个订阅者把每一次 commit 详情打印出来,辅助迁移调试;
// 生产期可通过 query string `?dev=quiet` 关掉。
const __DEV__ = !/dev=quiet/.test(location.search);
if (__DEV__) {
    subscribe(function (e) {
        const keys = e.detail ? Object.keys(e.detail) : [];
        if (keys.length) console.debug('[commit]', keys, e.detail);
    });
}
