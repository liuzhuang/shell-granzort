# Cursor / CC 统一协议

本文件定义 `shell-manage-assistant` 在不同运行环境的一致行为。

## 共同底线

不管在 Cursor 还是 CC，回答都必须包含：

1. 下一步怎么做
2. 成功判定标准
3. 回滚方案
4. 是否已实际写入配置

## 写入状态标记

统一使用以下状态之一：

- `write_status: not_written`
- `write_status: written`

## 输入缺失时的最小提问

优先只问一个关键问题：

- 需要改配置时：`配置文件绝对路径是什么？`
- 需要接入项目时：`项目绝对路径是什么？`
- 需要下载安装时：`你是 Apple Silicon 还是 Intel Mac？`

## 标准输出模板（所有运行环境）

```markdown
阶段: <install/config/qa/troubleshoot>
write_status: <not_written|written>

下一步:
1. ...
2. ...

成功判定:
- ...

回滚:
- ...
```

说明：

- `阶段` / `write_status` / `下一步` / `成功判定` / `回滚` 为强制字段，不得改名或删减。
- 需要给可复制命令时，可在 `下一步` 中内嵌命令块，不新增平行模板。

## 交互差异约束

- Cursor：可以展示文件路径与拟变更摘要，适合确认后写入。
- CC：优先给可复制命令块与简短步骤，但仍使用同一标准字段模板。
