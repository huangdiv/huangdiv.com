# BUG 修复:教师视角拖拽后座位表「翻回学生视角」

commit `78d7d2d`(7b2f46f → 78d7d2d),2 文件 +29/−11,已推送 origin master。

## 现象

教师视角下拖动学生排座位后:

- 座位表区域**看起来切回了学生视角**(学生整体镜像翻转)
- 但讲台位置、切换按钮文字仍是教师视角
- 拖动落点与目标位置颠倒

学生视角下完全正常。

## 根因

`static/modules/seat-grid.js` 里两个函数的「索引语义」不一致:

| 函数 | 数组下标含义 |
|------|-------------|
| `fullRebuildSeats` | **DOM 追加顺序**(教师视角下是镜像的) |
| `diffUpdateSeats` | **state.seats 真实索引**(它直接取 `state.seats[i]`) |

教师视角下 `resolveSeatCoord` 做了 `rows-1-row / cols-1-col` 镜像,
所以 DOM 追加顺序第 k 个节点的 `data-index` 并不等于 k:

```
教师视角 4×4: DOM 前 4 个座位的 data-index = [15, 14, 13, 12]
```

于是每次 diff 更新都把 `state.seats[k]` 填到 `data-index=mirror(k)` 的节点上,
整表内容按学生视角顺序重排 —— 而讲台节点和 `isTeacherView` 变量并未改变,
这就造成了「讲台/按钮是教师视角、座位内容是学生视角」的割裂状态。

学生视角下 DOM 顺序恰好等于 seatIndex,所以这个 bug 从不暴露。

**影响面不止拖拽**:任何走 diff 路径的更新都会触发 —— 签到打卡、分组着色、
学生图标开关等。

## 修复

`fullRebuildSeats` 改为以真实座位索引为下标写入,DOM 追加顺序仍保持视觉镜像,
两者解耦:

```js
// 改前(按 DOM 顺序 push)
seatNodes.push(seat);
seatStateCache.push(takeSeatSnapshot(seatIndex));

// 改后(按下标 = 真实座位索引)
seatNodes[seatIndex] = seat;
seatStateCache[seatIndex] = takeSeatSnapshot(seatIndex);
```

这也落实了文件顶部注释早就声明、但实现没跟上的契约:
`seatNodes[i] 为 seatIndex=i 的持久 DOM 节点`。

## 顺带加固

`static/modules/dragdrop.js` 新增 `targetEl(e)` helper:
拖拽事件的 `e.target` 落在文本节点上时是 `Text` 节点,没有 `closest()`,
会抛 `e.target.closest is not a function` 并中断整个 drop 流程。
现统一收敛成元素后再取 `closest`,覆盖 dragstart / dragenter / dragleave / drop。

## 测试

新增 `.workbuddy/smoke_test_batch17_teacher_view_drag.py`(13 项):

1. 教师视角 DOM 前 4 座 data-index 为镜像 `[15,14,13,12]`
2. 初始渲染 data-index 与 seats 一致
3. 拖到空座后 state 与 DOM 均正确
4. 座位间交换后一致
5. 讲台仍在座位之后(教师视角)
6. 切换按钮仍显示「学生视角」
7. 学生视角对照组(防回归)
8. 连续 5 次拖拽不漂移 + 占座总数守恒
9. 无 JS 报错

**已验证测试有效性**:临时把代码改回 buggy 写法后跑,5 项失败,
报错正是 `index 0 显示 s1 但 state 说它是空`(即整表翻回学生视角);
恢复修复后 13/13 通过。

回归全绿:单元 5 文件 + batch1–16 + dragdrop / seat_grid / e2e /
p1_quickwins / random_arrange。
