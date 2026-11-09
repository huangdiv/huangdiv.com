# 项目长期约定 — huangdiv.com 座位表

> 项目 = Hugo 静态博客 + `static/seats-generator.html`(纯前端座位表工具)。
> **完整经验 / 排障 / 发版记录见 `.workbuddy/ARCHIVE.md`**，新会话优先读它；本文件只留「必须立刻知道」的约定。

## 仓库 / git
- 唯一开发目录 = 提交仓库 `C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3`(健康独立 `.git`)；远程 `https://github.com/huangdiv/huangdiv.com.git`(org `huangdiv`，公开仓)，`.workbuddy/` 已入库便于云端续开发。
- 行尾混合 CRLF/LF，本地 `core.autocrlf input`，勿改 `true`。
- **Agent 沙箱会吞掉 git.exe 的 ref 写入**(fetch/push/commit 等 rc=0 却不落盘)；写 ref 的操作尽量在用户自己终端跑。沙箱内只信 `git ls-remote` + `.git/packed-refs`(持久锚)，同步 ref 必须写 40-hex 全量 hash。
- **代理挡住 github.com 的 git 端点时**(CONNECT 502 但 api.github.com 可通)：用 GitHub Git Data API 复现 blob/tree/commit，**核对每个 SHA 与本地一致后**再 PATCH `/git/refs/heads/master`；方法见 ARCHIVE §2.2.1。
- 并行会话可能改同一仓 ⇒ push 前先看分叉；non-fast-forward 用 `reset --soft`，不要 rebase。

## 测试 / 发版
- 单测 `bash .workbuddy/run_unit_tests.sh`(Node ESM，`static/tests/unit_*.mjs`)；冒烟 Playwright `.workbuddy/smoke_test_batch*.py`，先在 `static/` 起 `python -m http.server 8123 --bind 127.0.0.1`(URL 用 127.0.0.1，别用 localhost)；服务跑久会半挂 ⇒ 重启。
- **写完新测试必须回退验证**：临时改回旧写法确认会变红，再还原。
- 改版本号 = **四处同步**：`migrate.js#APP_VERSION`、`seats-generator.js#APP_VERSION`、HTML 入口 `?v=`、两个静态兜底 span(`unit_version_sync` 钉死)；**另外还要单独搜 `.workbuddy/smoke_test_*.py` 里的硬编码版本断言**(全局 Grep 会跳过隐藏目录)。Pages `.js` 有 `max-age=600` + Cloudflare ⇒ 漏改 `?v=` 用户 10 分钟看不到新代码。
- 判断线上是否发布：带随机查询串 curl 抓 JS 看 `APP_VERSION`，别信普通刷新。
- 本地预览暴露 `window.__seatsTest`(rotateGroupSeats / randomSeatArrange)；`?debug=1` 暴露 `window.__undoTest`。

## 架构
- 主 IIFE `static/seats-generator.js` + 纯函数模块 `static/modules/`(state / migrate / seat-grid / dragdrop / random-arrange / messages / csv-export / student-rank / group-balance / group-layout / zone / pair-links)。
- 状态变更走 `commit(patch)`，渲染 / 自动保存订阅 bus；**seats 必须就地赋值** `currentSeats[i] = x`，勿整体重赋值(会断别名)。
- `seat-grid` 持久化节点 + `computeStructureKey()` 决定全量重建 / per-seat diff；座位内按钮一律事件委托。
- 派生 UI 刷新出口 = `afterSeatsRender()` + `initialize()` 末尾兜底，**别只挂在「打开弹窗」回调里**。

## 功能语义要点(细节见 ARCHIVE §3)
- `students[i].rank` = 序号 1..N，无手工编辑入口，由导入决定；**导入 = 按姓名增量合并**(空值不覆盖、标签取并集、文件里没出现的学生连座位签到一起保留)。
- 凡是「给学生看名单」的地方按 rank 升序(座位 CSV 例外)；配对 / 区域的学生选择框为自绘候选(`.pair-suggest`)，`mousedown + preventDefault` 防丢焦点。
- 「按排名均衡分组」= `student-rank.js#planBalancedGroupAssignment`(蛇形分批 + 批内性别/班委最优排列)；**v1.4.9 起人数不整除时余下 r 人固定按组号倒序划归**：前面的组恒 `floor(N/G)` 人，只有最后 r 组多 1 人，与批次奇偶解耦(见 ARCHIVE §3.15)。「均衡系数」= 排名 0.6 + 性别 0.2 + 班委 0.2，排名维度必须用**排名带覆盖度**(「组均值 vs 全班均值」会假满分)。
- **按组聚座 = `group-layout.js`(v1.4.8 起按每组人数各自取最紧凑矩形)**：主目标最小化「占用行数 + 列数」，其次空位 / 面积，同等优先更窄 ⇒ 6 人得 `3行×2列`；逐组在全表搜索不与已占座位冲突的最佳落点(左上优先)，`blocked` 跳过，极端情况补位 / 退化连续排。主 IIFE `arrangeSeatsByGroup()` 先清出待移动学生(未分组锁定) → 规划 → 就地写回。
- 九宫格区域设置 `zonePref/zoneAvoid` 是**软约束**(`optimizeZones` 只做有人↔有人交换)，硬约束(配对 / 性别 / 旧座位)优先。
- 折叠面板「布局设置」= 旧「座位设置」(id 仍是 `seatSettings`)；行内删除叉号统一 `--icon-remove-size` 18px；三个快捷按钮两段式 `.action-btn-split`，下拉互斥走 `allDropdownCtrls` 登记表。
- 菜单徽标 `配对设置 [N强/N避]` / `区域设置 [N]` 必须在渲染出口刷新，0 组时不出现 `[]`。
- 配对关联线：一人只能一组强制同桌(**UI 校验 + migrate 清洗必须成对做**)；SVG 图层 `pointer-events:none` 且作 `.classroom` 首个 absolute 子节点，几何上避开所有座位矩形；**两类线都不带箭头**；同桌线全班固定同侧(`decideDeskmateSide`，不得用 `index%2`)；打印隐藏、导出图片克隆后剔除图层。开关文案「配对关联线」。
