# CCSwitch Tester

[English](README.en.md)

CCSwitch Tester 是一个 Windows 桌面客户端，用于批量测试 CC Switch 中保存的 Claude 和 Codex 供应商。它会向每个选中的供应商发送一次真实模型请求，并分别展示响应、耗时和错误信息。

[下载最新 Windows 版本](https://github.com/fengqichang666/ccswitch-tester/releases/latest)

## Windows 客户端

构建后的文件位于 `release/`：

- `CCSwitch-Tester-0.3.0-x64-portable.exe`：便携版，直接运行。
- `CCSwitch-Tester-0.3.0-x64-setup.exe`：安装版，可选择安装目录。

程序启动后会自动读取当前 Windows 用户的 CC Switch 数据库：

```text
%USERPROFILE%\.cc-switch\cc-switch.db
```

## 功能

- Claude 和 Codex 使用独立列表展示。
- 支持按供应商名称或 Server URL 即时搜索，Claude 和 Codex 分别保留自己的搜索条件。
- 支持逐项勾选或全选当前搜索结果中的供应商。
- “测试选中项”只会测试当前 Claude/Codex 页面中勾选的供应商，不会跨页面混合测试。
- 每一行提供独立“测试”按钮。
- 按照 CC Switch 中记录的协议选择 Claude Messages、OpenAI Responses 或 Chat Completions 请求路径。
- Claude Messages 和 Codex Responses 请求会携带对应客户端兼容请求头，以适配会校验客户端身份的中转供应商。
- Claude 默认使用 `claude-opus-5`，Codex 默认使用 `gpt-5.6-sol`，每个供应商的模型均可单独修改。
- 支持新增、编辑、启用、停用和删除测试语句。
- 每个供应商请求前会从已启用的语句中随机选择一条。
- 每个选中的供应商只发送一次请求，不会自动重试。
- 单个供应商失败不会中断其他供应商的测试。
- 每个供应商独立保留最近 10 次测试记录，并通过历史弹窗查看。
- 记录测试时间、模型、语句、HTTP 状态码、耗时、回答摘要或错误详情。
- 启动时读取 CC Switch 配置，也可以在界面中手动刷新。
- 支持把 Claude Code 供应商勾选后一键同步成 Claude Desktop 供应商，写入前自动备份数据库。
- 关闭主窗口时程序会缩小到 Windows 系统托盘；通过托盘菜单可以重新打开或彻底退出。
- 网络错误会显示 DNS、连接超时、连接重置、TLS 证书、代理等底层原因及本次使用的网络路径。

## 使用方法

1. 启动 CC Switch，并确保待测试的供应商已经配置 API Key 和服务地址。
2. 运行 CCSwitch Tester，在 Claude 或 Codex 页面搜索并选择供应商。
3. 根据需要修改每行使用的模型。
4. 在“语句管理”中维护随机测试语句，并至少启用一条。
5. 点击“测试选中项”。
6. 点击每行右侧的“历史”按钮，查看该供应商最近 10 次结果。

测试会产生真实 API 请求，可能消耗供应商额度。程序不会自动重试；需要重测时请重新选择并运行。

`fetch failed` 本身不能说明网站一定限制访问。常见原因包括 DNS 失败、TLS 证书异常、目标站主动重置连接、区域或防火墙限制、代理不可用以及连接超时。新版会在错误详情中显示底层错误码，并标注请求使用的是 CCSwitch 代理、环境代理、Windows 系统代理还是直连。

## 同步到 Claude Desktop

CC Switch 把 Claude Code（`claude`）和 Claude Desktop（`claude-desktop`）当成两套独立供应商，新增一个中转站要在两边各录一次。顶栏的「⇄ 同步到 Desktop」会把 Claude Code 侧的供应商整行克隆成 Claude Desktop 供应商：先预览、勾选，再确认写入。

- 去重按 Base URL 比对（忽略大小写和末尾斜杠）。桌面侧已有的标为「已存在」并置灰，绝不改动任何已存在的桌面行。
- 桌面行 id 固定为 `<源 id>-desktop`，重复同步不会写出第二份。
- 模式判定复刻 CC Switch 自己的规则：接口格式为 anthropic、模型名都是 `claude-*` 角色名、且带 `ANTHROPIC_AUTH_TOKEN` 时判为 `direct`；否则判为 `proxy`，并按 `ANTHROPIC_DEFAULT_{SONNET,OPUS,HAIKU,FABLE}_MODEL` 生成模型路由（`[1M]` 后缀会转成 `supports1m`，`_NAME` 会作为显示名）。
- 名字与桌面侧某一行相同但地址不同的，标为「同名待确认」，默认不勾选，需要时手动勾。
- 官方配置、缺 Base URL 或缺 Key 的行标为「不可同步」。
- 写入前自动备份到 `%USERPROFILE%\.cc-switch\backups\db_backup_<时间戳>.db`，命名与 CC Switch 一致，可直接在它的设置页「恢复备份」里选回。
- 只执行 INSERT，不更新也不删除；一批里任意一条失败会整批回滚。
- CC Switch 不会热加载外部改动：同步完成后请重启 CC Switch，才能在 Claude Desktop 面板看到新供应商。

## 数据与安全

- CC Switch 数据库默认只以只读方式加载；只有「同步到 Desktop」在你确认后会向 `providers` 表插入新的 `claude-desktop` 行，写入前自动备份，且不会修改或删除任何已有供应商、URL 和 API Key。
- 原始 API Key 只在发送请求时由主进程读取，不会传递到界面。
- 界面只显示脱敏后的 Key 标识。
- 测试历史不会保存原始 API Key、Authorization 请求头或完整服务端响应。
- 每条回答或错误信息最多保存前 500 个字符。
- CCSwitch Tester 的语句、模型覆盖设置和测试历史保存在本机应用数据目录。

## 本地开发

```powershell
npm install
npm start
```

## 运行测试

```powershell
npm test
```

## 构建 Windows 客户端

```powershell
npm run dist
```

构建产物会写入 `dist/`。项目当前同时生成 NSIS 安装版和便携版。
