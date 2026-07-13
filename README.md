# 周报协作 · NexusOS 外部应用

与 NexusOS 平台解耦的周报协作应用。平台提供当前用户、组织关系和个人 Agent；周报、权限快照、附件、评论、Agent 任务与审计日志存储在应用自己的 SQLite 中。

## 技术栈

- 前端：React 19、TypeScript、Vite、Lucide Icons
- 服务端：Node.js 22、Express 5、TypeScript
- 数据库：SQLite（`better-sqlite3`，WAL 模式）
- 文件解析：XLSX、Mammoth、PDF Parse
- 测试：Vitest、自包含 mock 端到端测试
- 部署：单进程 Node.js 或 Docker

## 已实现

- 提交周报并上传最多 5 个、单个不超过 10 MB 的附件。
- 提交时调用组织关系 API，将作者、直接上级、间接上级和多个上级写入本地权限表。
- 上级按权限表查看并评论；无关用户、作者评论、上级发起分析等越权操作均由服务端拒绝。
- Agent 输入包含本次周报、附件文本、最近 8 份历史周报、历史评论和本次评论。
- Agent 分析使用 SQLite 持久化任务队列，支持任务去重、失败重试、状态轮询和服务重启续跑。
- 附件扩展名、文件签名、大小和数量校验；生产环境强制通过 ClamAV 扫描。
- 中文附件名上传与下载、报告删除和磁盘附件清理、24 小时以上孤儿文件回收。
- 租户字段隔离、数据库版本记录、操作审计、请求 ID、安全响应头、CORS、可信网关身份和限流。
- 列表分页、响应式前端、错误反馈、生产镜像、备份与恢复脚本。

## 业务流程

1. 用户提交周报和附件，应用校验并保存到自己的数据库与附件目录。
2. 应用调用 NexusOS 组织关系 API，获取全部直接、间接及多个上级。
3. 应用把作者和所有上级写入 `report_access`，形成该次提交的权限快照。
4. 上级进入应用后，只能看到权限表允许查看的周报；评论保存在本地评论表。
5. 作者发起 Agent 评阅时，应用组合本次周报、附件文本、历史周报与评论，创建持久化分析任务。
6. 后台任务调用个人 Agent，失败自动重试；前端轮询状态并展示最终建议。

## 项目结构

```text
.
├─ src/                         React 前端
├─ server/                      Express API、SQLite、平台客户端与安全中间件
├─ scripts/                     集成测试、构建清理、备份与恢复脚本
├─ tools/external-app-api-mock/ 题目提供的 NexusOS API mock
├─ data/                        SQLite 数据目录（运行时生成）
├─ uploads/                     附件目录（运行时生成）
├─ external-app-api-reference..md
├─ Dockerfile
└─ .env.example
```

## 本地开发

要求 Node.js 22+。

```powershell
npm install

# 终端 1
cd D:\agent\tools\external-app-api-mock
npm start

# 终端 2
cd D:\agent
npm run dev
```

打开 `http://localhost:5173`。开发环境 API 为 `http://localhost:3001`，mock 默认为 `http://localhost:18080`。开发环境允许通过 `x-user-id` 切换 mock 用户；此能力不会在生产环境启用。

如果希望直接验证生产构建的单端口版本：

```powershell
npm run build
npm start
```

然后打开 `http://localhost:3001`。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

端到端测试会自行启动题目提供的 mock 与隔离应用，验证中文附件、直接/间接上级权限、评论、异步 Agent、伪造文件拒绝、无关用户拒绝和删除级联。测试数据位于系统临时目录，完成后自动清理。

当前自动化验证范围：

```text
上传 → 中文文件名与文本提取 → 多级组织权限 → 上级评论
     → 异步 Agent 与结果持久化 → 越权拒绝 → 删除与附件清理
```

## 主要接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/session` | 获取当前用户、开发环境可切换用户和统计数据 |
| `GET` | `/api/reports` | 分页查询本人或待审阅周报 |
| `POST` | `/api/reports` | 提交周报和附件，生成权限快照 |
| `GET` | `/api/reports/:id` | 获取有权限查看的周报详情 |
| `DELETE` | `/api/reports/:id` | 作者删除周报及关联数据 |
| `POST` | `/api/reports/:id/comments` | 上级发表评论 |
| `POST` | `/api/reports/:id/analyze` | 创建 Agent 分析任务 |
| `GET` | `/api/agent-jobs/:id` | 查询分析任务状态和结果 |
| `GET` | `/api/attachments/:id/download` | 下载有权访问的附件 |
| `GET` | `/api/health` | 服务存活检查 |
| `GET` | `/api/ready` | 数据库和附件目录就绪检查 |

## 生产部署

先构建，再运行已编译服务：

```powershell
npm ci
npm run build
$env:NODE_ENV="production"
npm start
```

也可使用仓库中的 `Dockerfile`。必须将 `/app/data` 和 `/app/uploads` 挂载到持久卷；`GET /api/health` 是存活检查，`GET /api/ready` 是数据库和附件卷就绪检查。

生产必填配置：

- `NEXUSOS_API_BASE_URL`、`NEXUSOS_API_KEY`、`NEXUSOS_TENANT_ID`、`NEXUSOS_APP_KEY`
- `CORS_ALLOWED_ORIGINS`：逗号分隔的前端来源白名单
- `TRUSTED_PROXY_SECRET`：应用和可信网关之间的高强度共享密钥
- `CLAMAV_HOST`：ClamAV `clamd` 地址，默认端口 `3310`

可信网关必须删除客户端传入的 `x-authenticated-user-id` 和 `x-trusted-proxy-secret`，完成平台登录校验后再注入真实用户 ID 与共享密钥。共享密钥不可进入浏览器或公开配置。若需要嵌入平台 iframe，应通过 `FRAME_ANCESTORS` 设置准确的平台来源。

SQLite 方案适合单实例或共享持久卷上的低并发内部应用。需要多副本水平扩展时，应先将数据库迁移到 PostgreSQL、附件迁移到对象存储，并把 Agent 任务迁移到独立队列；不要让多个容器分别使用本地 SQLite 文件。

## 备份与恢复

备份使用 SQLite backup API 生成数据库快照，并同时复制附件。为保证数据库与附件处于同一业务时点，备份和恢复前都应先停止应用：

```powershell
$env:BACKUP_DIR="D:\weekly-backups"
npm run backup
```

恢复命令：

```powershell
npm run restore -- D:\weekly-backups\2026-07-13T12-00-00-000Z
```

建议由调度系统每日执行备份并同步到独立存储，定期进行恢复演练。备份保留和加密周期应按组织的数据治理要求确定。

## 数据与平台边界

关键表包括 `reports`、`report_access`、`attachments`、`comments`、`agent_analyses`、`agent_jobs`、`audit_events` 和 `schema_migrations`。组织关系在提交时固化为权限快照；后续组织变动不会自动追溯已有周报。如果业务要求实时撤权，需要增加组织变更同步任务并重新计算 `report_access`。

平台调用仅包括：

- `GET /external-app/context`
- `GET /external-app/organization-graph?user_id=...`
- `GET /external-app/agents?user_id=...`
- `POST /external-app/agents/{agent_id}/runs`

NexusOS API Key 只在服务端使用，业务数据不会写回平台。
