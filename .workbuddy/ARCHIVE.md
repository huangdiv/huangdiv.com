# 座位表项目 · 会话经验归档

> **生成**：2026-09-20 ｜ **最近修订**：2026-09-20（**修复 workspace `.git` + 清理全部绕行产物**，见 §2.3）
> **本文件已纳入 git**（`.workbuddy/`，公开仓库，便于换机/云端续开发）
> **代码权威提交**：`fb4de80`（seats-generator.* 自此前未再改动）
> **仓库 master tip**：`ca93199`（= 本经验同步提交；其上若干提交都是 `ClassMaster.html` 的功能）
> **⚠️ 好消息**：本 workspace 的 `.git` 已修复为**健康独立仓库** ⇒ **直接在这里 commit/push**，不再需要绕行仓。
> **用途**：把 2026-09-04 ~ 2026-09-20 全部开发会话压缩沉淀为**单一知识库**。
> 新会话读这一份即可恢复上下文；需要逐日细节时再查 `.workbuddy/memory/YYYY-MM-DD.md`；
> 2026-09-20 起的旧 overview / review 文档已归档到 `.workbuddy/archive/`（见其 README）。

---

## 0. 30 秒速览（新会话必读）

- **项目** = `huangdiv.com`（Hugo 静态博客，MemE 主题）+ `static/seats-generator.html`
  （纯前端「班级座位表」工具，localStorage 存储，无后端）。
- **开发目录（= 本 workspace，改文件 + commit/push 都在这里）**：
  `C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3`
  ⚡ **2026-09-20 已修复**：原先损坏的 worktree 指针（指向已消失的 `D:/.../.git/worktrees/...`）已被
  一份健康 clone 的 `.git` 整体替换 ⇒ 现在是**独立健康仓库**
  （`HEAD`=`master`=`origin/master`=`ca93199`，`git status` 干净，`fsck` 无输出）。
  ⇒ **直接 `git add/commit/push`，不再需要 `recover-huangdiv2` 那套绕行。**
- **关于 `origin/master` 不自动更新**：2026-09-20 已查明**不是 git 缺陷**，而是 **Agent 命令行沙箱**
  在 Temp 之外静默吞掉了 ref 写入 ⇒ 写 ref 的 git 操作请在**你自己的终端**里跑（Agent 内则走沙箱放行）；
  沙箱内可临时改 `.git/packed-refs` 兜底。详见 §2.2。
- ★ **换机 / 云端使用**：直接 `git clone https://github.com/huangdiv/huangdiv.com.git` 作为 workspace ——
  同样是**`/.git` 健康**的完整副本，改完直接 `commit/push`；本 `ARCHIVE.md` 与 `memory/` 都在仓库里，经验随仓库走。
- **三条铁律**：
  1. 直接在本 workspace 提交推送（提交后按 §2.2 校验并同步 `origin/master`）；
  2. 测试分两层——单元 `bash .workbuddy/run_unit_tests.sh` + 冒烟 Playwright（先起 8123 端口）；
  3. **写完新测试必须回退验证**（把代码改回 buggy 写法，确认测试会红，再改回来）。

---

## 1. 项目定位与仓库拓扑

### 1.1 项目内容
- **主体**：黄笛的个人博客 https://huangdiv.com（Hugo + MemE 主题 + Waline 评论 + GitHub Actions → GitHub Pages）。
  **仓库是公开的**（`github.com/huangdiv/huangdiv.com`，含 `.workbuddy/`）。
- **本会话主战场**：`static/seats-generator.html`——面向教师的班级座位表 Web 应用。
  - 功能面：班级多配置、行列/走道/讲台布局、学生导入与拖拽、智能排座、分组与分组轮换、
    签到模式、配对约束（强制同桌/回避同桌）、导出图片/CSV/打印、GitHub 云同步（PAT）。
  - 技术：vanilla JS（无框架）、localStorage、CDN 依赖 SheetJS + html2canvas。
- **同仓库还有别的 `static/` 工具**（不要混淆）：
  - `static/ClassMaster.html`（班级管家：宿舍/床位、成绩、学段、学生档案编辑…）——由**其他会话/机器**持续开发，与 seats-generator 相互独立。
  - `static/jumpto.html`（书签工具）。
  - ⇒ 改 seats-generator 只动 `static/seats-generator.*` 与 `static/modules/*`，别碰 `ClassMaster.html`。

### 1.2 仓库拓扑（关键，极易踩坑）
| 角色 | 路径 | 说明 |
|------|------|------|
| 远程 | `https://github.com/huangdiv/huangdiv.com.git` | org 是 `huangdiv`，**不是** xingz-io |
| ★ 开发+提交仓（唯一） | `C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3` | 本 workspace；**2026-09-20 起 `.git` 健康，直接 commit/push** |
| 已隔离（可整体删除） | `C:/Users/xingz/WorkBuddy/_cleanup_backup_seats_2026-09-20/quarantine-workarounds-2026-09-20/` | 旧的 `recover-huangdiv`、`recover-huangdiv2`、`_tmp_clone_huangdiv`、原主仓 `D:/Documents/GitHub/huangdiv.com`、9/4 手工备份；见 §2.3 |

### 1.3 部署链路
`huangdiv/huangdiv.com@master` → GitHub Actions（`reuixiy/hugo-deploy@v1`）→
`huangdiv/huangdiv.github.io@build` → GitHub Pages → https://huangdiv.com（CNAME）。
**`static/` 下的文件原样复制到站点根**，所以座位表线上地址即 `/seats-generator.html`。

> ⚠️ 座位表曾只存在于 `workbuddy/master-93f997c3` 分支；2026-09-04 已正确合入 master 并上线。

---

## 2. Git 工作流与全部已知坑

### 2.1 标准提交推送流程（2026-09-20 起：直接在本 workspace 操作）
```bash
cd C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3
git fetch origin                                  # 看是否与并行会话分叉
git log --oneline master..origin/master           # 远端多出的提交
git add <files> && git commit -m "..."
git push origin master                            # GCM 凭据，前台秒级完成
git rev-parse HEAD master origin/master           # 期望三者一致
# 若 push 后 origin/master 没跟上（本机 git 写不了 refs/remotes/origin/*）→ 按 §2.2 改 packed-refs
```
> 旧的「worktree 改文件 → `cp` 到 `recover-huangdiv2` → 在那里提交」流程**已废弃**（该仓已隔离，见 §2.3）。

### 2.2 ⚠️ `refs/remotes/origin/*` 写不进去 —— 真根因是 **Agent 命令行沙箱**（2026-09-20 定位并更正）
**旧结论已推翻**：此前记为「PortableGit 2.55 嵌套 ref bug」，**是错的**（与 git 版本无关）。

**决定性实验**：同一脚本、同一 git，只切换是否沙箱隔离：

| 路径 | 沙箱内 | 关闭沙箱 |
|------|--------|----------|
| `C:\Users\xingz\AppData\Local\Temp\…` | ✅ 落盘 | ✅ |
| `C:\_probe` / `D:\_probe` / `C:\Users\xingz\_probe` / `…\WorkBuddy\_probe` | ❌ 静默失败 | ✅ |
| **workspace 的 `.git/refs/remotes/origin/…`** | ❌ 静默失败 | ✅ 正常 |

⇒ **本机 git 完全正常**。是 Agent 命令行沙箱的文件系统虚拟化层在 Temp 之外**静默吞掉**了 git 的 ref 写入
（exit 0、无任何报错，甚至把已存在的 loose ref 文件连带目录一起删掉）。反证：同一沙箱内用 Python 做
`makedirs` / 写文件 / `os.replace` **全部成功** ⇒ 被吞的只是 **git 写 ref 的那条路径**。

**✅ 彻底修复**：凡会写 ref 的 git 操作（`clone`/`fetch`/`push`/`commit`/`merge`/`rebase`/`reset`/`worktree`）
**不要在沙箱内执行** —— 用你自己的终端 / VS Code 集成终端 / Git Bash / GitHub Desktop；
在 Agent 里则对这类命令**走沙箱放行**。

**沙箱内兜底（改 `packed-refs`，已实测可用）**：
```bash
git ls-remote origin refs/heads/master            # 取真实远端值（唯一可信来源）
sed -i "s|^<old40hex> refs/remotes/origin/master$|<new40hex> refs/remotes/origin/master|" .git/packed-refs
sed -i '/^$/d' .git/packed-refs                   # 空行 → "unexpected line in packed-refs"
git rev-parse master origin/master                # 一致即可
git status -sb                                    # 无 ahead/behind
```
- **沙箱内的纪律**：每个写 ref 的 git 操作后**必须**核对 `git rev-parse master origin/master`
  与 `git ls-remote origin master`；**不要相信 `git status` 的 ahead/behind**。
- **必须写 40-hex 全量**；写 7 位短 hash 会导致 `fatal: bad object` / `branch appears to be broken`。
- 历史推论：那几次「fetch/push 后 ref 不更新、`.git/refs` 目录消失、未推送提交被 GC」
  很可能同源（在沙箱里跑写 ref 的 git 操作），而非仓库/磁盘真损坏 —— 别急着重建仓库，先做上面的判定实验。

### 2.3 其他 git 注意
- **并行会话**：远程可能被其他会话/工具（如 trae）推送 ⇒ push 前务必 `git fetch` 看分叉。
  遇到 non-fast-forward：**不要 rebase**，用 `git fetch` + `git reset --soft origin/master`。
- **push 凭据**：credential helper 已是 GCM（`manager`），`git push origin master` 前台秒级完成。
  旧的「wincred 挂起/后台 2h41m」经验**已过时**，不要后台跑 push。
- `.workbuddy/` **已纳入 git** 并在公开仓库中：知识文档（`ARCHIVE.md`、`memory/`、`archive/`）、
  `run_unit_tests.sh`、全部 `smoke_test*.py`。目的是**换机 / 云端续开发时可直接拿到经验与测试**。
  `.gitignore` 已忽略 `__pycache__/`、`*.pyc`。杂项脚本/截图/补丁**不入 git**；
  2026-09-20 已把这类本地临时件清出 workspace（见 `memory/2026-09-20.md`）。
- **跨机协作**：其他电脑/云端会话会往同一仓库推送 ⇒ 每次开工先 `git fetch`，
  并用 `git ls-remote origin master` 核对真实远端（本地跟踪 ref 常因 nested ref bug 失真）。
- 事故史：`git pull --rebase` 被 SIGTERM 中断会删 `.git/refs` 并 GC 掉 commit；
  含斜杠分支上 `git merge` 也可能连带破坏对象库。详见 `memory/2026-09-07.md`、`2026-09-09.md`。
- **2026-09-20 修复 + 清理（本 workspace 转健康）**：
  - 坏因：workspace 是 worktree，其 `.git` 只是指针文件
    （`gitdir: D:/Documents/GitHub/huangdiv.com/.git/worktrees/master-93f997c3`），
    而该管理目录已消失、原主仓也损坏 ⇒ 任何 git 命令都报 `not a git repository: (NULL)`。
  - 修法：确认 workspace **无任何独有内容**（与远端 `ca93199` 仅差 `.gitignore` 与缺 `ClassMaster.html`）后，
    **用一份健康 clone 的 `.git` 真目录整体替换那个指针文件**，并补齐两个差异文件 ⇒ 变成独立健康仓库。
  - 行尾陷阱：workspace 文件是**混合 CRLF/LF**，换成 clone 的 index 后一度出现 **64 个假 `M`**
    （内容哈希其实完全一致，纯 stat 脏 + 换行策略冲突）。
    解法：本地 `git config core.autocrlf input`（检出不动、比较时把 CRLF 归一为 LF）⇒ **零文件改写**即干净。
  - 清理：`recover-huangdiv`、`recover-huangdiv2`、`_tmp_clone_huangdiv`、原主仓 `D:/Documents/GitHub/huangdiv.com`、
    以及 9/4 手工备份 `_backup_huangdiv_working_*` 全部**隔离**（非删除，可回滚）到
    `C:/Users/xingz/WorkBuddy/_cleanup_backup_seats_2026-09-20/quarantine-workarounds-2026-09-20/`。
    删除前已逐项验证：两个恢复仓与 workspace **逐字节一致**；旧备份的补丁**反向应用干净通过**（改动已在库中）。

---

## 3. 架构现状（2026-09-20 快照）

### 3.1 文件与行数
```
static/
├── seats-generator.html    411 行   入口（<link>/<script type="module"> + DOM 骨架）
├── seats-generator.css    3644 行   全部样式（含打印 @media、:focus-visible）
├── seats-generator.js     4754 行   主 IIFE（占位工厂 + 事件委托 + 业务胶水）
├── modules/
│   ├── state.js            117 行   state + bus + commit + subscribe + selectors
│   ├── migrate.js          161 行   migrateConfig（老数据字段补默认/clamp/version）+ APP_VERSION
│   ├── seat-grid.js        507 行   createSeatGrid(deps)：座位渲染 + persistent-DOM diff + 统计
│   ├── dragdrop.js         285 行   createDragdrop(deps)：拖放 7 事件 + 事件注册
│   ├── random-arrange.js  1158 行   createRandomArrange(deps)：排座引擎 + 分组轮换 + 性别规则 + 配对修复
│   └── messages.js         126 行   MESSAGES：全部用户可见文案集中层（i18n 雏形）
└── tests/                         7 个 Node ESM 单元测试（见 §5）
```

### 3.2 核心设计模式
- **模块化**：`createXxx(deps)` 工厂 + 显式依赖注入（`classroom` DOM、`getView()` 懒读、
  `helpers` 纯函数、`callbacks` 跨模块触发）；主 IIFE 用顶层 `const` 别名承接既有调用点。
- **状态中心**：`state`（单一数据源）+ `bus`；**一切写入走 `commit(patch)` 派发 `change`**，
  渲染/自动保存/派生 UI 通过 `subscribe` 响应。
- **渲染 diff（P1 性能核心）**：`seat-grid.js` 用 `seatNodes[]` + `seatStateCache[]` 持久化节点；
  `computeStructureKey()` = `rows|cols|view|mode|showStudentIcons|aislesSig`，
  键变 → `fullRebuildSeats`，否则 per-seat `diffUpdateSeats`（单座位签到仅 1 条 DOM mutation）。
- **事件委托非妥协**：座位点击/拖拽/删除、banner 内按钮**全部委托 `#classroom` 或父容器**——
  因为 DOM 节点持久化复用、banner 随重建会被替换，直接 `addEventListener` 到旧节点会失效。
- **渲染出口回调**：`onAfterSeatsRender` / `onRenderGroupBannerContent` / `onGetSeatExtraClass`
  用于在 diff 与全量两条路径后统一回填「派生 UI」（性别提示、配对状态、分组横幅、分组高亮）。

### 3.3 关键状态字段
`state`：`title/rows/cols/seats[]/students[]/groups[]/aisles[]/viewMode/showStudentIcons/`
`forcedPairs/avoidPairs/isCheckinMode/isGroupMode/groupRotateOffset/smartArrangeMixed/`
`smartArrangeSameGender/smartArrangeRotate`。
`students[i] = {id,name,gender,tags[],checkedIn,groupId}`；`gender ∈ 'male'|'female'|''`。

### 3.4 排座引擎（random-arrange.js）要点
- 3 基础模式：`random`（完全随机）/ `mixed`（男女同桌）/ `samegender`（男女不同桌）。
  注意：`random` 模式**设计上不校验** avoidPairs；只有 mixed/samegender 强制配对约束。
- **性别规则优先级最高**：换座守卫 `swapBreaksGender()`；落座 `placeStudentsGenderAware()`
  （按同桌单元分组、两轮填充保人人有座）；收尾 `adjustGenderRuleInGroups()` 全班修复；
  数学做不到时保留 + `GENDER_RULE_UNSATISFIED` 提示。
- **分组轮换** `rotateGroupSeats(offset)`：以「组当前占据的座位集合」为轮换单位，
  阶段 A 随机落座 / B1 回填本组空位 / B2 洗牌补位；无分组学生原地不动；占座总数恒等；
  自检写 warnings。**仅轮换时绝不叠加全班随机**（用户明确要求，commit `6f81c70`）。
- 写回**必须就地赋值**（`seats.fill(null)` / `state.seats[i]=...`）保持 `state.seats` 引用，
  否则打断顶层别名 `currentSeats` ⇒ 照片面/存档不一致。

---

## 4. 已上线功能清单（按 commit 时间倒序）

| 提交 | 内容 |
|------|------|
| `fb4de80` | 开「隐藏图标」时同步隐藏「X排Y列」坐标标签 |
| `776ee3b` | 修复「男女不同桌/同桌」随机排座达成率低（换座守卫+性别感知落座+全班收尾修复） |
| `74f684e` | 下拉菜单键盘焦点环改为跟随顶/底圆角 |
| `63bce57` | 移除配对弹窗「批量配对」「排座选项」；「学生分组」→「分组设置」、「分配学生到分组」→「详细设置」 |
| `6f81c70` | 开「小组轮换」时智能排座**只做轮换**，不再全班随机排座 |
| `5a171a5` | 开「小组轮换」时不再弹「完全随机」确认（后被 6f81c70 取代） |
| `4f33b8d` | 性别规则未达成的同桌**缓慢闪烁提示** + 轮换后组内男女不同桌调整 |
| `5634ca5` | 下拉按钮一次点击即弹出（WeakMap 互斥注册表 + DOM 为准的开关） + 三快捷按钮等高 |
| `773d3e1` | 座位方格统一正方形（并行会话提交） |
| `78d7d2d` | 修复教师视角拖拽后座位表「翻回学生视角」（seatNodes 以真实 seatIndex 为下标） |
| `7b2f46f` | 打印/导出日期与标题同行 + 「随机排座」重构为「智能排座」分段按钮（上执行/下选项菜单） |
| `4b90add` | 分组横幅「取消选择」+ 轮换溢出归上游组 + 配对满足度着色 + 普通模式多选 |
| `30fba45`/`53f733c` | 分组模式查看态（点击分组高亮成员）+ 多选焦点优化（三槽统计栏） |
| `7cf0546` | 分组轮换（+N 循环、步长可设、人数不等规则、设置弹窗） |
| `46a6538` | 模式按钮等高 / 分组 banner 两行 / 分组按钮长按删除 / 视角切换保留按钮 |
| `036c19f` | 「切换模式」三态轮换按钮（普通→签到→分组）+ 分组模式复用签到横幅 |
| `eb3717a` | 「配对设置」移入「随机排座」下拉 |
| `1482d21`/`81e0c75` | 下拉被遮挡修复（position:fixed + z-index）/ 拖拽 `try/finally` 清高亮硬化 |
| `6dd1680` | 默认 8×8 + 第 2/4/6 列后 30px 走道；**随机排座自动保存修复**；「切换模式」+ 分组模式 |
| `3a2181c` | 批次7：`messages.js` 文案集中层（i18n 雏形）+ `exportSeatImage` 作用域修复 |
| `12f34a0` | 批次6：撤销栈 smart-merge（200ms 同 opType 合并） |
| `b826649` | 批次5：P1 UX 6 项（批量配对/emoji 整词/下拉键盘/emoji 码点截断/焦点陷阱/图标反色） |
| `390bb40` | 批次4：P1 性能——`generateSeats` persistent-DOM diff（≈49× 加速）+ emoji 表扁平化 |
| `d36868e` | 批次3：P0 安全——GitHub URL 编码、`migrate.js` 字段补默认、PAT UX 4 状态机 |
| `6a3089a` | 批次2：随机排座质量（findPairMate O(1)/失败 toast/maxAttempts UI/算法单测） |
| `d578ecf` | 批次1：`atob/unescape` → TextEncoder/TextDecoder（utf8ToBase64/base64ToUtf8） |
| `e9a13e4`/`9427496` | shuffle 返回值 bug 修复 + P1 快赢（avoidPairs→Set、structuredClone、:focus-visible…） |
| `3e25124`→`2e02933`→`8e3382b`→`487423b`→`4ff1f39` | 模块化：random-arrange → dragdrop → seat-grid → state → 拆解内联（HTML 7911→380 行） |
| `376d8b5`/`b22fecf` | v1.3.1：标签系统 + 配对设置 + 智能排座 3 模式 + state-center 重构 + P0 修复 |

---

## 5. 测试体系与约定

### 5.1 单元测试（Node ESM，零依赖）
- 入口：`bash .workbuddy/run_unit_tests.sh`（遍历 `static/tests/*.mjs`，聚合通过/失败）。
- 7 个文件：`unit_defaults` / `unit_migrate` / `unit_messages` / `unit_random_arrange` /
  `unit_rotate_groups` / `unit_gender_rule` / `unit_gender_arrange_quality`。
- **加载顺序陷阱**：state.js 读 `location.search`，测试须先 `globalThis.location = {search:'dev=quiet'}`
  再 `await import('../modules/state.js')`；ESM 静态 import 会被 hoist ⇒ **全部用动态 `await import()`**。

### 5.2 冒烟测试（Playwright，`.workbuddy/smoke_test_batch*.py`，共 22 个批次文件）
```bash
cd static && python -m http.server 8123 --bind 127.0.0.1    # 文档根 = static/
cd .workbuddy && python smoke_test_batchXX_*.py
```
- URL 一律用 **`127.0.0.1`**（`localhost` 可能解析到 `::1` 导致 goto 超时）。
- 页面路径是 `127.0.0.1:8123/seats-generator.html`（**不是** `/static/...`）；
  模块相对 URL 是 `/modules/state.js`。
- **服务器半挂**：`http.server` 跑 15~25 分钟后 curl 可能仍 200 但 goto 超时 ⇒ `taskkill` 后重启即可，
  不要怀疑页面代码。
- **`dialog` 必须全局接受**：`page.on("dialog", lambda d: asyncio.create_task(d.accept()))`，
  否则 random/轮换的 confirm 会让测试卡死。
- 浏览器启动加 `args=["--no-proxy-server"]`；Playwright 装在 system Python 的 site-packages。

### 5.3 测试专用桩（仅本地 127.0.0.1/localhost 暴露）
- `window.__seatsTest`：`rotateGroupSeats` / `randomSeatArrange`（驱动带撤销与 UI 回调的真实实例）。
- `window.__undoTest`：仅 URL 带 `?debug=1` 时挂载（撤销栈断言）。

### 5.4 回退验证纪律（强制）
写完/改完测试后，**临时把被测代码改回 buggy 写法跑一遍，确认测试会红**，再改回来。
- 例：教师视角拖拽修复回退后 5 项失败且报错信息正是根因；
  批次21 性别达成率必须「同时停掉守卫 + 收尾修复」才转红（只停守卫仍绿 ⇒ 定位到哪个改动才是关键）。

---

## 6. 经验教训库（本项目最值钱的资产）

### 6.1 典型 Bug 根因模式
| 模式 | 案例 / 结论 |
|------|-------------|
| **别名断链** | `let currentSeats = state.seats` 被 `state.seats = Array().fill(null)` 重赋值打断 ⇒ 渲染读新数组、自动保存读旧引用。修：就地 `fill(null)` + subscribe 回调做别名回同步兜底。 |
| **shuffle 返回值陷阱** | `shuffle(x); use(x)` 是 bug（shuffle 返回拷贝非原地）。「每隔一次相同排座」的真凶。审计：grep `shuffle(` 看返回值是否被接住。 |
| **索引语义混淆** | 有镜像/排序/过滤的渲染里，「数组下标」≠「业务索引」。教师视角 `seatNodes` 必须**以真实 seatIndex 为下标写入**，DOM 追加顺序保持视觉镜像，二者解耦。 |
| **闭包状态失步** | 下拉 `isOpen` 是闭包变量，互斥关闭只改对方 `style.display` 不同步变量 ⇒ 「有时要点两下」。更稳做法：**让 DOM 成为唯一真相源**。 |
| **持久化 DOM 的 class 被覆盖** | `applySeatFullRender` 重设 `className` 会抹掉自定义 class（如分组高亮/性别提示）⇒ 统一拼在基础 class 后 + 渲染出口重贴。 |
| **动态 DOM 内按钮失效** | banner 随重建被替换 ⇒ 按钮必须走容器事件委托；diff 不重建壳子时，纯内容变更需在渲染出口单独回填。 |
| **落座后处理无视约束** | 随机排座「每位学生都不在原座」的后处理把合规同桌拆散 ⇒ 优先级必须明确：**性别规则 > 「必须换座」**。 |
| **陈旧跟踪 ref** | `git fetch` 后 origin/master 可能被嵌套 ref bug 回退 ⇒ 只信 `git ls-remote` / `git fsck`。 |

### 6.2 测试技巧
- 用 `localStorage.setItem('classroomConfig', JSON.stringify(cfg))` + `page.reload()` 注入数据；
  cfg 结构见 `getCurrentConfig()`。
- `autoSave()` 有 **500ms 防抖** ⇒ 断言持久化前 `wait_for_timeout(700)`。
- 验证 DOM 节点持久化：给座位加 `data-persist-test` 自定义属性，no-op render 后看是否还在。
- 验证「是否走了全班随机」：注入 2 名**无分组**学生——轮换时原地不动，全班随机会打散，可稳定区分路径。
- 用 MutationObserver 量化 diff 效果（单座位签到：全量 ~50 条 → 1 条）。
- `transition` 未结束时读 computed style 会拿到中间态 ⇒ 等 ~300ms。
- 座位类只有 `seat` / `seat empty`（无 `assigned`）；空座位也带空 `data-student`，选择器要过滤非空。
- 刷新会清空撤销栈，`undoBtn` 变 disabled ⇒ 撤销场景要在刷新后重做一次操作。

### 6.3 通用工程教训
- 删除 UI 功能时，用**全仓 grep**（py/mjs/md/html/css）找所有消费点：消息常量、localStorage key、
  CSS 类、测试选择器都是隐藏耦合。
- 同一文件的多处 Edit **不要并行提交**（后写覆盖前写，静默丢改动）；串行并复查。
- 文案集中到 `MESSAGES` 时保持 **byte-for-byte** 一致，既有 unit 断言无需改。
- 追加 `messages.js` 常量后确认闭合 `};`（否则 `Unexpected end of input`）。
- 盘点「剩余优化项」时先 grep 已修项，避免做无用功（批次1 三项里两项早已隐性修复）。

---

## 7. 未完成 / 待办

- **`seats-generator-review-v1.3.0.md` 全清单已闭合**（P0/P1/P2 全部落地，截至 2026-09-06 批次7；
  该审查文档已归档到 `.workbuddy/archive/`）。
- 可选后续模块化（边际收益递减）：`seat-data.js`（导入/CRUD）、`tag-system.js`（emoji 字典）、
  `checkin.js`、`statistics.js`。
- 已知既有小问题（未修，影响小）：空座位也带空 `data-student` 属性；
  `run_unit_tests.sh` 里写死 node `22.22.2-2`（实际 managed 是 `22.22.2-3`，靠 `command -v node` 兜底）。
- ✅ **环境已修复（2026-09-20）**：workspace `.git` 健康、可直接 commit/push；旧主仓与 3 个绕行仓、
  9/4 手工备份均已隔离（见 §2.3）。确认无碍后可整体删除隔离目录
  `C:/Users/xingz/WorkBuddy/_cleanup_backup_seats_2026-09-20/`。
- ✅ **`origin/master` 不更新已定性**：**不是 git 缺陷**，是 Agent 沙箱吞掉 ref 写入（§2.2）。
  ⇒ **本机正常使用（你自己的终端 / VS Code / Git Bash）完全没有这个问题**；
  在 Agent 内跑写 ref 的 git 操作需**走沙箱放行**。

---

## 8. 新会话快速上手 checklist

1. **只改本 workspace 文件**；提交推送**直接在本 workspace 做**（§2.1，不再有绕行仓）。
2. 改代码前先 `Grep` 定位模块（主 IIFE 在 `seats-generator.js`；渲染 `seat-grid.js`；
   排座/轮换/性别/配对 `random-arrange.js`；文案 `messages.js`；迁移 `migrate.js`）。
3. 改完先 `node --check`，再 `bash .workbuddy/run_unit_tests.sh`。
4. 涉及 UI 就写/跑对应 `smoke_test_batch*.py`（先起 `http.server 8123`，§5.2）；
   新测试**必须回退验证**（§5.4）。
5. 在本 workspace：`git fetch` 看分叉 → `git add/commit` → `git push origin master` →
   `git rev-parse master origin/master` 校验；若 `origin/master` 没自动跟上，按 §2.2 改 packed-refs。
6. 收尾把当天工作追加到 `.workbuddy/memory/YYYY-MM-DD.md`（append-only）。

---

*本归档由会话记录压缩生成；如与代码冲突，以代码 + `git log` 为准。*
