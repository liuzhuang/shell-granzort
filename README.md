# ShellManage

基于 **Electron**、**React** 与 **TypeScript** 的桌面应用，以 **YAML** 为唯一配置源，在界面中管理 Shell 命令、预设、终端与仪表盘等能力。

## 功能概览

- **通过 UI 启动项目**：在图形界面中选择并启动已配置的项目与工作流，无需在终端里手动敲路径或命令。
- **YAML 驱动**：配置即数据，支持可视化编辑与校验。
- **AI 辅助日志命令**：结合 LangChain / LangGraph 等能力，由 AI 根据上下文**生成或补全**与日志查看、检索相关的 Shell 命令（具体效果依赖模型与提示策略）。
- **终端与进程**：集成终端模拟与进程管理（本地 Shell 会话）。
- **监控**：提供监控与仪表盘相关界面与能力，**当前仍是短板**，后续会持续加强可观测性与稳定性（如指标、告警、历史对比等）。
- **自动更新**：集成 `electron-updater`（需按你的发布渠道配置更新源）。

## 环境要求

- **macOS**（当前主要开发与验证平台）
- **Node.js** `>= 20`（建议使用 LTS）
- **npm** `>= 9`

```bash
node -v
npm -v
```

## 安装依赖

在项目根目录：

```bash
npm install
```

安装后会执行 `postinstall`，对 `node-pty` 等原生模块做 **Electron  ABI 重编译**（`electron-rebuild`）。若失败，可手动执行：

```bash
npm run rebuild:native
```

## 开发

```bash
npm run dev
```

会启动 Electron 主进程、预加载脚本与 Renderer（Vite）开发模式，支持热更新联动。

**类型检查：**

```bash
npm run typecheck
```

## 构建

**标准生产构建（不打包安装包）：**

```bash
npm run build
```

产物目录：

| 路径 | 说明 |
|------|------|
| `dist/main` | Electron 主进程 |
| `dist/preload` | Preload 脚本 |
| `dist/renderer` | 前端静态资源 |

**预览构建结果：**

```bash
npm run preview
```

## macOS 安装包与发布

使用 **electron-builder** 生成 `.dmg` 等产物（配置见 `package.json` 的 `build` 字段）：

```bash
npm run build:installer:mac
```

校验安装包（脚本见 `scripts/verify-installer.sh`）：

```bash
npm run verify:installer:mac
```

一键：构建安装包并校验：

```bash
npm run e2e:installer:mac
```

完整发布流程（脚本见 `scripts/release-mac.sh`）：

```bash
npm run release:mac
```

## 端到端测试

依赖 **Playwright**，会先执行生产构建再跑测试：

```bash
npm run test:e2e              # 无头
npm run test:e2e:headed       # 有界面
```

布局稳定性相关用例（独立配置 `playwright.video.config.ts`）：

```bash
npm run test:e2e:layout:video
```

## 版本号

仅递增 `package.json` 版本（不打 git 标签）：

```bash
npm run bump:patch
npm run bump:minor
npm run bump:major
```

## 致谢与开源引用

本项目构建于大量优秀的开源软件之上，特此致谢（按技术领域分组，排名不分先后）：

| 项目 | 说明 |
|------|------|
| [Electron](https://www.electronjs.org/) | 跨平台桌面应用运行时 |
| [React](https://react.dev/) | UI 库 |
| [TypeScript](https://www.typescriptlang.org/) | 类型化的 JavaScript 超集 |
| [Vite](https://vitejs.dev/) | 前端构建与开发服务器 |
| [electron-vite](https://electron-vite.org/) | Electron + Vite 一体化工程方案 |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | Vite 的 React 插件 |
| [CodeMirror 6](https://codemirror.net/) | 编辑器内核；YAML 语言包 [@codemirror/lang-yaml](https://github.com/codemirror/lang-yaml) |
| [xterm.js](https://xtermjs.org/) | 终端模拟器 UI（`@xterm/xterm`、`@xterm/addon-fit`） |
| [node-pty](https://github.com/microsoft/node-pty) | 伪终端，驱动真实 Shell 会话 |
| [js-yaml](https://github.com/nodeca/js-yaml) | YAML 解析与序列化 |
| [chokidar](https://github.com/paulmillr/chokidar) | 文件监听 |
| [shell-env](https://github.com/sindresorhus/shell-env) | 获取登录 Shell 环境变量 |
| [tree-kill](https://github.com/pkrumins/node-tree-kill) | 进程树终止 |
| [LangChain](https://github.com/langchain-ai/langchain) / [@langchain/core](https://github.com/langchain-ai/langchainjs) | LLM 应用编排 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 图状态与 Agent 工作流 |
| [@langchain/langgraph-checkpoint-sqlite](https://github.com/langchain-ai/langgraphjs) | LangGraph 的 SQLite 检查点（依赖 SQLite 原生绑定生态） |
| [Deep Agents](https://github.com/langchain-ai/deepagents) | 深度 Agent 能力封装 |
| [electron-builder](https://www.electron.build/) | 应用打包与安装包生成 |
| [electron-updater](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater) | 应用内自动更新 |
| [@electron/rebuild](https://github.com/electron/rebuild) | 为 Electron 重编译原生 Node 模块 |
| [Playwright](https://playwright.dev/) | 端到端与浏览器自动化测试 |

若你分发本应用的二进制或安装包，请同时遵守各依赖的许可证要求（多数为 MIT / Apache-2.0 等，请以各包 `package.json` 与仓库声明为准）。

---

**许可证**：本项目以 `package.json` 中的 `license` 字段为准（当前为 ISC）。
