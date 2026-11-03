# 项目长期约定 — huangdiv.com 座位表

> 项目 = huangdiv.com(Hugo 静态博客)+ `static/seats-generator.html`(纯前端班级座位表工具)。
> **完整经验归档见 `.workbuddy/ARCHIVE.md`**(2026-09-20 压缩沉淀,新会话优先读它)。

## 仓库布局(2026-09-20 更新:workspace 已转为健康独立仓库)
- **开发目录 = 提交仓库(唯一)**:`C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3`
  - ⚡ 2026-09-20 修复:原先损坏的 worktree 指针已换成健康 clone 的 `.git` 真目录
    ⇒ **`HEAD`=`master`=`origin/master`=`@{u}` 四者一致,status 干净,直接 `git add/commit/push`**
  - 绕行仓已隔离到 `C:/Users/xingz/WorkBuddy/_cleanup_backup_seats_2026-09-20/quarantine-workarounds-2026-09-20/`
    (含旧 `recover-huangdiv`/`recover-huangdiv2`/`_tmp_clone_huangdiv`/原主仓 `D:/Documents/GitHub/huangdiv.com`)
- 远程:`https://github.com/huangdiv/huangdiv.com.git`(org = `huangdiv`,不是 xingz-io)
  - **公开仓库**;`.workbuddy/` 已纳入 git(知识文档 + 全量冒烟测试),便于换机/云端续开发
  - 同仓库还有别的工具:`static/ClassMaster.html`(班级管家,其他会话开发)、`static/jumpto.html`
  - 提交基线:seats-generator 代码 = `fb4de80`(此后未改);master tip 以 `git log --oneline -1` 为准(勿写死)
- 行尾约定:workspace 文件为**混合 CRLF/LF**;已设本地 `git config core.autocrlf input`
  (检出不动、比较时把 CRLF 归一为 LF)以免出现大量假 `M`。勿改成 `true`(会让 LF 文件全变脏)

## 推送注意
- 存在**并行会话**改同一仓库 ⇒ push 前务必 `git fetch` + `git log --oneline origin/master` 看分叉
- 遇到 non-fast-forward:**不要 rebase**,用 `git fetch` + `git reset --soft origin/master`
- `git push origin master` 走 GCM,前台秒级完成(旧 wincred 后台 2h41m 经验已过时)
- **`origin/master` 不自动更新 = Agent 沙箱吞掉 git.exe 的 ref 写入,不是 git**(2026-09-20 二度精确化):
  沙箱内 `git update-ref` 返回 rc=0 但**文件不落盘**;而**同一沙箱内** bash `mkdir -p`+`printf`、Python 写文件
  **都能落盘** ⇒ 被吞的只是 **git.exe 写 ref** 那条路径(只读 git 命令不受影响);关闭沙箱后 git 一切正常。
  ⇒ 写 ref 的 git 操作(`fetch`/`push`/`commit`/`merge`/`rebase`/`worktree`)**不要在沙箱内跑**,
  用你自己的终端(或 Agent 内走沙箱放行 `dangerouslyDisableSandbox`)。详见 ARCHIVE §2.2
- **沙箱内兜底「双保险」**:① 同步 `.git/packed-refs`(**持久锚**,git 只在 gc/pack-refs 时重写它);
  ② 手写 loose ref `mkdir -p .git/refs/remotes/origin && printf '<40hex>\n' > .git/refs/remotes/origin/master`。
  ⚠️ 沙箱内的写 ref 的 git 操作会把 `.git/refs/remotes/origin/` **整个目录删掉** ⇒ **loose ref 易失、`packed-refs` 才是持久锚**;
  ⚠️ `dangerouslyDisableSandbox:true` **不保证被 grant**(实测有未生效) ⇒ 最可靠是在用户自己终端跑,Agent 内以 packed-refs 为准。
- **沙箱内纪律**:每个写 ref 的 git 操作后必须核对 `git rev-parse master origin/master` +
  `git ls-remote origin master`(`git rev-list --left-right --count origin/master...master` 期望 `0 0`),
  别信 `git status` 的 ahead/behind;必须写 40-hex 全量 hash

## 云端(WorkBuddy Cloud)续开发
- 仓库公开 + `.workbuddy/` 已入库 ⇒ 云端 `git clone https://github.com/huangdiv/huangdiv.com.git` 即拿到**全部上下文**
  (完整步骤见 `ARCHIVE.md` **§9**);进云端会话**先读 `ARCHIVE.md`**。
- 云端(Linux)可跑单测:`bash .workbuddy/run_unit_tests.sh`(2026-09-20 已**跨平台化**,不再依赖 Windows 盘符/`cygpath`)。
- 冒烟测试(Playwright)云端未必有 Chromium;push 到 `master` 自动部署(GitHub Actions → Pages → huangdiv.com/seats-generator.html)。
- **一次只在一端开发**(两端同改一个文件必冲突);电脑端收尾用 `git fetch` + `git merge --ff-only origin/master`(**在自己终端跑**)。
- 云端推送需 GitHub PAT(`repo` 权限),勿入库(`.env` 已在 `.gitignore`)。

## 测试约定
- 单元:`bash .workbuddy/run_unit_tests.sh`(Node ESM,`static/tests/unit_*.mjs`,共 11 文件)
- 冒烟:Playwright,`.workbuddy/smoke_test_batch*.py`,需先在 `static/` 起
  `python -m http.server 8123 --bind 127.0.0.1`
  (跑 15~25 分钟会半挂:curl 200 但 goto 超时 ⇒ 重启即可)
- URL 一律用 `127.0.0.1` 不用 `localhost`(后者可能解析到 ::1 导致挂起)
- **写完新测试必须回退验证**:临时改回 buggy 写法跑一遍确认测试会红,再改回来
- 本地预览(127.0.0.1/localhost)下暴露 `window.__seatsTest`
  (rotateGroupSeats / randomSeatArrange);`?debug=1` 下暴露 `window.__undoTest`

## 架构要点
- 主文件 `static/seats-generator.js`(IIFE);模块 `static/modules/`:
  state / migrate / seat-grid / dragdrop / random-arrange / messages / csv-export /
  student-rank / **group-balance** / **group-layout**
- 工厂模式:`createSeatGrid / createDragdrop / createRandomArrange`(deps 显式注入)
- state 变更走 `commit(patch)` 派发,渲染/自动保存订阅 bus
- `seat-grid.js` 持久化节点 + `computeStructureKey()` 决定全量重建 or per-seat diff
- 事件委托非妥协:座位/banner 内按钮全部委托 `#classroom` 或父容器

## 排名(rank)与导入语义(2026-11-02 定)
- `students[i].rank` = 学生序号 1..N,**无手工编辑入口**,由导入决定
  (勾「同时导入排名」按依据列+升/降序编号;不勾则按导入先后编号);migrate 给老配置补 1..N
- **导入 = 按姓名增量合并**(不是重建名单):只覆盖「导入且有值」的属性;空单元格不覆盖;
  标签取并集;文件里没出现的学生原样保留(座位/签到不动) ⇒ 重复导入不产生重复学生
- 座位 `.seat-rank` 右下角(10px,与 `.seat-number` 同字号),受「隐藏图标」开关统一控制;
  图标容量按 `--seat-width` 推算,超出部分**从后往前**不渲染
- `seat-grid` per-seat diff 依赖 `innerSignature()`(rank+gender+tags):
  studentId 没变但排名/标签变了也必须重绘
- 「按排名均衡分组」= `student-rank.js#planBalancedGroupAssignment`:rank 升序分批,
  批次 1..G 正序 / G..1 逆序交替,批内按 性别差²+班委数² 最优排列(n≤7 穷举);
  分组自动命名 `1组..N组` + `distinctColors` 配色,会重建全部分组(可撤销)
- 写回 seats **必须就地赋值**保持引用,勿 `state.seats = [...]` 重赋值(会断别名)

## 名单呈现 / 按组聚座 / 均衡系数(2026-11-02 第二次迭代)
- **凡是「给学生看名单」的地方一律按 rank 升序**:未入座名单(`getUnassignedStudents` 内部排)、
  详细设置栏、统计块→复制姓名/下载 Excel(`getStatContext` 出口统一 `slice().sort(compareByRank)`,
  并在 Excel 首列加「排名」)。座位 CSV 例外 —— 那是按座位视角,不做排名排序
- **配对设置的学生选择框 = 输入姓名搜索**(原生 `<datalist>` + `resolvePairStudent`):
  精确姓名优先,其次唯一片段(自动补全),多命中/无命中都 alert 且不添加;回车=添加
- **按组聚座** = `group-layout.js`:`chooseBlockShape` 选统一矩形块(代价=空位+形状+行数+余列,
  形状按「实际占用行列差」罚、超 2 重罚;代价相近优先更宽 ⇒ 6 人 6 组得 2×3),
  `planGroupSeatSlots` 块内 row-major 填座、跳过 blocked、铺不下退化顺序连续排;
  主 IIFE `arrangeSeatsByGroup()` 先清出待移动学生(未分组锁定)→ 规划 → 就地写回
- **均衡系数** = `group-balance.js`:排名 0.6 + 性别 0.2 + 班委 0.2(缺数据自动剔除并归一)。
  排名维度用**排名带覆盖度** `100·(1 - Σ|c_b - band/G|/(2k))`,**不要**用「组均值 vs 全班均值」
  (整块切分时中间组会假满分)。展示在:分组行徽标 / 分组设置顶部汇总 / 分组模式 banner

## UI 约定(2026-11-02 第三次迭代)
- **折叠面板「布局设置」就是原来的「座位设置」**(仅改名,v1.3.5 起);HTML 里 `data-target="seatSettings"`
  这个 id 沿用未改 —— 改 id 会牵动测试与 saved UI 状态,只改展示文案
- **行内删除/移除叉号统一为 `--icon-remove-size`(18px)**:透明底 + 圆形 hover 底 + `opacity .7→1`,
  走道列表 / 分组行 / 详细设置学生行三处共用;删除类保留 `--danger` 色,走道保留 `--primary`
- 这类「列表行内按钮」**不要用 26px 实心色块**:面板内分组行只有 ~142px 宽,操作区多吃 12px
  名称输入框就只剩 32px。新增行内按钮先量 `getBoundingClientRect` 再定尺寸

## 快捷操作区:三个按钮统一两段式(2026-11-03, v1.4.2)
- 模式切换 / 智能排座 / 打印PDF 结构一致 = `.action-btn-split` > 主按钮(`.action-btn-split-main`) + 箭头(`.action-btn-split-caret`)
- 模式切换上段 = `cycleMode()` 三态轮换;下段 `#modeDropdown` 直接选 `normal|checkin|group`(`applyMode`)
- 打印上段 = `doPrint()` 直接打印;下段 `#printDropdown` 只剩 导出图片 / 导出CSV(已删 `data-action="print"`)
- 下拉互斥 = `allDropdownCtrls` 登记表 + `closeAllDropdowns()`;点外部关闭也遍历登记表,
  **别再退回两两 peer 参数**(加第三个按钮必漏)
- 模式菜单选中态用「当前」文字胶囊,**不要用 ✓**(签到模式图标本身就是 ✓)
- 改这两个按钮的语义后,`batch16/18/23/e2e` 里的点击目标要跟着改(printBtn → printDropdownBtn)

## 九宫格区域设置(2026-11-02 第四次迭代)
- `student.zonePref` / `student.zoneAvoid` = 区域 id(`front-left`…`back-right`),`''` = 未设置;
  migrate 用 `zone.js#ZONE_IDS` 白名单清非法值
- 区域 = rows 三等分(前/中/后) × cols 三等分(左/中/右);`bandIndex`:total=1→中、total=2→前/后
- **软约束后处理**:`zone.js#optimizeZones` 只做「有人↔有人」等价交换(占座集合不变),
  代价 倾向未达成+2 / 避开命中+3,收益必须 >0 才换;最多 4 轮
- 接入点在 `random-arrange.js` 的 commit 之前、性别收尾修复之后;guard 依次查
  回避同桌 → 旧座位 → 性别规则 → 配对违规数不上升 ⇒ **硬约束优先,偏好让位**
- UI:智能排座下拉「区域设置」→ `.zone-popup`(复用 `.pair-popup` 外壳);
  3×3 预览带「n 想坐 / n 避开」计数 + 姓名过滤 + 姓名/排名/倾向/避开 四列表头
- **区域设置的颜色提示**(2026-11-03):`zoneStudentStatus()` 三态 ok/bad/na + '' 未设置(不着色),
  粒度到列(`prefBad`/`avoidBad` 各自给 select 加 `.zone-field-bad`);
  `applyZoneRowStatus` **就地改 class**,不重建行(否则掉焦点);
  刷新点 = 打开 / change / `afterSeatsRender()`→`refreshZonePopupStatus()`(内层必须 try/catch,
  `activeZonePopup` 是后段 `let`,早期调用会 TDZ);
  `.zone-popup` 改 flex column + `.zone-list{flex:1 1 auto}` 消除双滚动条
- **配对选择框已改成自绘候选**(`.pair-suggest`):原生 datalist 无法把名次放右侧、条目过高;
  自绘要点 = mousedown+preventDefault、就地撑高(父级 overflow 会裁浮层)、选中 id 记 dataset
