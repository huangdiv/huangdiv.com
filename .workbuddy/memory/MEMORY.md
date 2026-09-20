# 项目长期约定 — huangdiv.com 座位表

> 项目 = huangdiv.com(Hugo 静态博客)+ `static/seats-generator.html`(纯前端班级座位表工具)。
> **完整经验归档见 `.workbuddy/ARCHIVE.md`**(2026-09-20 压缩沉淀,新会话优先读它)。

## 仓库布局(2026-09-09 更新)
- **开发目录(改代码)**:`C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3`
  - 它是 worktree,`.git` 管理目录历史上多次损坏(`not a git repository: (NULL)`)
    ⇒ **不在这里做提交/推送**,只改文件
- **提交/推送仓库**:`C:/Users/xingz/WorkBuddy/recover-huangdiv2`
  - 原 `recover-huangdiv` 的 `.git` 已于 2026-09-09 损坏,已废弃,不要再使用
  - 流程:`cp` 开发目录改动文件 → recover-huangdiv2 → `git add/commit/push`
- 远程:`https://github.com/huangdiv/huangdiv.com.git`(org = `huangdiv`,不是 xingz-io)
- 权威提交(2026-09-20):`fb4de80`

## 推送注意
- 存在**并行会话**改同一仓库 ⇒ push 前务必 `git fetch` + `git log --oneline origin/master` 看分叉
- 遇到 non-fast-forward:**不要 rebase**,用 `git fetch` + `git reset --soft origin/master`
- `git push origin master` 走 GCM,前台秒级完成(旧 wincred 后台 2h41m 经验已过时)
- **嵌套 ref bug**(间歇):commit/push 后 ref 可能不落盘甚至被删 ⇒ 用 `git fsck --no-reflogs`
  取 `dangling commit <40hex>`,再 `mkdir -p + printf '<40hex>\n'` 手写 loose ref;
  必须 40-hex 全量。`sed` packed-refs 后要 `sed -i '/^$/d'`。详见 ARCHIVE §2.2

## 测试约定
- 单元:`bash .workbuddy/run_unit_tests.sh`(Node ESM,`static/tests/unit_*.mjs`,共 7 文件)
- 冒烟:Playwright,`.workbuddy/smoke_test_batch*.py`,需先在 `static/` 起
  `python -m http.server 8123 --bind 127.0.0.1`
  (跑 15~25 分钟会半挂:curl 200 但 goto 超时 ⇒ 重启即可)
- URL 一律用 `127.0.0.1` 不用 `localhost`(后者可能解析到 ::1 导致挂起)
- **写完新测试必须回退验证**:临时改回 buggy 写法跑一遍确认测试会红,再改回来
- 本地预览(127.0.0.1/localhost)下暴露 `window.__seatsTest`
  (rotateGroupSeats / randomSeatArrange);`?debug=1` 下暴露 `window.__undoTest`

## 架构要点
- 主文件 `static/seats-generator.js`(IIFE);模块 `static/modules/`:
  state / migrate / seat-grid / dragdrop / random-arrange / messages
- 工厂模式:`createSeatGrid / createDragdrop / createRandomArrange`(deps 显式注入)
- state 变更走 `commit(patch)` 派发,渲染/自动保存订阅 bus
- `seat-grid.js` 持久化节点 + `computeStructureKey()` 决定全量重建 or per-seat diff
- 事件委托非妥协:座位/banner 内按钮全部委托 `#classroom` 或父容器
- 写回 seats **必须就地赋值**保持引用,勿 `state.seats = [...]` 重赋值(会断别名)
