# 安装 shell-manage-assistant

本目录是 **Skill 源码**（[Agent Skills](https://agentskills.io/) 开放格式），不是客户端的安装目录。  
用户需自行安装到对应客户端的 skills 目录。

## 目录关系

| 路径 | 作用 |
|------|------|
| `skills/shell-manage-assistant/` | Skill 源码（本目录，随仓库分发） |
| `skills/shell-manage-assistant/references/` | 随 Skill 打包的关键知识（安装、配置、排障） |
| `~/.cursor/skills/shell-manage-assistant/` | Cursor 用户级安装目录 |
| `.agents/skills/shell-manage-assistant/` | 跨客户端互通的项目级安装目录 |

Skill 安装后默认读取本地 `references/`。

## Cursor（用户级，推荐 symlink）

在 shell-manage 仓库根目录执行：

```bash
mkdir -p ~/.cursor/skills
ln -sf "$(pwd)/skills/shell-manage-assistant" ~/.cursor/skills/shell-manage-assistant
```

默认即可工作。

## VS Code / GitHub Copilot（项目级）

在项目根目录：

```bash
mkdir -p .agents/skills
ln -sf "$(pwd)/skills/shell-manage-assistant" .agents/skills/shell-manage-assistant
```

Copilot 也支持 `.github/skills/`；`.agents/skills/` 为跨客户端互通约定。

## Claude Code

将本目录复制或链接到 CC 的 skills 目录（路径因环境而异）即可使用。

## 复制安装（非 symlink）

```bash
mkdir -p ~/.cursor/skills
cp -r skills/shell-manage-assistant ~/.cursor/skills/
```

复制方式下同样可直接使用。

## 验证

```bash
bash skills/shell-manage-assistant/scripts/resolve-knowledge-root.sh --json
bash skills/shell-manage-assistant/scripts/validate-config-structure.sh default-config.yaml
```

在 Cursor 中提问：

> 我要怎么下载安装 shell-manage？

期望：Skill 被触发，给出安装步骤、成功判定与失败兜底，且下载信息来自 `references/distribution-manifest.yaml`（或外部覆盖源）。

## 卸载

```bash
rm ~/.cursor/skills/shell-manage-assistant
# symlink 安装时删除链接即可；复制安装时删除整个目录
```
