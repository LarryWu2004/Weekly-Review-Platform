# 周报协作

> 当前版本：**v2.0**（包版本 `2.0.0`）

周报协作是一个独立部署、由 Agent 协作平台启动的周报业务应用。平台负责用户身份、组织关系和个人 Agent，本应用负责周报、附件、审阅权限、评论、消息和分析结果。

v2.0 将周报正文统一为附件：用户上传 Word、PDF、Excel 或文本文件即可提交；审阅人可以直接预览、评论，也可以使用自己在平台中选择的个人 Agent 分析周报。

## v2.0 主要功能

- 周报以附件为正文，无需重复填写“本周工作”和“下周计划”。
- 每份周报必须上传 1～5 个附件，单个附件不超过 10 MB。
- PDF 默认按页面宽度预览。
- Word 转换为隔离的 HTML 预览，并保留文档中的内嵌图片。
- 根据平台组织关系生成作者、直接审阅人、间接审阅人及多条上行关系的权限快照。
- “审阅周报”分为待审阅和已审阅。
- 支持按关键词、作者和时间筛选我的周报与可审阅周报。
- 评论会产生消息提醒，支持单条已读和全部已读。
- 作者与有查看权限的成员均可发起 Agent 分析。
- 每个用户可从平台返回的个人 Agent 列表中选择自己的分析 Agent。
- Agent 只接收本次周报和紧邻的上一份周报；没有上一份时只接收本次。
- 支持中文附件名、附件下载、操作审计、限流、备份和恢复。

## 一、生产部署

### 1. 部署要求

- Node.js 22，或支持 Docker 的运行环境。
- 一个用户浏览器和平台服务端均可访问的 HTTPS 地址，例如 `https://weekly.example.com`。
- 平台分配的 External App API 地址、API Key、租户 ID 和业务应用 Key。
- 可持久化的数据库目录和附件目录。
- 生产可用的 ClamAV `clamd` 服务。
- 当前版本使用 SQLite 与本地附件目录，应按单实例方式部署。

### 2. 平台侧必须完成的配置

业务应用必须注册为外部应用：

```json
{
  "runtime_provider": "external_app",
  "external_app": {
    "platform_capabilities": [
      "resource.context.read",
      "organization.graph.read",
      "agents.list",
      "agents.run"
    ],
    "resource_bindings": {
      "agents": [
        {
          "agent_id": "允许本应用调用的个人 Agent ID"
        }
      ]
    }
  }
}
```

同时确认：

- 调用 External App API 的平台身份具备基础权限 `data:read`。
- `agents.list` 和 `agents.run` 已授予当前业务应用。
- 每个可用 Agent 都出现在 `resource_bindings.agents` 或兼容的 `bindings.agents` 中。
- Agent 的 `scope` 为 `user`、`status` 为 `active`。
- `owner_user_id` 必须与发起分析的 `user_id` 完全一致。
- 当前平台接口不支持平台公共 Agent，只支持用户自己的个人 Agent。

缺少上述配置时，平台通常返回：

| 错误码 | 含义 |
| --- | --- |
| `capability_not_granted` | 未授予 `agents.list` 或 `agents.run` |
| `resource_not_bound` | Agent 未绑定到业务应用 |
| `agent_not_accessible` | Agent 不属于传入的用户 |
| `forbidden` | 平台身份缺少 `data:read` 等基础权限 |
| `app_not_found` | 应用 Key 不正确 |

### 3. 生产环境变量

复制 [.env.example](./.env.example)，创建不提交到 Git 的 `.env.production`：

```env
NODE_ENV=production
PORT=3001
DATA_DIR=/app/data
UPLOAD_DIR=/app/uploads

NEXUSOS_API_BASE_URL=https://platform.example.com/api/v1
NEXUSOS_API_KEY=<平台服务端 API Key>
NEXUSOS_TENANT_ID=<租户 ID>
NEXUSOS_APP_KEY=<外部应用 Key>

APP_PUBLIC_URL=https://weekly.example.com
PLATFORM_ENTRY_MODE=ticket
PLATFORM_LAUNCH_SECRET=<至少 32 位随机值>
LAUNCH_TICKET_TTL_SECONDS=120
SESSION_TTL_HOURS=8
SESSION_COOKIE_NAME=weekly_session

CORS_ALLOWED_ORIGINS=https://platform.example.com
FRAME_ANCESTORS='self' https://platform.example.com

CLAMAV_HOST=clamav.internal
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=15000

PLATFORM_TIMEOUT_MS=20000
RATE_LIMIT_PER_MINUTE=180
AGENT_RATE_LIMIT_PER_MINUTE=6
```

注意：

- `NEXUSOS_API_BASE_URL` 必须是平台 Control Plane 地址，并以 `/api/v1` 结尾。
- `NEXUSOS_API_KEY` 用于本应用调用平台 API。
- `PLATFORM_LAUNCH_SECRET` 用于平台启动本应用，两者不是同一个密钥。
- 密钥只能保存在服务端环境变量或密钥管理系统中。
- `APP_PUBLIC_URL` 在生产环境必须使用 HTTPS。
- `ENABLE_LOCAL_TEST_ENTRY` 只用于本机开发，生产模式不会启用。

### 4. Docker 部署

```bash
docker build -t weekly-review-platform:2.0.0 .

docker run -d \
  --name weekly-review-platform \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file .env.production \
  -v weekly-data:/app/data \
  -v weekly-uploads:/app/uploads \
  weekly-review-platform:2.0.0
```

必须持久化：

- `/app/data`：SQLite 数据库。
- `/app/uploads`：周报附件。

建议在容器前使用 Nginx、Traefik 或平台网关统一处理 HTTPS、访问日志和请求大小限制。

### 5. Node.js 部署

```bash
npm ci
npm run build
node --env-file=.env.production dist-server/index.js
```

如果环境变量由 systemd、Docker Compose、Kubernetes 或进程管理器注入：

```bash
npm start
```

Express 会在同一端口提供前端静态文件与业务 API。

### 6. 健康检查

```bash
curl https://weekly.example.com/api/health
curl https://weekly.example.com/api/ready
```

预期：

```json
{"status":"ok","service":"nexus-weekly"}
```

```json
{"status":"ready","database":"ok","uploads":"ok"}
```

`/api/ready` 只检查本地数据库和附件目录。部署后还应使用真实平台用户验证组织关系、Agent 列表和 Agent Run。

## 二、平台如何进入本应用

本应用没有独立账号密码登录页。部署者可以选择一次性票据或 URL 用户 ID 两种模式。

| 模式 | 环境变量 | 平台接入方式 | 建议用途 |
| --- | --- | --- | --- |
| 一次性票据 | `PLATFORM_ENTRY_MODE=ticket` | 平台后端申请一次性地址，再跳转用户浏览器 | 正式生产，推荐 |
| URL 用户 ID | `PLATFORM_ENTRY_MODE=url_user_id` | 直接打开 `/?user_id=<用户ID>` | 内网演示或受保护网关环境 |

### 模式 A：一次性票据（推荐）

平台后端调用：

```http
POST https://weekly.example.com/auth/platform/launch
Authorization: Bearer <PLATFORM_LAUNCH_SECRET>
Content-Type: application/json

{
  "tenant_id": "当前租户 ID",
  "user_id": "当前已登录用户 ID",
  "redirect_path": "/"
}
```

成功返回 HTTP `201`：

```json
{
  "launch_url": "https://weekly.example.com/auth/platform/consume?ticket=...",
  "expires_at": "2026-07-16T10:02:00.000Z"
}
```

平台随后将用户浏览器跳转到 `launch_url`。票据默认 120 秒过期，只能消费一次；消费成功后应用写入 HttpOnly 会话 Cookie，并跳转到首页。

平台侧示例：

```js
async function openWeeklyReview(currentUser) {
  const response = await fetch(`${process.env.WEEKLY_APP_URL}/auth/platform/launch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WEEKLY_PLATFORM_LAUNCH_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenant_id: currentUser.tenantId,
      user_id: currentUser.id,
      redirect_path: "/",
    }),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
  location.assign(result.launch_url);
}
```

不要把 `PLATFORM_LAUNCH_SECRET` 交给浏览器。真实平台应由后端申请 `launch_url`，再通过 302 或受控前端跳转用户。

### 模式 B：URL 用户 ID

应用配置：

```env
PLATFORM_ENTRY_MODE=url_user_id
APP_PUBLIC_URL=https://weekly.example.com
```

平台直接跳转：

```text
https://weekly.example.com/?user_id=<当前平台用户ID>
```

应用会校验用户 ID，调用平台 `/external-app/context` 复核租户、用户和应用上下文，创建本地会话，再用 303 跳转移除地址栏中的用户 ID。

此模式不能证明浏览器访问者本人就是 URL 中的用户。仅当平台网关已经完成登录校验，且应用源站不能被绕过网关直接访问时才可使用；公网部署必须选择票据模式。

完整启动协议见 [平台启动接入说明](./docs/platform-launch-integration.md)。

## 三、平台 API 调用

本应用服务端会调用：

| 时机 | 方法 | 平台路径 | 所需能力 |
| --- | --- | --- | --- |
| 启动和加载会话 | `GET` | `/external-app/context` | `resource.context.read` |
| 提交周报 | `GET` | `/external-app/organization-graph?user_id=...` | `organization.graph.read` |
| Agent 配置和分析 | `GET` | `/external-app/agents?user_id=...` | `agents.list` |
| 执行分析 | `POST` | `/external-app/agents/{agent_id}/runs` | `agents.run` |

每次请求由服务端发出，并携带：

```http
Authorization: Bearer <NEXUSOS_API_KEY>
x-tenant-id: <NEXUSOS_TENANT_ID>
x-user-id: <当前平台用户 ID>
x-business-app-key: <NEXUSOS_APP_KEY>
x-request-id: <随机 UUID>
Content-Type: application/json
```

### Agent Run 请求体

```json
{
  "user_id": "当前发起分析的用户 ID",
  "objective": "请用一段中文自然语言对照上一份计划和本次完成情况，并给出具体改进建议",
  "input": {
    "current_report": {
      "week": "2026-07-13",
      "title": "第 30 周周报",
      "attachments": [
        {
          "file_name": "第 30 周周报.docx",
          "text_preview": "应用从本次附件中提取的文本"
        }
      ]
    },
    "previous_report": {
      "week": "2026-07-06",
      "title": "第 29 周周报",
      "attachments": [
        {
          "file_name": "第 29 周周报.pdf",
          "text_preview": "应用从上一份附件中提取的文本"
        }
      ],
      "comments": ["上一份周报收到的评论"]
    },
    "comments": [
      {
        "commenter_user_id": "评论人 ID",
        "content": "本次周报已有评论"
      }
    ]
  },
  "mode": "task",
  "runtime_hint": {
    "provider": "eap_native"
  },
  "inject_context": false,
  "inject_memories": true,
  "capture_memory": true
}
```

规则：

- `previous_report` 只包含时间上紧邻的上一份周报。
- 没有上一份时，`previous_report` 为 `null`。
- 不发送重复的历史列表或附件对照副本。
- 平台当前只接收 JSON；Word、PDF 等文件不会直接传给 Agent。
- 应用会先提取附件文本，每个附件最多保留 12,000 个字符用于分析。
- `inject_memories: true` 会注入用户个人 Agent 的记忆。
- `capture_memory: true` 允许平台将本次分析结果写回该用户的 Agent 记忆。
- 审阅人发起分析时，使用审阅人自己的用户 ID 和个人 Agent。

External App API 完整契约见 [external-app-api-reference..md](./tools/external-app-api-reference..md)。

## 四、业务流程

### 提交周报

1. 用户选择周起始日、标题并上传附件。
2. 应用校验附件扩展名、文件签名、数量、大小和病毒扫描结果。
3. 应用调用组织关系 API，获取所有直接、间接和多条上行审阅关系。
4. 周报、附件元数据和查看权限在一个 SQLite 事务中写入。
5. 提交成功后，权限作为历史快照保存在本应用中。

### 审阅与消息

1. 应用根据 `report_access` 展示当前用户可查看的周报。
2. 审阅人可以预览附件、发表评论并发起 Agent 分析。
3. 评论保存在本应用中，并向周报作者产生消息提醒。
4. 用户打开消息后可以定位到对应周报评论区。

### Agent 分析

1. 应用读取本次周报附件文本和已有评论。
2. 如果存在上一份周报，读取上一份附件文本和评论。
3. 获取当前用户可调用的个人 Agent，并使用用户保存的选择。
4. 调用平台 Agent Run API。
5. 分析任务与结果持久化到本地数据库，前端轮询任务状态并展示一块自然语言结果。

## 五、附件与预览

支持格式：

```text
.txt .md .csv .json .log .xml .html
.xlsx .xls .docx .pdf
```

预览方式：

- PDF：使用浏览器内置阅读器，默认适应页面宽度。
- Word：使用 Mammoth 转换为隔离的 HTML，内嵌图片转换为 `data:` 资源。
- Excel：提取各工作表为文本内容。
- 文本类文件：直接展示提取文本。

Word 预览运行在带 CSP 和 sandbox 的独立 iframe 中，不会把文档 HTML 直接注入主页面。复杂分页、SmartArt、宏、浮动形状和部分特殊 Word 样式可能无法完全还原，原文件始终可以下载。

## 六、数据与安全

主要数据表：

| 表 | 用途 |
| --- | --- |
| `reports` | 周报日期、标题和状态 |
| `report_access` | 作者和审阅人的权限快照 |
| `attachments` | 附件元数据、存储路径和提取文本 |
| `comments`、`comment_reads` | 评论、消息和已读状态 |
| `agent_jobs`、`agent_analyses` | Agent 任务和分析结果 |
| `user_agent_preferences` | 用户选择的个人 Agent |
| `platform_launch_tickets`、`app_sessions` | 启动票据和会话 |
| `audit_events` | 关键业务操作审计 |

安全措施：

- HttpOnly、SameSite=Lax 会话 Cookie；生产环境自动启用 Secure。
- 启动票据只保存 SHA-256 摘要、短时有效且只能消费一次。
- 浏览器不能通过伪造 `x-user-id` 绕过本地会话。
- 附件扩展名与文件签名校验。
- 生产环境 ClamAV 扫描。
- 附件查看、预览和下载均检查周报权限。
- 评论、删除和 Agent 任务状态均执行用户权限检查。
- 常规 API 和 Agent API 独立限流。
- Word HTML 预览使用 CSP 与 iframe sandbox 隔离。

SQLite 启用 WAL 和外键约束。提交周报时，周报、权限快照和附件元数据在同一个事务中写入；失败时回滚数据库并清理暂存文件。删除周报会级联删除评论、消息、附件元数据和 Agent 记录，再清理磁盘文件。

组织关系在提交时固化为权限快照。后续组织变化不会自动修改历史周报权限；如果业务要求实时撤权，需要增加组织变更同步和历史权限重算任务。

## 七、本地开发

### Windows 一键启动

安装 Node.js 22 后运行：

```powershell
.\start-server.bat
```

脚本会：

1. 安装依赖。
2. 构建最新代码。
3. 启动本地 External App API mock。
4. 启动周报应用。
5. 为演示用户创建本地会话并打开浏览器。

切换演示用户：

```powershell
$env:WEEKLY_LAUNCH_USER_ID="3"
.\start-server.bat
```

测试 URL 用户 ID 模式：

```powershell
$env:PLATFORM_ENTRY_MODE="url_user_id"
$env:WEEKLY_LAUNCH_USER_ID="3"
.\start-server.bat
```

`start-server.bat` 会启动 mock，只适用于开发和演示。

### 手动开发

终端一：

```powershell
cd tools\external-app-api-mock
npm start
```

终端二：

```powershell
npm install
npm run dev
```

- Vite 前端：`http://localhost:5173`
- Express API：`http://localhost:3001`
- 平台 mock：`http://localhost:18080`

写入幂等演示数据：

```powershell
npm run seed:demo
```

本机测试入口仅在非生产环境、显式设置 `ENABLE_LOCAL_TEST_ENTRY=true`，并且请求来自回环地址时可用：

```text
http://localhost:3001/auth/local-test-entry?user_id=3
```

## 八、测试

```powershell
npm run typecheck
npm test
npm run test:ui-style
npm run test:e2e
npm run build
```

端到端测试使用独立临时数据库和严格平台 mock，覆盖：

- 平台启动、票据防重放、会话和退出。
- External App API 请求头、身份和 Agent 请求体。
- 仅附件周报提交。
- PDF 适应宽度与 Word 图片预览。
- 中文附件名、附件文本提取和下载。
- 直接、间接和多条审阅关系。
- 搜索筛选、评论、消息和已读状态。
- 作者与审阅人个人 Agent 分析。
- 有上一份和无上一份两种 Agent 上下文。
- 重复提交、无附件、伪造附件和越权访问拒绝。
- 事务回滚、附件清理、级联删除和外键完整性。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动前端和 API 开发服务 |
| `npm run seed:demo` | 写入演示数据 |
| `npm run typecheck` | 检查前后端 TypeScript |
| `npm test` | 运行单元测试 |
| `npm run test:ui-style` | 运行 UI 样式回归检查 |
| `npm run test:e2e` | 运行隔离端到端测试 |
| `npm run build` | 构建生产文件 |
| `npm start` | 启动已构建服务 |
| `npm run backup` | 备份数据库和附件 |
| `npm run restore -- <目录>` | 恢复指定备份 |

## 九、备份、恢复与扩展

备份：

```powershell
$env:BACKUP_DIR="D:\weekly-backups"
npm run backup
```

恢复前必须停止应用：

```powershell
npm run restore -- D:\weekly-backups\2026-07-16T10-00-00-000Z
```

生产环境应把备份复制到独立存储，并定期执行恢复演练。

SQLite 与本地附件目录适用于单实例、低到中等并发的内部应用。需要水平扩展时，应将 SQLite 迁移到 PostgreSQL、附件迁移到对象存储、Agent 任务迁移到独立队列，并接入集中日志、指标、告警和密钥管理。

## 十、项目结构

```text
.
├─ src/                           React 前端
├─ server/                        Express、SQLite、认证与平台客户端
├─ docs/                          平台启动接入说明
├─ scripts/                       测试、演示、备份与恢复脚本
├─ tools/
│  ├─ external-app-api-mock/      本地平台 API mock
│  └─ external-app-api-reference..md
├─ data/                          SQLite 数据目录，运行时生成
├─ uploads/                       附件目录，运行时生成
├─ .env.example
├─ Dockerfile
└─ start-server.bat
```

## 已知限制

- 当前仅支持单实例写入同一个 SQLite 文件。
- 附件存储在本地磁盘，不适合多实例水平扩展。
- Word 预览不能保证完全复刻 Microsoft Word 的分页和复杂排版。
- 平台 Agent Run 当前不支持直接传文件，分析使用应用提取后的附件文本。
- 组织关系变化不会自动重算历史周报权限。

## 许可证

仓库当前未声明开源许可证。对外分发前，请补充许可证和第三方依赖合规说明。
