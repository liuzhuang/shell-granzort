# ShellManage 配置结构说明

## 顶层结构

配置文件必须包含以下顶层字段：

- `commands`: 命令数组
- `presets`: 预设数组
- `settings`: 全局设置对象

## commands 条目

每个命令建议包含：

- `name`（必填）：命令显示名，需唯一
- `command`（必填）：完整 shell 命令，一行字符串
- `tags`（必填）：标签数组，至少一个标签
- `mode`（建议）：默认 `service`，交互场景用 `terminal`
- `sshKeyId`（可选）：SSH 命令绑定密钥 ID
- `webUrl`（可选）：服务访问地址，如 `http://localhost:3000`

## presets 条目

- 用于组合多个命令形成启动场景
- Skill 在常规接入流程中不主动改动 `presets`

## settings 对象（常见字段）

- `llm`: 模型服务配置
- `themePreset`: 主题配置
- `logBufferLines`: 日志缓存行数
- 可能包含 `tagOrder`、`sshKeys` 等扩展字段

## Skill 写入约束

1. 默认只新增/更新 `commands`。
2. 未经二次确认，不改 `settings` 和 `presets`。
3. 写入后必须重新校验结构完整性。
