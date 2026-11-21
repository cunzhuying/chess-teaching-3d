# 证据索引

本目录区分两类证据，避免把“开发过程截图”和“作品实际效果截图”混在一起。

## actual/：作品实际效果

| 文件 | 内容 | 说明 |
|---|---|---|
| `01-export-success.png` | 点击“导出棋谱”后的成功提示 | 1440×1240，当前版本，页面提示 `已导出棋谱：chess-20261121-2359.pgn` |
| `02-export-button.png` | 走子历史区的“导出棋谱”按钮 | 同一次实测，按钮已启用 |
| `03-export-pgn.png` | 实际下载的 PGN 文件内容 | 由浏览器打开真实 `.pgn` 文件后截图 |
| `04-step5-warning.png` | 当前版本的送子警告 | 局面：白后 d1、黑车 d8；悬停 d7 时提示“损失 9 分” |
| `05-online-host.png` | PeerJS 联机房主界面 | 6 位房间号、已连接状态 |
| `06-mobile.png` | 手机端 390×844 界面 | 当前版本，触屏选子/预览/落子 |
| `07-board.png` | 3D 木质棋盘 | 项目文档截图 |
| `08-ghost.png` | 虚影走法预测 | 项目文档截图 |
| `09-sample-game.pgn` | 实际导出的样例棋谱 | 由页面点击导出生成，不是手写 |

> `01`、`03`、`09` 来自同一次真实操作；`04` 使用当前版本页面和真实引擎计算。

## codearts/：华为云码道真实使用

| 文件 | 内容 |
|---|---|
| `01-task-complete.png` | 码道任务完成页：76 项测试、构建成功、commit `a71980a`、5 files/317 insertions |
| `02-code-pgn-terminal.png` | 码道 IDE：`pgn.ts` 源码 + 终端 `git show --stat a71980a` |
| `03-ai-prompt.png` | 码道对话：完整“导出棋谱”提示词与任务完成回复 |
| `04-code-pgn.png` | 码道 IDE：项目文件树与 `pgn.ts` 代码 |

详细说明见 `submission/码道使用证明.md`。

## 复核命令

```powershell
cd C:\Users\18043\codearts\chesssssss
git show --stat a71980a
npm test
npm run build
```
