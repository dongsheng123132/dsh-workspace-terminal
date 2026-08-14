# dsh-workspace-terminal

DeepSeek Harness 的 U-King 风格右侧多 Agent 终端插件。

- 在 DSH 对话标题栏或左侧底部打开右侧 Agent Dock；
- 多标签运行 Claude Code、Hermes、Codex 和普通 Shell；
- 每个标签一个真实 PTY，收起不停止，关闭标签才清理进程树；
- 当前 DSH 工作目录传给终端；
- DSH 可通过 `uking_terminal_list`、`uking_terminal_read`、`uking_terminal_send` 与右侧终端接力；
- 模型配置不在插件中重复实现：DSH 会话由自带模型选择或 `dsh-switch` 管理；Claude Code、Hermes、Codex 的跨 CLI 配置交给 U-King 管理。切换后新开终端生效。
- U-King 导流按钮只在用户点击时向本机 DSH 发送带随机令牌的同源 POST，再由宿主用无 shell 的系统命令打开默认浏览器；兼容会阻止外站导航的 DSH 应用内浏览器。

## 安装

```sh
dsh plugin --profile web add github:dongsheng123132/dsh-workspace-terminal#<commit>
dsh web
```

若同时安装现有的 `dsh-switch`，DSH 可以选择／探测模型；右侧终端则负责同时运行不同 CLI。二者分工明确，不会再造一份容易漂移的模型配置。

本地开发安装：

```sh
dsh plugin --profile web add "D:/uking编程/dsh-workspace-terminal"
```

## 安全边界

- 浏览器只能选择配置中声明的 launcher id，不能提交任意启动命令；
- WebSocket 同时校验同源 Origin 和进程期随机令牌；
- 子进程环境去除凭据形变量及旧 `DSH_*` 变量；
- 工作目录限制在 `allowedRoots` 内；
- 关闭标签或卸载插件会按 PID 清理完整进程树；
- DSH 协同工具只访问用户已经打开的终端，不能静默创建新终端。

## 开发

```sh
npm install
npm run check
```
