# 修复:下拉按钮一次点击即弹出 + 三个快捷按钮等高

commit `5634ca5`(773d3e1 → 5634ca5),2 文件 +31/−9,已推送 origin master。

## 问题一:下拉按钮有时要点两下

### 根因

`setupActionDropdown` 用闭包变量 `isOpen` 记录开关状态,但两个下拉**互斥关闭时只改了对方的 `style.display`,没同步对方的 `isOpen`**:

```js
// 原代码 —— 只关 DOM,对方闭包里的 isOpen 还停在 true
if (peerDropdown.style.display === 'block') {
    peerDropdown.style.display = 'none';
    peerBtn.setAttribute('aria-expanded', 'false');
}
setOpen(!isOpen);
```

于是:

1. 点「智能排座」下拉 → 打开,`isOpen(random) = true`
2. 点「打印/PDF」→ print 打开,random 的 DOM 被关掉,但 `isOpen(random)` 仍是 `true`
3. 再点「智能排座」→ 执行 `setOpen(!true)` = **关闭** → 打不开
4. 再点一次 → 才打开

这解释了为什么是「有时候」——取决于上一次操作的是不是另一个下拉。

### 修复

1. **WeakMap 注册表**(`dropdown` 元素 → controller),互斥关闭改走对方的 `close()`,
   同步 `isOpen` 与 `aria-expanded`
2. **双保险**:翻转状态改为以 DOM 实际显示为准
   `setOpen(dropdown.style.display !== 'block')`,
   将来即使有别的代码直接改 display 也不会失步
3. `close()` 改为无条件 `setOpen(false)`,把 DOM 收干净

> 通用教训:UI 开关状态用闭包变量维护时,任何「外部直接改 DOM」的路径都必须同步该变量;
> 更稳的做法是让 DOM 成为唯一真相源。

## 问题二:按钮高度不一致

实测:切换模式 **78px**、打印/PDF **78px**、智能排座分段 **81px**(下段 25px 偏高)。

### 修复

- 下段 `.action-btn-split-caret` padding 由 `3px 6px 7px` 收到 `2px 6px 5px`
  ⇒ 两段自然高度 57+22−1 = **78px**
- 更关键的改进:`.action-btn-wrapper > .action-btn` 由 `flex:none` 改为 `flex:1 1 auto`,
  `.action-btn-split-main` 设 `flex:1 1 auto`
  ⇒ 三者参与 flex 拉伸**自动等高**,不再依赖写死的像素值,字体或内容变化也不会失配

实测结果:mode / print / split 均 **78px**,顶边 `359.1`、底边 `437.1` 三者完全对齐。

## 测试

新增 `.workbuddy/smoke_test_batch18_dropdown_once_click.py`(15 项):

- 三按钮等高 + 顶边/底边对齐
- 上下两段无缝(缝 −1px,即共享边框)
- 首次点击即弹出 + `aria-expanded` 同步
- **【关键】互斥切换后一次点击即开** ← 原 bug 高发点
- 连续交替 8 次每次都一次打开
- 点过菜单项后再点仍一次打开

**已验证测试有效性**:把点击逻辑改回 buggy 版本后,2 项失败——
「切回 random 一次点击」实际为 `none`、交替 8 次中有 3 次未打开,与用户描述完全吻合;
恢复修复后 15/15 通过。

回归全绿:单元 5 文件 + batch1–17 + dragdrop / seat_grid / e2e / quickwins / random_arrange。

## 需要你知道的一件事:推送仓库已更换

推送时遇到 non-fast-forward,发现远程多了一个**其他会话**提交的 `773d3e1`
(ClassMaster.html 座位方格正方形化)。我用 `git pull --rebase` 整合时被 SIGTERM 中断,
结果 **`recover-huangdiv` 的 `.git/refs` 目录被删,12 个 commit 被 GC 清空**。

所幸远程已保存 78d7d2d 及之前的全部提交,工作区源文件也完好,因此:

- 全新克隆到 **`C:/Users/xingz/WorkBuddy/recover-huangdiv2`**,复制改动文件重新提交推送
- **后续提交/推送请改用 recover-huangdiv2**,原 `recover-huangdiv` 已废弃
- 教训与预防方法(沙箱内禁用 rebase,改用 fetch + `reset --soft`)
  已写入用户级 `~/.workbuddy/MEMORY.md` 与项目级 `.workbuddy/memory/MEMORY.md`
