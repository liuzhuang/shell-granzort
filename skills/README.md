# ShellManage Skills（分发目录）

本目录存放 **可安装的 Skill 源码**（[Agent Skills](https://agentskills.io/) 开放格式），供用户自行安装到 Cursor、Claude Code、VS Code Copilot 等兼容客户端。

`.cursor/skills/` 是 Cursor 的**用户安装目录**，不应把 Skill 源码直接提交到那里。

## 当前 Skill

| Skill | 源码路径 | 知识库 |
|-------|----------|--------|
| shell-manage-assistant | `skills/shell-manage-assistant/` | `skills/shell-manage-assistant/references/` |

## 目录结构（Agent Skills 规范）

```
skills/shell-manage-assistant/
├── SKILL.md              # 主指令（<500 行，渐进式披露）
├── INSTALL.md            # 安装说明
├── references/           # 详细参考（按需加载）
├── scripts/              # 非交互辅助脚本（--help）
└── evals/evals.json      # 回归测试 prompt
```

## 安装路径

| 客户端 | 用户级 | 项目级 |
|--------|--------|--------|
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| VS Code / Copilot | — | `.agents/skills/` 或 `.github/skills/` |
| Claude Code | CC skills 目录 | 项目 `.agents/skills/` |
| 跨客户端互通 | `~/.agents/skills/` | `.agents/skills/` |

详见 [shell-manage-assistant/INSTALL.md](shell-manage-assistant/INSTALL.md)。

## 快速安装（Cursor，在仓库根目录）

```bash
mkdir -p ~/.cursor/skills
ln -sf "$(pwd)/skills/shell-manage-assistant" ~/.cursor/skills/shell-manage-assistant
```

## 架构

```
skills/shell-manage-assistant/   ← Skill 行为规则（怎么做事）
skills/.../references/           ← 随 Skill 打包的关键知识（默认）
~/.cursor/skills/                ← Cursor 用户安装位置
.agents/skills/                  ← 跨客户端项目安装位置
```

## 开放格式兼容性

本 Skill 遵循 [agentskills.io](https://agentskills.io/) 规范：`SKILL.md` frontmatter、渐进式 `references/`、可选 `scripts/` 与 `evals/`。兼容 Cursor、Claude Code、VS Code Copilot 及支持 `.agents/skills/` 的其他客户端。
