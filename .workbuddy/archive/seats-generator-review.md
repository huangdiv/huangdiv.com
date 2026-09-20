# 座位表应用 (seats-generator.html) 检查报告

> 文件:`static/seats-generator.html` · 5934 行 · 约 221 KB
> 应用名:**班级座位表** (v1.2.1,作者 huangdiv,CC BY-NC-SA 4.0)

---

## 一、应用功能盘点

### 1. 学生 / 数据层
| 模块 | 已具备的能力 |
|------|--------------|
| **名单导入** | 选择 `.xlsx`/`.xls`,自动列出所有 Sheet,选择 Sheet 后自动检测姓名列(列名包含「姓名 / name」即命中),支持多 Sheet 切换 |
| **列手动选** | 工作表下拉、工作表二次切换、姓名列下拉 |
| **分组导入** | 勾选「同时导入分组」后,可指定分组依据列;自动去重并按 Excel 内出现的顺序排序 |
| **数据筛选** | 「导入前先筛选数据」复选框:按指定列 + 指定值筛选行后才导入 |
| **手动管理** | 在「分配学生到分组」面板手动新增 / 改名 / 改分组 / 删除学生 |
| **批量操作** | 进入批量模式 → 多选学生 → 一键分配到某分组 / 批量删除 |
| **配置迁移** | 支持旧版 v1 字符串数组、姓名当 seat、缺 `id` 字段、`checkedIn` 缺省等多种格式 |

### 2. 座位表布局
| 模块 | 已具备的能力 |
|------|--------------|
| **行列设置** | 行列各 1–20,默认值 7×7;变更时按最小矩阵保留原座位,被切除的座位直接丢失(并弹窗确认) |
| **走道** | 可加多道走道,指定「在第 N 列后」+ 宽度(px);支持随时删除;自动按列号排序 |
| **讲台** | 学生视角显示在顶部,教师视角通过 `order:9999` / 反向遍历翻转显示到底部 |
| **视角切换** | 「教师视角 / 学生视角」一键翻转整张座位表 |

### 3. 座位分配 (DRAG & DROP)
| 模块 | 已具备的能力 |
|------|--------------|
| **桌面端拖拽** | 拖学生到座位 / 拖座位中的学生到座位(交换) / 拖到学生区(下座) / 拖到删除区(彻底删) |
| **拖拽反馈** | 拖拽提示浮层、座位/名单/删除区高亮、被拖元素半透明 |
| **移动端触摸** | 自动检测 `(pointer: coarse) + (hover: none) + maxTouchPoints`,改用「点击选中 + 点击目标」两步式 |
| **移动端横幅** | 展示「已选中:XXX,请点击目标…」实时状态 |
| **座位删除按钮** | hover 时显示 × 按钮(签到模式下隐藏,改用 ✓ 图标) |
| **场景完整性** | 覆盖 4 种交换组合:学生↔学生、学生↔空、空↔学生、空↔空 |

### 4. 签到模式
| 模块 | 已具备的能力 |
|------|--------------|
| **模式开关** | 「签到模式」按钮进入,顶部绿色 Banner 提示,操作按钮变红色「退出签到」 |
| **座位点击** | 任意有学生的座位点击即可切换签到状态 |
| **批量操作** | Banner 内「重新签到」「全部签到」 |
| **可视化** | 已签到 = 绿色 ✓ 角标;未签到 = 红色 × 角标;座位入场动画 `checkinPop` |
| **统计切换** | 进入签到模式,统计卡片自动切换为「入座学生 / 已签到 / 未签到」 + 一条带百分比的进度条 |

### 5. 随机排座
| 模块 | 已具备的能力 |
|------|--------------|
| **完全随机** | 「随机排座」:打乱后填入前 N 个座位,空余座位留空(confirm 提示) |
| **快速入座** | 学生管理面板里的「随机入座」:只补齐空座位,不打乱已有安排 |
| **Fisher–Yates** | 实现了正确的洗牌算法 |

### 6. 撤销 / 重做
| 模块 | 已具备的能力 |
|------|--------------|
| **快照栈** | 最多 30 步,每次有副作用的操作前 `pushSnapshot` |
| **快捷键** | Ctrl/Cmd+Z 撤销,Ctrl+Y 或 Ctrl+Shift+Z 重做 |
| **应用范围** | 覆盖座位变更、分组删除、学生删除、行/列重置、批量分配、批量删除 |
| **按钮可用性** | undoStack / redoStack 长度变化时同步 disabled 状态 |

### 7. 配置管理
| 模块 | 已具备的能力 |
|------|--------------|
| **本地多配置** | localStorage 存多套配置(配置名 + 时间戳),可点击切换、双击重命名、× 删除 |
| **激活态** | 当前激活配置高亮显示 |
| **JSON 导入/导出** | 一键导出整个当前配置 / 从 .json 文件恢复 |
| **GitHub 同步** | 填写 owner / repo / path / Personal Access Token,可保存 / 测试连接 / 上传 / 下载 |
| **GitHub 容错** | 上传时若文件不存在则初始化创建;下载时若 404 给出明确提示 |
| **合并策略** | 下载采用 spread 合并本地 + 云端配置,避免数据丢失 |
| **清除数据** | 一键清空 localStorage 全部,带二次确认 |

### 8. 统计 & 行动入口
| 模块 | 已具备的能力 |
|------|--------------|
| **5 个统计块** | 总数 / 已入座 / 未入座(普通模式);入座 / 已签到 / 未签到(签到模式) |
| **点击统计块** | 弹出小菜单(锚定在统计块下方),可「复制姓名」「下载 Excel」 |
| **菜单智能定位** | 根据视窗边缘自动翻转菜单方向,避免溢出 |
| **剪贴板兜底** | 优先 `navigator.clipboard.writeText`,失败时回退 `document.execCommand('copy')` + 隐藏 textarea |
| **Excel 导出** | 列出姓名 / 分组 / 签到三列,自动加文件名后缀日期 |

### 9. 导出 / 打印
| 模块 | 已具备的能力 |
|------|--------------|
| **导出图片** | 通过 `html2canvas` + 克隆节点 + 临时挂载离屏,生成 2× scale 的 PNG |
| **文件名** | `<标题>_<日期>.png`,自动添加导出日期标签 |
| **打印 / PDF** | 监听 `matchMedia('print')` 变化,进入打印态时自动调用 `applyPrintScale` |
| **缩放算法** | `calculatePrintScale` 取宽高最小比例,保持宽高比不变填满 A4 横向留白 |
| **HTML 注释隐藏** | `.controls`、`.delete-zone`、`.drag-hint`、`.batch-toolbar`、`.checkin-banner`、`.app-info-modal`、`.no-print` 在打印态全部隐藏 |
| **打印色保证** | `-webkit-print-color-adjust: exact` + `print-color-adjust: exact` 全局生效 |

### 10. 响应式 / 设备适配
| 模块 | 已具备的能力 |
|------|--------------|
| **媒体查询断点** | 768px(平板/手机竖屏)、319px(超窄屏)、900px(控制面板与教室换行) |
| **触摸指针识别** | `pointer: coarse` + `hover: none` + `maxTouchPoints` 三合一检测 |
| **触摸态样式** | `@media (pointer: coarse)` 下取消 hover 抬升效果,改 `touch-action: manipulation` |
| **座位尺寸自适应** | `--seat-width` / `--seat-height` 用 CSS 变量,断点切换 |
| **控制面板宽度** | 桌面 320px / 移动端撑满屏幕 |
| **打印尺寸** | A4 横向 + 5mm 边距自定义 |

### 11. 无障碍 / 偏好
| 模块 | 已具备的能力 |
|------|--------------|
| **`:focus-visible`** | stat-block、stat-action-menu-item 都有可见焦点环 |
| **`:hover` 触控屏蔽** | `prefers-reduced-motion: reduce` 媒体查询关闭过渡动画 |
| **触摸反馈** | `-webkit-tap-highlight-color: transparent`,`touch-action: manipulation` |
| **键盘焦点可达** | app-version 是 `role="button" tabindex="0"`,监听 Enter / Space 打开 |
| **Esc 关闭弹窗** | app-info-modal、stat-action-menu 都响应 Escape |
| **role / aria** | `role="dialog" aria-modal="true"`、`role="status" aria-live="polite"`、`role="menu" / role="menuitem"` |
| **contenteditable 标题** | 标题可点击编辑,blur 时若空自动回填默认值 |

### 12. 其他体验细节
| 模块 | 已具备的能力 |
|------|--------------|
| **版本号弹窗** | 点击面板右上角版本号弹出「版权 / 作者 / 网站 / 协议」对话框,带 CC BY-NC-SA 说明 |
| **拖拽提示浮层** | 「拖放到座位或名单区域」中央暗色横幅提示 |
| **删除区浮动按钮** | 半透明圆角胶囊 + 🗑️ emoji,拖拽时下滑浮现,hover 删除目标时变红 |
| **自动保存** | localStorage 防抖 500ms,几乎无感 |
| **配色辅助** | `adjustColor`、`isLightColor` 自动调暗描边、选择合适前景色 |
| **国际化兜底** | preview 表头缺少时自动 `列 N` 兜底;分组列名包含「分组 / group / 班级 / class」自动选中 |

---

## 二、代码与产品优化建议

> 优先级:**P0**(影响可用性/安全/数据) → **P1**(明显改善体验) → **P2**(锦上添花)

### A. 架构与可维护性(P0/P1)

1. **【P0】拆模块,别再用单文件 IIFE 装 5934 行**
   - 当前是 `~2200 行 HTML 内联样式` + `~3000 行 JS 堆在一个 IIFE`,任何修改都要滚动很久。
   - **建议**:`external/` 下拆成 `style.css`、`app.js`(主入口)、`components/seats.js`、`components/groups.js`、`components/excel-io.js`、`components/github-sync.js`、`state.js`,保留一个单页模板 `seats-generator.html`。
   - **进度**:可分阶段,先抽 JS 到独立文件,再拆 CSS。

2. **【P0】统一状态管理,告别「手动 N 次 update」
   - 现在每个变更操作都得手动调 `updateStudentAssignmentDisplay()` + `generateSeats()` + `updateStatistics()` + `updateCheckinStats()` + `autoSave()`,容易漏调。
   - **建议**:极简状态中心:
     ```js
     const state = { students, groups, rows, cols, seats, aisles, view, checkinMode, batch, undo, redo };
     function setState(patch) { Object.assign(state, patch); bus.emit('change', state); }
     const bus = new EventTarget();
     bus.addEventListener('change', () => { renderAll(); autoSave(); });
     ```
     收口所有副作用,单测时只打桩 bus 即可。

3. **【P1】抽公共座位坐标工具**
   - `displayRow` / `displayCol` / `actualRow` / `actualCol` / 教师视角翻转,目前散落在 `generateSeats` 和 `generateGridTemplateColumns` 两处。
   - **建议**:`class SeatGrid { indexAt(r,c) }` 统一,视角相关计算只剩 2 个函数:`visualOrder` 和 `visualColumn`。

4. **【P1】撤/重做:基于命令而非快照**
   - 现在每次 `pushSnapshot` 都是深拷贝所有数据,30 步占内存不少。
   - **建议**:把操作抽象成 `{ do, undo }` 命令对象;只有真的执行命令时才入栈,内存占用降到 O(1) per step,顺便能可视化最近一次操作。

5. **【P1】HTML 字符串拼接 → DocumentFragment + createElement**
   - `updateStudentAssignmentDisplay` / `updateGroupDisplay` / `createPreviewTable` 都靠模板字符串。
   - 已经做了 `escapeHtml` 兜底,但仍存在维护风险(如忘记 escape、嵌入属性后 XSS)。
   - **建议**:封装 `<el('div', { class: '...'}, children)>` 的轻量 hyperscript;结构更清晰,属性注入天然防 XSS。

6. **【P2】引入 TypeScript / JSDoc**
   - `students: [{ id, name, groupId, checkedIn }]`、`configs: { [name]: Config }`、`aisles: [{ afterCol, width }]` 这些结构没在代码中显式声明。
   - **建议**:短期先加 `/** @typedef */` 注释 + JSDoc 类型检查;中长期用 `tsc --noEmit` 在 CI 跑一遍。

### B. 性能优化(P1)

1. **【P1】细粒度重渲染**
   - `generateSeats()` 重建整个 `classroom.innerHTML`,操作一次座位就 O(rows×cols) 次 DOM 创建/挂载。
   - **建议**:维护每个座位 `<div>` 引用,只更新变化的节点;首次 `generateSeats` 之外,改走 `diffSeats(oldSeats, newSeats)`。

2. **【P1】导出图片期间遍历 `document.querySelectorAll('button')`**
   - 4404 行 `document.querySelectorAll('button').forEach(b => b.style.visibility = 'hidden')`,把所有 button 都隐藏了——可能误伤其他无关 button。
   - **建议**:用 CSS 类 `.no-screenshot` 包住要隐藏元素,导出前加类,导出后移除。

3. **【P1】`html2canvas` 在大表格下慢且内存压力大**
   - 7×7 共 49 个座位时 2× scale 即可,如果未来支持 20×20(400)+ 大量走道+分组颜色,会变慢。
   - **建议**:
     - 文档自身 `Promise` + `await` 写法,加上 `try/catch` 兜底;
     - 或换成 `dom-to-image-more`(更轻);
     - 体验上给出「生成中…请稍候」loading。

4. **【P1】`JSON.parse(JSON.stringify())` 替换为 `structuredClone`**
   - 浏览器原生支持,深拷贝性能 + 正确性都更好,避免了 `Date / Map / Set / Function` 等类型丢失的坑。

5. **【P2】CSS 里的重复 `.teacher-desk`、`.seat-number`、`.student-list` 定义**
   - 老 CSS 没清干净,存在两套:
     - `211–228` `teacher-desk`(新)
     - `1097–1111` `teacher-desk`(旧)
     - `1113–1120` `seat-number` position absolute(旧)
     - `205–209` `seat-number` 普通(新)
     - 同样地 `student-list` 出现 2 次
   - **建议**:合并 / 删除老定义,避免「我改了一个不动」调试坑。

6. **【P2】CSS 魔法值散落**
   - `width: max-content` / `min-width: 0` / `flex: none` 在多处出现,语义重复。
   - **建议**:`--seat-flex: 0 0 auto` 等工具变量 / utility class。

### C. 安全与数据可靠性(P0/P1)

1. **【P0】GitHub PAT 以明文存在 localStorage**
   - 当前 `localStorage.setItem('githubSettings', JSON.stringify({ token }))` 是裸的。
   - **建议**:
     - 至少加明确警示「请勿在公用电脑保存 Token」;
     - 可选:**只在内存保留**,关闭页面即失效;
     - 如要做存储,使用 Web Crypto API `subtle.encrypt` + 派生口令(PBKDF2)加密,登录会话内存中临时解密。

2. **【P0】`githubApiRequest` 把 owner/repo 直接拼到 URL,没做 URL 编码**
   - 用户在 owner 输入特殊字符可能造成 API 路径异常甚至 SSRF 思路的攻击面。
   - **建议**:`encodeURIComponent(githubOwner.value.trim())`。

3. **【P1】Excel 导入无大小/行数限制**
   - `fileInput` 直接 `readAsArrayBuffer`,几 MB 或百万行的 Excel 都吃进内存。
   - **建议**:限 `<= 10 MB`, >5000 行时给警告;`XLSX.read` 用 `{ dense: true }` 省内存。

4. **【P1】`localStorage` 5MB 容量限制**
   - 多套配置 + 大量学生 + GitHub 同步 base64 编码,接近 5MB 时 `setItem` 静默抛错。
   - **建议**:
     - 用 `IndexedDB` 替代(`idb-keyval` 仅 1KB);
     - 存储失败时弹「即将溢出」提示 + 推荐导出 JSON。

5. **【P1】`atob(unescape(encodeURIComponent(...)))`**
   - 4604 行 `unescape` 已废弃,Edge 18+ 抛错。
   - **建议**:
     ```js
     const decoded = new TextDecoder('utf-8').decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
     ```

6. **【P2】`alert / confirm` 占主线**
   - 批量删除学生时 `confirm` 是阻塞的;移动端体验差。
   - **建议**:封装非阻塞确认 Dialog(目前已有 `.app-info-modal` 的样式可复用),支持二次撤销。

### D. 用户体验(P1/P2)

1. **【P1】点击统计块首次没反应**
   - 必须等到 `initStatBlockActions()` 跑完才绑定 click。在页面打开瞬间立刻点击可能无效。
   - **建议**:把 `initStatBlockActions()` 放到 `initialize()` 之后立即执行,或直接把所有监听挂在 `<body>` 上用事件委托。

2. **【P1】撤销栈清空 redo 是「直球」行为**
   - 任何状态变更就清掉 redo 栈,「先撤,再改一行,然后想重做回去」就不行了。
   - **建议**:业内惯例是「时间窗合一」(比如 200ms 内连续操作算一笔),或改成基于命令的栈。

3. **【P1】座位中的学生,点 × 按钮 vs 拖到删除区 → 行为不一致**
   - 点 × 是「删除学生并下座」,拖到删除区 confirm 提问后也是同效果,但移动端走的「点击选中→点击删除区」路径要不要也走 confirm?
   - **建议**:统一走「单次点击删除(可撤销)+ 二次确认对话框」的策略,操作一致。

4. **【P1】课堂演示时,「已分配 / 未分配」名单过长**
   - 学生名单只显示未安排的学生,班级 50 人全部分配后整个 panel 闲置。
   - **建议**:
     - 加 Tab 切换「全部 / 未入座 / 已入座 / 按分组」;
     - 支持搜索过滤(班级太大时找一个人要滑很久)。

5. **【P1】多配置切换时 seat/座位数发生缩放,可能让座位移动到错误位置**
   - 6503 行迁移逻辑有「按行列映射」的版本(`init` 时),但 `applyConfig` 不做迁移。原配置 8×8,新教室 6×6,导入时多余的 16 人直接被丢弃。
   - **建议**:每次 `applyConfig` 主动检查 `seats.length` vs `rows*cols` 并提供「保留哪些」的对话框。

6. **【P1】讲台位置在教师视角下仍写「讲台」,且与学生视角讲台宽度可能不一致**
   - 学生视角讲台在顶部 (`grid-column: 1 / -1`),教师视角讲台通过 `order: 9999` 移到末尾。
   - **建议**:讲台样式用同一个 class + 调整 order,而非定义两份。

7. **【P2】座位号「X排Y列」是死标签**
   - 大教室后排视觉上看不清。
   - **建议**:数字 + 颜色(如有特殊需求:门口 / 第一排 / 视力差座位等元数据)。

8. **【P2】教师视角下,讲台仍在底部,但「第三排第四列」对应的物理位置变了**
   - 在观众席场景里,学生说「我坐在第 3 排第 4 列」,教师视角会被翻转,容易误判。
   - **建议**:教师视角下,要么重排座位号,要么在 hover 时显示「实际相对位置」。

9. **【P2】快捷键仅 Ctrl+Z / Ctrl+Y**
   - 没有「保存为」「新建配置」「快速切换下一配置」「打印」的快捷键。
   - **建议**:在所有折叠面板内加快捷键 HINTS(footer 显示 ⌘+S 等)。

### E. 功能扩展建议(P1/P2,看产品定位)

1. **【P1】座位锁定**:对个别学生「锁定到某座位」(视障、特殊关照)。
2. **【P1】座位备注**:每个座位可加 `note`(身高/视力/性格标签),统计时筛选「前排高个子 + 后排近视」。
3. **【P1】一键按规则排座**:
   - 按身高(导入身高列)
   - 按性别(导入性别列)
   - 按分组(同组分散/同组相邻)
   - 按成绩(同档分散)
4. **【P1】导出**:
   - 导出 CSV / Markdown 座位表(`行,列,姓名,分组,签到`)
   - 多页导出(40 人拆 2 页打印)
5. **【P2】深色模式**:`prefers-color-scheme: dark` 一套变量切换。
6. **【P2】QR 码分享**:「无敏感信息」模式下导出 PNG,加 QR 链接到只读座位表 URL,学生手机扫码看自己的座位号。
7. **【P2】多班级并存**:同一域名下,让 URL `?class=三年级一班` 切换,避免切错班级。
8. **【P2】签到历史快照**:每次签到保存时间戳,期末导出「哪节课哪学生缺勤最多」报表。
9. **【P2】国际化(i18n)**:目前所有文案中文硬编码;抽 `t('signin.title')` 函数,后续 i18n 易做。

### F. 无障碍 / 国际化

1. **【P1】`:focus-visible` 还没覆盖所有交互元素**
   - `.action-btn` / `.sub-btn` / `.form-btn` 没有显式焦点环(只有 hover)。
   - 键盘 Tab 聚焦时位置不易看出。

2. **【P1】色彩对比度**
   - 浅绿背景 + 浅色字组,例如 25 种预设分组颜色 `#FCF3CF #E8DAEF #D6EAF8 ...`,落在浅色上可能对比不足。
   - **建议**:`isLightColor` 已经在用,已设置字色,但没考虑链接 / 边框对比度。

3. **【P1】stat-action-menu 是「隐藏菜单」**
   - 屏幕阅读器需要宣读「菜单已展开」。
   - **建议**:`aria-expanded`、`aria-controls`,焦点先入菜单并用 Tab 在 menuitem 间穿梭。

4. **【P2】`<h1>` 是 `contenteditable`,但没 `aria-label`**。
5. **【P2】没有 `lang` 之外的本地化日期格式化**(目前走 `toLocaleDateString()`,其实可改 `Intl.DateTimeFormat('zh-CN')`)。

### G. 文档 / 测试

1. **【P2】缺单元测试 / E2E**
   - 5934 行代码无任何测试覆盖。重构第一步就是先写 happy-path 测试(导入 Excel → 排座 → 导出)。
   - **建议**:
     - E2E:`@playwright/test`,跑通「导入 → 拖拽 → 导出图片」
     - 单元:Vitest 跑纯函数(`shuffle` / `migrateConfig` / `calculatePrintScale`)

2. **【P2】没有 CHANGELOG / 迁移说明**
   - `migrateConfig` 已经在管 v1 → v2,但开发者文档没记录字段含义。
   - **建议**:加 `docs/data-schema.md` 写明字段约束。

3. **【P2】代码风格不统一**
   - 命名混用:驼峰 + 下划线 + 中英混排(`webdav-status` / `webdavStatus` / `webdav-input`)。
   - **建议**:上 `eslint:recommended` + `prettier`,CI 自动校验。

---

## 三、可立刻动手的小修小补

> 如果时间紧,这些 1–2 小时就能做:

| 项 | 估时 | 影响 |
|----|------|------|
| 合并重复 CSS 定义 | 30 min | 体积 -10%,可维护性 +++ |
| `structuredClone` 替换深拷贝 | 15 min | 性能 + 安全性 |
| `encodeURIComponent` 包住 GitHub URL 变量 | 5 min | 安全 |
| URL 增加实例 ID(`?config=xxx`)| 30 min | 班级切换可靠性 |
| `appVersion` 用真实 npm/cpm 版本 + build 自动注入 | 15 min | 减少手动同步 |
| 给 `stat-block` 增加 `aria-expanded` / `aria-haspopup="menu"` | 20 min | 无障碍 |
| 抽出 GitHub token 的「只在内存保留」开关 | 1 h | 安全 |
| 折叠面板内部支持键盘 ←/→ | 30 min | 无障碍 |

---

## 四、总结

整体看,这是一个 **功能扎实、产品经验丰富** 的单文件应用:
- ✅ 完整覆盖了「导入 → 编辑 → 排座 → 导出」的教师日常动线;
- ✅ **响应式 / 触摸 / 打印 / 无障碍** 几条线都做过努力;
- ✅ 用了不少现代 API(`matchMedia` / `structuredClone`(待替换) / `navigator.clipboard` / 拖放 API)。

短板和机会点集中在三点:
1. **架构**:5934 行单文件,任何改动都要全文件 grep,真要长期维护,**第一步是模块化**。
2. **安全**:GitHub PAT 明文存储 + URL 拼接必须修。
3. **UX 一致性**:删除 / 撤销 / 切换视角的几个边缘行为不统一,容易让老师误操作丢数据。

如果让我选一个 **1 周专项** 的优先目标,会是:**模块化 + 状态中心 + GitHub 安全 + 共享 Excel 导出接口**。

---

*审查人:Frontend Developer · 审查时间:2026-09-04*
