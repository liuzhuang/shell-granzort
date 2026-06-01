# Examples

## Example 1: Install Question

User: `我要怎么下载安装 shell-manage？`

Expected style:

- 先识别用户平台和芯片架构
- 给 3-5 步最短安装路径
- 给安装成功判定
- 给失败分支

## Example 2: Command Onboarding

User: `帮我把这个 Next.js 项目接入 shell-manage`

Expected style:

1. 读取项目脚本（如 `package.json`）
2. 生成候选命令：
   - `cd /abs/path && npm run dev`
3. 先验证再写入
4. 回报新增条目名称与回滚方式

## Example 3: Troubleshooting

User: `升级后软件打不开`

Expected style:

1. 先给最可能原因（安全策略或版本兼容）
2. 给最短排障步骤（不超过 5 步）
3. 给回滚路径
