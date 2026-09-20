# 项目长期约定 — huangdiv.com 座位表

> 项目 = huangdiv.com(Hugo 静态博客)+ `static/seats-generator.html`(纯前端班级座位表工具)。
> **完整经验归档见 `.workbuddy/ARCHIVE.md`**(2026-09-20 压缩沉淀,新会话优先读它)。

## 仓库布局(2026-09-20 更新:workspace 已转为健康独立仓库)
- **开发目录 = 提交仓库(唯一)**:`C:/Users/xingz/WorkBuddy/Worktrees/huangdiv.com/master-93f997c3`
  - ⚡ 2026-09-20 修复:原先损坏的 worktree 指针已换成健康 clone 的 `.git` 真目录
    ⇒ **`HEAD`=`master`=`origin/master`=`ca93199`,status 干净,直接 `git add/commit/push`**
  - 绕行仓已隔离到 `C:/Users/xingz/WorkBuddy/_cleanup_backup_seats_2026-09-20/quarantine-workarounds-2026-09-20/`
    (含旧 `recover-huangdiv`/`recover-huangdiv2`/`_tmp_clone_huangdiv`/原主仓 `D:/Documents/GitHub/huangdiv.com`)
- 远程:`https://github.com/huangdiv/huangdiv.com.git`(org = `huangdiv`,不是 xingz-io)
  - **公开仓库**;`.workbuddy/` 已纳入 git(知识文档 + 全量冒烟测试),便于换机/云端续开发
  - 同仓库还有别的工具:`static/ClassMaster.html`(班级管家,其他会话开发)、`static/jumpto.html`
  - 提交基线:seats-generator 代码 = `fb4de80`(此后未改);当前 master tip = `ca93199`
- 行尾约定:workspace 文件为**混合 CRLF/LF**;已设本地 `git config core.autocrlf input`
  (检出不动、比较时把 CRLF 归一为 LF)以免出现大量假 `M`。勿改成 `true`(会让 LF 文件全变脏)

## 推送注意
- 存在**并行会话**改同一仓库 ⇒ push 前务必 `git fetch` + `git log --oneline origin/master` 看分叉
- 遇到 non-fast-forward:**不要 rebase**,用 `git fetch` + `git reset --soft origin/master`
- `git push origin master` 走 GCM,前台秒级完成(旧 wincred 后台 2h41m 经验已过时)
- **本机 git 写不了 `refs/remotes/origin/*`**(2026-09-20 探针确认):`update-ref refs/remotes/origin/x`
  静默失败,且会删掉已存在的 loose ref 文件(连目录一起) ⇒ `fetch`/`push` 后 `origin/master` 可能不自动更新。
  同步法:用 `git ls-remote origin master` / `.git/FETCH_HEAD` 取真实 40-hex,
  直接改 `.git/packed-refs`(loose ref 会被 git 删,别指望它),再 `sed -i '/^$/d'` 清空行;
  必须 40-hex 全量。详见 ARCHIVE §2.2
- 主分支保持单段名 `master`(提交本身正常,只有 `refs/remotes/*` 写入受影响)

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
