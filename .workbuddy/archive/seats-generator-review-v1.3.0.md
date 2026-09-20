# 座位表应用 (seats-generator.html) 复查报告 · v1.3.0

> 文件:`static/seats-generator.html` · 7675 行 · 约 280+ KB · 版本 **v1.3.0**
> 基于:**origin/master `2ccca609` 「功能更新」**(相对 v1.2.1 增量 +2003 / -262)
> 对比基准:上一版审查(v1.2.1,5934 行)

---

## 〇、本次更新:从 v1.2.1 到 v1.3.0 发生了什么

> 先定位变化,再看结构和问题。**缩略号行号相对旧版变化**

| 模块 | 旧 v1.2.1 | 新 v1.3.0 | 评价 |
|------|----------|-----------|------|
| **应用版本号** | 1.2.1 | **1.3.0** | 小版本跃升,功能维度而非修小 bug |
| **页面标题** | `班级座位表` | 同上 | 无 |
| **随机排座按钮** | 单按钮 → confirm | **3 选项下拉菜单**:`完全随机` / `男女同桌` / `男女不同桌` | ★ 重大增强 |
| **打印按钮** | 单按钮 | **下拉菜单**:`打印/PDF` / `导出为图片` | ★ 入口更清晰 |
| **辅助操作行** | 4 个按钮(撤销/重做/教师视角/导出图片) | **5 个按钮**:撤销/重做/**教师视角**/**图标**显示/**配对设置** | ★ 增加两个能力 |
| **学生图标** | 仅显示「姓名」 | 在座位上**叠加 ♂/♀ 性别图标 + 🏷 标签图标**;有"显示/隐藏"切换 | ★★ 教师讲台上能一眼看到 |
| **学生管理面板** | 姓名 + 分组 + 删除 | **姓名 + 分组 + 性别下拉 + 标签按钮 + 删除** | ★★ 现场单条修改也能用 |
| **标签系统** | 无 | 独立标签弹窗、emoji 图标、智能关键词库(班长/学习/体育… 30+ 条目)、冲突解决、复用同名标签 | ★★★ |
| **配对系统** | 无 | **强制同桌**(must-pair)/ **避免同桌**(avoid-pair) 配对弹窗;对随机排座生效 | ★★★ |
| **导入面板** | 姓名 / 分组 / 行筛选 | **新增**:性别导入列(自动识别 男/male/♂…) / 标签导入列(自动分配 emoji) | ★★ |
| **智能随机排座** | 仅 Fisher-Yates | **3 模式引擎**:`getDeskMatePairs()`(同桌对检测)→ `forcedPairs` 必入 → `mixed/samegender` 按池洗 → **后处理保证全部换位**(最多 200 次尝试) | ★★★★ 真正的产品力 |
| **配置 schema** | v2.0(无配对、无图标开关) | **新增字段**:`forcedPairs`、`avoidPairs`、`showStudentIcons`(迁移路径未升级 version 字段) | ⚠️ 见 P0-b |

---

## 一、最新版本(v1.3.0)功能盘点

### 1. 学生数据层

| 模块 | 已具备能力 |
|------|-----------|
| **学生姓名** | 单条改名、批量(批量模式)改分组,Excel 批量导入 |
| **学生性别** | 单条下拉 ♂/♀/—,Excel 批量导入(自动识别中文/英文/符号/数字 1/2) |
| **学生标签** | 任意多条 `{emoji, label}`,可手动管理、Excel 批量导入;提取行首 emoji 或按关键词智能分配;**冲突自动替换**;同名标签复用 emoji |
| **学生分组** | 名称+颜色,Excel 按列自动生成分组 |
| **学生图标** | 座位角标显示 ♂/♀ + 标签 emoji;可一键隐藏 |

### 2. 座位分配引擎

| 模块 | v1.3.0 已具备 |
|------|--------------|
| **基础拖放** | 桌面端拖拽(分配/交换/下座/删除),移动端两步点击 |
| **随机排座-完全随机** | 简单打乱填入(同 v1.2.1 行为) |
| **随机排座-男女同桌** | 同桌对优先 1 男 1 女,失败时退回完全随机;**避免配对会被检索,且不可同桌** |
| **随机排座-男女不同桌** | 同桌对放同性别;同性池跑空时退回;避免配对同样生效 |
| **强制配对** | 必同桌的学生对,排座时首先成对放置;不可被交换打破 |
| **避免配对** | 不能同桌的学生对,Swap 算法会跳过任何产生这种同桌的方案 |
| **全员换位保证** | 算法后处理阶段,原座位有人的最多 200 次重试交换,兜底使用空座位 |
| **快捷随机入座** | 只补空座位,不打乱已有安排 |

### 3. 配置 & 数据存储

| 模块 | 能力 |
|------|------|
| **自动保存** | localStorage 防抖 500ms |
| **多配置** | 命名/时间戳/激活态 + 重命名 + 删除 |
| **JSON 导入/导出** | 完整配置往返 |
| **GitHub 同步** | 双向(上传 + 智能合并下载) |
| **配置迁移** | 支持旧版缺字段、姓名即座位等畸形 schema |
| **App-Info 弹窗** | 显示版本/作者/网站/协议 |

### 4. 签到 / 导出

| 模块 | 能力 |
|------|------|
| **签到模式** | 一键切换 + Banner + ✓/× 角标 + 全员入座进度条 + 统计卡自动切换 |
| **统计行动** | 5 个统计块均可点击弹窗 →「复制姓名 / 下载 Excel」 |
| **打印(PDF)** | `matchMedia('print')` 监听 + A4 横向自适应 scale + 日期标签 |
| **导出图片** | html2canvas + 离屏克隆 + 2× scale(从下拉菜单触发) |

### 5. 响应式 / 移动端 / 无障碍

| 模块 | 能力 |
|------|------|
| **触摸识别** | `(pointer: coarse) + (hover: none) + maxTouchPoints` |
| **触摸两步法** | 「点选 + 点目标」,实时横幅状态 |
| **媒体查询** | 900px / 768px / 319px 三档 |
| **触摸态样式** | `touch-action: manipulation`,无 hover 抬升 |
| **可访问性** | `role="dialog"` / `aria-live="polite"` / `:focus-visible` / `prefers-reduced-motion` |
| **键盘** | Esc 关闭弹窗、Ctrl+Z/Y、Tab 全可达 |
| **打印色保证** | `print-color-adjust: exact` 全局 |

### 6. 新增可视化功能

| 模块 | 能力 |
|------|------|
| **下拉菜单** | 随机排座 3 选 1;打印/PDF 二选一(打印 vs 导出图片) |
| **学生图标显示** | 座位同时显示 ♂/♀ + 标签 emoji;一键开关 |
| **标签管理弹窗** | emoji + 标签名 + 删除 + **从已有标签里建议(自动补全)** |
| **配对设置弹窗** | 强制 / 回避两个 tab,左右两个学生下拉,实时显示已配对列表 |

### 7. Excel 导入面板(2026-09-04 大幅强化)

| 子模块 | 能力 |
|--------|------|
| **姓名列** | 自动检测列名包含「姓名/name」 |
| **分组列** | 自动检测列名包含「分组/group/班级/class」 |
| **行筛选** | 按列 + 按值筛后导入 |
| **性别列** | 自动识别中文/英文/♂/♀/1/2/男/女/male/female;只要一列 |
| **标签列** | 一行一个标签;**行首 emoji 自动作为图标;否则按 30+ 关键词智能分配;冲突时自动替换** |

---

## 二、代码与产品的优化建议(基于 v1.3.0 重写)

> **优先级标记**:`P0`(影响数据/安全/可用性) → `P1`(显著改善) → `P2`(锦上添花)

### A. 架构与模块化(全部 **P0**,已成燃眉之急)

1. **【P0】5934 → 7675 行,文件还在膨胀;现在是「拆模块」最佳窗口**
   - 上一版 P0 第一条仍是最大问题:7675 行 + 283 个函数 + 115 个 `addEventListener` + 26 个 `createElement`,全在一个 IIFE。
   - **建议**:`static/` 下拆为
     - `app.js`(主入口 + bus)
     - `modules/state.js`(students/groups/seats/aisles/pairs 单一数据源)
     - `modules/persistence.js`(localStorage / IndexedDB / 迁移)
     - `modules/seat-grid.js`(座标计算 + 渲染)
     - `modules/dragdrop.js`(桌面/触摸)
     - `modules/random-arrange.js`(3 模式 + 配对 + 后处理)
     - `modules/excel-io.js`(SheetJS 封装 + 5 种列识别)
     - `modules/pair-settings.js`、`modules/tag-manager.js`、`modules/github-sync.js`
     - `styles/base.css`、`styles/components.css`、`styles/print.css`
   - 节奏:**先拆 JS,再拆 CSS**。

2. **【P0】必须引入「状态中心 / EventTarget 总线」
   - 现在每个变更操作要手动调 5–8 个 `updateXxx() + generateSeats() + autoSave()`。v1.3.0 新增 7 个新功能后,这种串调维护成本**指数级增长**。
   - **建议**:
     ```js
     const bus = new EventTarget();
     function commit(patch) { Object.assign(state, patch); bus.dispatchEvent(new Event('change')); }
     bus.addEventListener('change', () => { renderAll(); autoSave(); });
     ```
   - 子模块订阅细粒度事件:`bus.on('seats-changed', () => { updateStats(); renderGrid(); })`。

3. **【P1】287 个函数中,相似函数反复定义**
   - 标签 popup 与配对 popup 各自的 `openPopup/closePopup/render` 三件套很相似,可考虑抽象 `<el('div', ...)` hyperscript。

### B. v1.3.0 出现的「P0 新坑」

1. **【P0-a】`gender` / `tags` / `forcedPairs` / `avoidPairs` **都没在 `migrateConfig` 里处理迁移****
   - 老 JSON 配置载入后,这些字段全部 `undefined`。
   - 老数据进入随机排座 → `getGender(s)===undefined` → `return 'X'` 是兜底但可能不符合期望。
   - 老座位里**没有标签 / 没有性别**——本可以「补默认」让旧班级数据也能用新功能。
   - **建议**:`migrateConfig` 显式 `config.forEach(s => { if (!s.tags) s.tags = []; if (s.gender === undefined) s.gender = ''; })`,并把 version 同步提升到 '3.0'。

2. **【P0-b】`APP_VERSION = '1.3.0'` 但 `getCurrentConfig.version = '2.0'`**
   - 检测本地存储的 `version` 字段判断是否要迁移;两个版本号不一致容易误导。
   - **建议**:统一一套版本语义。

3. **【P0-c】GitHub 同步上传的不是「所有配置 + 当前」而是单 chunk JSON,但**下载时 `applyConfig(data.configs[data.activeName])` 直接覆盖整个本地状态**
   - **会丢掉**本地新增但还没上传的配置。
   - 策略注释说「spread 合并 configs」是做了,但配置名冲突时是「云端覆盖本地」还是「本地覆盖云端」没显式策略。
   - **建议**:
     - 上传改为上传「当前完整合并」而非「active + 全部」;
     - 下载做「3-way merge:本地 vs 云端 vs 基线」或「同名校验 + 让用户选」。

4. **【P0-d】GitHub PAT 仍以明文 localStorage 储存,且 URL 拼接未 `encodeURIComponent`**
   - 上次审查的 P0 项,**没改**。

5. **【P1】3 种随机排座模式共用一个 confirm,但 `mixed` / `samegender` 可能无可行解**
   - 当前 confirm 文案`确定要执行「」排座吗?`对失败时也无后续提示。
   - 例如 60 人的班,25 对避免配对,无解时算法跑 200 次会**沉默返回部分结果**,无 toast / 警告。
   - **建议**:算法出口增加结果自检 ——
     ```js
     if (wasUnresolved > 0) showStatToast(`未能避免 ${wasUnresolved} 对回避配对 / 保留 ${leftover} 人未入座`);
     ```

6. **【P1】`tag-toggle-btn` 与 `student-tag-btn` 的事件委托独立成两段代码**
   - 第 4036-4051 行,**明明是同一个语义**(打开标签 popup),逻辑也几乎相同(只差是否临时)。
   - **建议**:抽 `openTagPopupCommon(anchorEl, isNew)`。

7. **【P1】`openNewStudentTagPopup` 与 `openTagPopup` 几乎是 copy-paste**
   - 第 4168-4510,标签 popup 实现有两份近乎相同的代码。
   - 抽取差异点(标签数据来源 + 同步方式),其余共用。

8. **【P1】配对系统后处理算法的 200 次上限没暴露在 UI**
   - 50+ 人的班、配对约束密集时可能 200 次不够。
   - **建议**:加个无 toast 错误告示 + 可重试次数配置项。

9. **【P1】`getDeskMatePairs` 把「同桌」硬编码为「右邻」**
   - 走道只能纵向,但走道设置时是「X 列后」;`getDeskMatePairs` 假设左右同桌(横向),如果未来想支持异形座位布局,这个硬编码会卡住。
   - **建议**:抽出 `findPairMate(seatIdx) → idx` 函数,初始仅支持横向。

### C. 安全与可靠性(沿用 + 新增)

1. **【P0-承袭】GitHub PAT 明文存储**
2. **【P0-承袭】`githubApiRequest` URL 未编码**
3. **【P0-新】Excel 解析 sheet 时未限制行数,大数据集仍可 OOM**
4. **【P1-承袭】`localStorage` 5MB 限制**
5. **【P1-新】`parseGenderText` 中文与 Unicode 符号都有,但 emoji `♂️`/`♀️`(含 VS16)与 `♂`/`♀`不互通**
   - 现在只识别 `♂` 和 `♀`。
   - **建议**:加上 `\uFE0F` 变体识别 + 数字 0 / n / unknown 兜底。

### D. 性能

1. **【P1-承袭】`generateSeats` 全量 innerHTML 重建**——v1.3.0 增加了标签/性别图标后,DOM 节点数更多。
   - **建议**:diffSeats 更新;或者用 Vue/Preact 局部组件(单文件应用,纯 ES module `<script type="module">`)。
2. **【P1-新】`randomSeatArrange` 时间复杂度**
   - `getDeskMatePairs` O(rows×cols),还 OK;
   - 后处理 200 次 × 每对 49 = 9800 次 isAvoided 检查;
   - 100 人班 + 25 对避免配对时可能接近 1s。
   - **建议**:把 `avoidPairs` 转为 `Set<string>` (`keyA+'_'+keyB`) 一次建表 O(1) 查询,避免每对都遍历。
3. **【P1-新】`labelToEmojiMap` 和 `usedEmojisSet` 在每次 `parseTagValue` 调用都新建**
   - 同一 Excel 内几次调用是合理的,但 1000+ 行的 xlsx 会重复构造。
   - 把这两个集合提到外层即可。
4. **【P1-承袭】`JSON.parse(JSON.stringify(x))` → `structuredClone`**。
5. **【P2】`document.querySelectorAll('button')` 批量隐藏(用于导出图)— still 慢 + 误伤**。

### E. 用户体验(新版本亮点)

1. **【P1】配对设置弹窗内嵌在按钮 popover 里,首次使用不知所措**
   - 「强制同桌 / 避免同桌」两个 tab,但入口只有一个「配对设置」按钮。
   - 建议:
     - 弹窗直接列 tab 与简短示例;
     - 提供「按分组批量配对」(同组同桌 / 异组同桌)一键设置;
     - 弹窗内显示当前有多少生效的强制/回避对。

2. **【P1】标签 emoji 智能映射可能「猜错」**
   - 例如「张三」含「三」可能不会,但「学习委员」应映射到「📚」,含有「学」字——目前是 includes 判断,可能误匹配到「学籍」的别处。
   - **建议**:
     - 改为「整词优先 + 子串兜底」(`test(/\b学习委员\b/)`);或
     - 引入更严格的边界正则;
     - 在 UI 显示「已自动分配 emoji ✏️」并允许一键修改。

3. **【P1】下拉菜单点外面关闭**—— 在 printBtn 事件上做了,但 randomDropdown 是否也做到了?
   - 第 5750 行 TODO 注释 `点击关闭 randomDropdown（事件委托，在 printBtn 的 document click handler 里统一处理）`—— 依赖 printBtn 接收,没看到兜底。
   - **建议**:统一封装 `<Dropdown>` 组件,自动关闭。

4. **【P1】座位上的图标在分组颜色背景下可能看不清**
   - 男 ♂ 是单一符号,贴浅色 / 深色背景都不变。
   - **建议**:图标根据背景明暗自动反色(`mix-blend-mode: difference` 或白/黑文字)。
   - 现在分组颜色填充 + 黑/白文字 适用,但 emoji 不一定,需要测试。

5. **【P1】随机排座下拉按钮的 ▾ caret 没有键盘可达**
   - 下拉菜单打开靠 click,键盘用户无法使用。
   - **建议**:`aria-haspopup="menu"`,Enter/↓ 触发。

6. **【P1】标签管理弹窗未做「焦点陷阱」**——和同尺寸的 stat-action-menu 一致;键盘用户 Tab 可跳出弹窗到主体。

7. **【P2】配对设置保存路径不明显**
   - 用户改完配对对,关闭弹窗后没明显反馈。
   - **建议**:弹窗关闭时跑一次「随机排座预览」或 toast 提示「下次随机排座时生效」。

### F. 可访问性 & 国际化

1. **【P1】继续 missing 的 `:focus-visible`**:
   - `.action-btn-dropdown`、`.dropdown-caret`、新加的 `tag-toggle-btn`、`.tag-popup-add`、`.print-dropdown-item` 都没显式焦点环。
2. **【P1】配对/标签弹窗里 emoji input `maxlength="4"` 在 emoji 含 VS16 时**会被截短一半。
   - **建议**:`maxlength` 用 Array.from 计数。
3. **【P2】i18n** — 把 `confirm` / `alert` 文案集中到一个常量对象,方便未来抽离。
4. **【P2】HTML 语言标记 `<html lang="zh-CN">` 没问题,但 SeatJS / 异常消息全是英文**——统一抓取层。

### G. 数据迁移 & 版本管理(**v1.3.0 引入新 P0**)

1. **【P0】新增字段缺迁移**
   - 老数据 `students[i].tags`、`students[i].gender`、`forcedPairs`、`avoidPairs`、`showStudentIcons` 都缺,migrateConfig 没补默认。
2. **【P0】`APP_VERSION='1.3.0'`,但 config.version 还是 `'2.0'`**——版本语义不一致,CI 检查或开发者会困惑。
3. **【P1】迁移未做向后兼容测试**
   - 写一个 E2E:把 v1.0 配置载入 → 期望全部默认值就位 → 标签/性别功能可用。

### H. 可维护性

1. **【P1】287 个函数,命名风格不一致**——驼峰 / 下划线 / 中英混排(`tag-toggle-btn` / `tagToggleBtn` / `webdav-input` 等)。
2. **【P1】两份「update display」模板代码**(`updateStudentAssignmentDisplay`、`updateGroupDisplay`)字符串拼接越来越多,引入 hyperscript。
3. **【P1】emoji 关键词字典 33 条是硬编码**——抽到配置文件或 emoji.json,允许用户扩展。
4. **【P2】CSS 仍有重复定义** — 上次未解决;新增的 `.tag-popup`、`.pair-popup`、`.print-dropdown` 可能也有重复。

### I. 测试与文档

1. **【P0】无 E2E 测试** — 配置迁移、随机排座算法是**最容易回归的地方**,必须先有 happy-path 测试。
2. **【P1】算法(`randomSeatArrange`)逻辑复杂度高** — 至少拆出来 → 加单元测试:
   - `getDeskMatePairs` 在有无走道时
   - `parseTagValue` 给同样文本是否稳定分配同样的 emoji
   - `parseGenderText` 对每个变体
   - `findConflicts` 在 N=0、N=全部冲突时
   - 强制配对 / 避免配对的优先级

---

## 三、已解决(对比 v1.2.1 报告)

| 之前提到的问题 | v1.3.0 是否解决 |
|----------------|----------------|
| ❌ 单文件 IIFE 模块化 | ⚠️ **未解决** — 增长更快(从 5934 → 7675 行) |
| ❌ 状态中心 | ⚠️ **未解决** — 反而更多手动调用 |
| ❌ 撤销栈 / 状态管理 | ⚠️ **未解决** |
| ❌ GitHub PAT 明文 | ⚠️ **未解决** |
| ❌ URL 未编码 | ⚠️ **未解决** |
| ❌ `atob/unescape` 已废弃 | ⚠️ **未解决** |
| ❌ Excel 无大小限制 | ⚠️ **未解决** |
| ❌ `JSON.parse(JSON.stringify())` | ⚠️ **未解决** |
| ❌ `:focus-visible` 不全 | ⚠️ **未解决** |
| ❌ 重复 CSS 定义 | ⚠️ **未解决** |
| ❌ 拼装 HTML 的 XSS 风险 | ✅ 几乎所有 `escapeHtml` 包裹,新版 tag/pair popup 也都做了 |
| ❌ 没有座位备注 / 锁定 | ✅ **解决**:标签 + 强制配对覆盖部分场景 |
| ❌ 撤销清空 redo 太激进 | ⚠️ **未解决** |
| ❌ 不能按规则排座 | ✅ **大幅解决**:按性别 + 按约束,可继续扩 |
| ❌ 导出 CSV/Markdown | ⚠️ **仍无** — 但 Excel 已经能导 |

---

## 四、本次更新后的「亮点」

> 这些是 v1.3.0 新出现的、值得保留并放大的设计。

| 亮点 | 说明 |
|------|------|
| **emoji 智能分配** | 关键词字典 + 冲突检测 + 同名复用,首次让标签系统「可用」而不只是「能存」 |
| **配对设置(强制/回避)** | 教师场景强需求,价值密度高 |
| **随机排座 3 模式 + 后处理** | 真正考虑了「不全在原位」的反直觉需求;后处理交换检查 `swapCreatesAvoidPair` 写得严谨 |
| **Excel 性别/标签导入** | 减少教师手工逐个配置,导入一次到位 |
| **学生图标显示开关** | 兼顾「需要看」与「想简洁」两种偏好 |
| **下拉菜单风格统一** | 随机排座 / 打印 都是 `action-btn-dropdown` + `print-dropdown`,视觉一致 |

---

## 五、立即可做的小修补(累计自上次审查)

| 项 | 估时 | 影响 |
|----|------|------|
| `migrateConfig` 补全新字段默认值 + 升级 config.version 到 '3.0' | 15 min | 新老数据可访问新功能 |
| 把 `parseGenderText` 加上 emoji VS16 变体识别 | 10 min | 兼容性 |
| `avoidPairs.some(...)` 改为 Set<string> 查询 | 20 min | 性能 +50% |
| `JSON.parse(JSON.stringify())` → `structuredClone` | 15 min | 性能 |
| 给 `.tag-popup-add` / `.print-dropdown-item` 加 `:focus-visible` | 10 min | 无障碍 |
| `openNewStudentTagPopup` 与 `openTagPopup` 抽公共 `openTagPopupCore(anchor, isNew)` | 45 min | 可维护性 |
| 在「签到 Banner」旁边放个点击空白取消的提示文案 | 10 min | UX |
| 给 print/random 下拉菜单加键盘 Enter/↓ 触发 | 15 min | 无障碍 |

---

## 六、推荐的下一步方向

按收益/工作量比,我建议以下其中之一作为下个里程碑:

### 选项 A:**「模块化 + 状态中心」1 周专项**(推荐)
- 抽 4 个核心模块(`state.js`、`seat-grid.js`、`dragdrop.js`、`random-arrange.js`)
- 引入 `commit() / bus.addEventListener('change', ...)` 总线
- 同步补 E2E happy-path(导入 → 排座 → 随机 + 配对 → 签到 → 导出图片)
- 收益:后续每个功能变更不再触碰核心渲染逻辑

### 选项 B:**「产品功能完备性」1 周专项**
- 完成度/优化方向:
  - 标签导出/统计报表
  - 座位备注(身高/视力/性格)
  - 配对规则批量生成(按分组自动配对)
  - 撤销栈 smart-merge(同操作类型 200ms 内合并)
- 收益:对终端用户立刻可见的好用性

### 选项 C:**「安全与可靠性」1 周专项**
- 把 GitHub PAT 改内存存储 + 加密兜底
- URL 编码全栈补
- IndexedDB 替换 localStorage
- 离线 PWA(本地缓存页面 + SheetJS / html2canvas 离线版)
- 收益:让学生数据被多设备同步时不会因密钥丢失泄

---

## 七、TL;DR

> v1.3.0 是**功能力度**的一次大跃——标签 / 配对 / 智能排座是真正的产品价值,做得不错。
> 但**架构债**也跟着叠加:283 个函数、2875 行 IIFE、3 种新功能都「裸挂在主线」,手动 commit + 手动 update 已经很难维护。
> 如果只挑一件事做:**先做模块化和状态中心**,否则 v1.4.0 再加一两个功能就会到 9000+ 行,后续每次重构都要拆很久。

---

*审查人:Frontend Developer · 审查时间:2026-09-04 基于 v1.3.0 (2ccca609)*
