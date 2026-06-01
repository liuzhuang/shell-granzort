# Shell 管理（v3）

基于 Electron + React + TypeScript 的桌面应用，使用 YAML 作为唯一配置源来管理 Shell 命令、预设与查询能力。

## 环境要求

- macOS（当前主要在 macOS 上开发）
- Node.js `>= 20`（建议使用 LTS）
- npm `>= 9`

可用以下命令确认版本：

```bash
node -v
npm -v
```

## 开发环境构建与运行

### 1) 安装依赖

在项目根目录执行：

```bash
npm install
```

### 2) 启动开发环境

```bash
npm run dev
```

说明：
- 会启动 Electron + Renderer（Vite）开发模式
- 支持主进程、预加载、前端代码联动开发

### 3) 类型检查（建议开发时常用）

```bash
npm run typecheck
```

## 生产环境构建

### 1) 执行构建

```bash
npm run build
```

### 2) 构建产物目录

构建完成后会生成：

- `dist/main`：Electron 主进程产物
- `dist/preload`：Preload 脚本产物
- `dist/renderer`：前端页面静态资源产物

### 3) 预览构建结果（可选）

```bash
npm run preview
```

> 说明：当前脚本已完成“生产构建”，但尚未接入安装包打包（如 `.dmg`）流程。若需要分发安装包，可在下一步接入 `electron-builder` 或 `electron-forge`。

## 常用命令汇总

```bash
npm run dev        # 开发环境
npm run typecheck  # TS 类型检查
npm run build      # 生产构建
npm run preview    # 构建结果预览
```

## ShellManage Assistant Skill（推广与配置引导）

Skill 源码位于 `skills/shell-manage-assistant/`（**不是** `.cursor/skills/`，后者是用户安装目录）。

用途：

- 指导同事下载、安装、升级 `shell-manage`
- 回答 ShellManage 使用问题
- 按标准流程引导配置变更（先校验、后确认、再写入）

配套知识库已内置在 `skills/shell-manage-assistant/references/`，其中下载入口由 `references/distribution-manifest.yaml` 维护（当前清单为模板占位符，需替换为真实分发 URL/SHA 后才能用于生产安装引导）。

安装方式见 [skills/shell-manage-assistant/INSTALL.md](skills/shell-manage-assistant/INSTALL.md)。
