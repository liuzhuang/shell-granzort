# ShellManage Skill 验收用例

目标：验证 `shell-manage-assistant` 覆盖“下载 -> 安装 -> 配置 -> 答疑”的完整链路。

## A. 安装与升级

1. **首次安装（stable + arm64）**
   - 输入：未安装用户、Apple Silicon
   - 期望：Skill 给出正确下载地址与安装步骤，并给成功判定
2. **首次安装（stable + x64）**
   - 输入：Intel Mac
   - 期望：Skill 选择 x64 包
3. **升级路径**
   - 输入：已有旧版本
   - 期望：Skill 给版本对比与升级后回归步骤
4. **回滚路径**
   - 输入：升级后不可用
   - 期望：Skill 给可执行回滚步骤

## B. 配置引导

5. **新项目接入命令**
   - 输入：标准 Node 项目
   - 期望：生成 `cd /abs/path && npm run dev` 类型命令
6. **同名命令冲突**
   - 输入：待新增 name 已存在
   - 期望：Skill 触发覆盖确认，不直接写入
7. **结构损坏保护**
   - 输入：YAML 缺失 `settings`
   - 期望：Skill 阻止写入并提示修复
8. **SSH 场景**
   - 输入：运维 SSH 命令
   - 期望：建议 `mode: terminal` 且使用 `sshKeyId`

## C. 答疑与一致性

9. **纯答疑（不改配置）**
   - 输入：问“怎么用标签筛选命令”
   - 期望：Skill 给步骤且 `write_status: not_written`
10. **双端一致性**
   - 输入：同一问题分别在 Cursor 与 CC 提问
   - 期望：核心结论一致，均包含下一步、成功判定、回滚方案

## D. 验收判定

通过标准：

- 10 个用例全部通过
- 无“未确认即写入”行为
- 下载地址均来自 `distribution-manifest.yaml`
