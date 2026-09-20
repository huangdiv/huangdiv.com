# 任务总览:多选 + 轮换溢出 + 配对修复 + 普通模式多选

commit **4b90add**,已推 origin master(`53f733c → 4b90add`),7s 完成。

## 需求(5 子项)
1. 分组 banner 多选时新增「取消选择」按钮
2. 分组轮换溢出学生 → 自动归入即将轮换到分组 i 座位的上游组 `(i-offset+n)%n`,并给出提示
3. 随机排座 / 分组轮换落座后,共享的 attemptPairRepair 同区换座修复强制/回避配对;尝试 maxAttempts 次仍不满足 → warning 提示并保留当前座位
4. 配对设置弹窗按满足情况实时着色(绿/橙红/灰)
5. 普通模式迁移多选能力 + 三槽统计栏 + 点击空白区域取消

## 实现
- `static/seats-generator.js/.html/.css` + `static/modules/{messages,random-arrange,seat-grid}.js`
- 共享 pair-repair helper(`attemptPairRepair` / `applyPairRepairToSeats` / `getPairStatus`)
- bus 订阅触发配对弹窗刷新

## 测试结果(全绿)
- 单元 5 文件(unit_messages / unit_migrate / unit_random_arrange / unit_rotate_groups + 单元运行入口)
- 冒烟 batch3/5/6/8/9/10/11/12/13/14/15 + dragdrop / seat_grid / e2e_happy_path
- 0 致命 console.error

## 关键 commit
| commit  | 内容 |
|---------|------|
| eb3717a | pairSettings 进入随机排座下拉 |
| 036c19f | 切换模式 → 三态轮换 + banner 风格统一 |
| 46a6538 | 模式按钮等高 + banner 两行 + 长按删除分组 + 视角切换修复 |
| 7cf0546 | 分组轮换 + 轮换设置弹窗 |
| 30fba45 | 分组模式查看态 + 统计栏 |
| 53f733c | 分组模式多选焦点优化(移除「点学生高亮所属组」) |
| **4b90add** | **本批次:5 子项** |
