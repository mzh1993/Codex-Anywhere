# Superpowers Plan: 提交前 + CI 双层泄露防护落地

## Goal

在 `codex_feishu` 仓库内落地一套可执行、可审计的密钥泄露防护，覆盖：

- 本地提交前拦截（pre-commit）
- 远端 CI 扫描（GitHub Actions）
- 历史提交回扫（防止“提交后删除”漏检）

## Scope

- 新增本地扫描脚本：`scripts/security/scan-secrets.sh`
- 新增 Git hook：`.githooks/pre-commit`
- 新增 hook 安装脚本：`scripts/security/install-hooks.sh`
- 新增 CI 工作流：`.github/workflows/secret-leak-guard.yml`

## Detection Strategy

1. 高置信内容规则：
- 云平台访问 key 前缀（AWS/GitHub/GitLab/Slack/OpenAI/Google API key）
- 私钥头（`BEGIN ... PRIVATE KEY`）

2. 敏感文件名规则：
- `.env*`、`secrets.*`、`auth.json`、`id_rsa/id_ed25519`、`*.pem/*.key/*.p12/...`
- 对 `*.env.example` / `*.env.sample` / `*.env.template` 做默认白名单

3. 三种扫描模式：
- `staged`：只扫暂存区（用于 pre-commit）
- `repo`：扫当前已跟踪文件（用于 CI）
- `history`：扫所有历史提交（用于 CI）

## Operator Commands

```bash
./scripts/security/install-hooks.sh
./scripts/security/scan-secrets.sh staged
./scripts/security/scan-secrets.sh repo
./scripts/security/scan-secrets.sh history
```

## Notes

- 扫描输出只打印命中位置，不直接回显敏感值内容，避免二次泄露。
- CI 使用 `fetch-depth: 0`，确保历史扫描完整。
