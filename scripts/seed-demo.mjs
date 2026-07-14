const base = process.env.APP_BASE_URL || "http://localhost:3001/api";
const alice = "a3f0d748-5104-4703-a230-f5d3931a56b2";
const manager = "f7f12c63-49c0-4ed4-a032-216ea27ad9d2";
const director = "47d2767a-a540-43e2-a9f3-31c4835687d9";
const demoUser1 = "1";
const demoUser2 = "2";
const demoUser3 = "3";
const tenantId = process.env.NEXUSOS_TENANT_ID || "8133c675-3bb4-4ace-ba10-1e83299cf761";
const launchSecret = process.env.PLATFORM_LAUNCH_SECRET || "local-platform-launch-secret-change-before-production";
const appOrigin = new URL(base).origin;
const sessionCookies = new Map();

async function sessionCookie(userId) {
  if (sessionCookies.has(userId)) return sessionCookies.get(userId);
  const launchResponse = await fetch(`${appOrigin}/auth/platform/launch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${launchSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, user_id: userId }),
  });
  const launch = await launchResponse.json();
  if (!launchResponse.ok) throw new Error(launch.error?.message || `启动会话失败（HTTP ${launchResponse.status}）`);
  const consumeResponse = await fetch(launch.launch_url, { redirect: "manual" });
  const cookie = String(consumeResponse.headers.get("set-cookie") || "").split(";")[0];
  if (consumeResponse.status !== 303 || !cookie) throw new Error("平台启动票据消费失败");
  sessionCookies.set(userId, cookie);
  return cookie;
}

async function request(path, userId, options = {}) {
  const cookie = await sessionCookie(userId);
  let requestOptions = options;
  if (path === "/reports" && options.method === "POST" && typeof options.body === "string") {
    const report = JSON.parse(options.body);
    if (report.content && !report.current_work && !report.next_plan) {
      const match = /(?:^|\n)\s*下周计划\s*[：:]?\s*(?:\n|$)/m.exec(report.content);
      report.current_work = (match ? report.content.slice(0, match.index) : report.content)
        .replace(/^\s*(?:本周工作|本周完成)\s*[：:]?\s*(?:\n|$)/, "").trim();
      report.next_plan = match ? report.content.slice(match.index + match[0].length).trim() : "待补充";
      delete report.content;
      requestOptions = { ...options, body: JSON.stringify(report) };
    }
  }
  const response = await fetch(`${base}${path}`, {
    ...requestOptions,
    headers: { Cookie: cookie, "Content-Type": "application/json", ...requestOptions.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body;
}

await request("/session", alice);
const existing = await request("/reports?scope=mine", alice);

if (existing.count === 0) {
  const reports = [
    {
      week_start: "2026-06-29",
      title: "第 27 周周报 · 方案收敛",
      content: `本周完成
1. 梳理外部应用与平台的能力边界，明确周报、附件、评论由业务应用独立存储。
2. 完成组织权限模型评审，覆盖多个直接上级与间接上级。
3. 输出 Agent 输入结构草案。

下周计划
完成数据库模型与核心接口开发。`,
    },
    {
      week_start: "2026-07-06",
      title: "第 28 周周报 · 核心链路",
      content: `本周完成
1. 实现周报提交、附件上传与权限快照。
2. 接通组织关系 API，验证直接和间接上级均可访问。
3. 完成上级评论与附件下载授权。

风险与支持
生产环境需由可信网关注入用户身份头。

下周计划
完成 Agent 分析和前端体验验收。`,
    },
    {
      week_start: "2026-07-13",
      title: "第 29 周周报 · 体验验收",
      content: `本周完成
1. 交付周报协作前端，覆盖员工提交与上级审阅视角。
2. Agent 可结合本次周报、历史内容、附件文本和评论给出建议。
3. 完成桌面端与移动端响应式验收。

结果
端到端链路测试通过，无关用户访问会返回 403。

下周计划
接入生产环境密钥管理、监控告警与审计日志。`,
    },
  ];

  const created = [];
  for (const report of reports) {
    created.push(await request("/reports", alice, { method: "POST", body: JSON.stringify(report) }));
  }
  const latest = created.at(-1);
  await request(`/reports/${latest.id}/comments`, manager, {
    method: "POST",
    body: JSON.stringify({ content: "整体链路清楚。下周请补充监控成功率、告警响应时间和负责人三项量化指标。" }),
  });
  await request(`/reports/${latest.id}/comments`, director, {
    method: "POST",
    body: JSON.stringify({ content: "方向认可。生产接入前请安排一次权限边界与审计留痕专项评审。" }),
  });
  await request(`/reports/${latest.id}/analyze`, alice, { method: "POST", body: "{}" });
}

const final = await request("/reports?scope=mine", alice);

async function ensureReports(userId, reports) {
  await request("/session", userId);
  const existingReports = await request("/reports?scope=mine", userId);
  const existingWeeks = new Set(existingReports.items.map((item) => item.week_start));
  for (const report of reports) {
    if (!existingWeeks.has(report.week_start)) {
      await request("/reports", userId, { method: "POST", body: JSON.stringify(report) });
    }
  }
}

const demoUser1History = [
  { week_start: "2026-04-20", week: 17, topic: "需求梳理", completed: "完成业务需求访谈与场景清单整理，明确本阶段交付边界。", next: "确认需求优先级并进入方案评审。" },
  { week_start: "2026-04-27", week: 18, topic: "方案确认", completed: "完成核心流程方案评审，补充异常场景和验收条件。", next: "输出接口清单与数据结构草案。" },
  { week_start: "2026-05-04", week: 19, topic: "接口设计", completed: "完成主要业务接口定义，明确请求字段、错误码和权限要求。", next: "建立数据模型并准备开发环境。" },
  { week_start: "2026-05-11", week: 20, topic: "数据建模", completed: "完成周报、权限和评论数据模型，评审索引与关联关系。", next: "开始周报提交与查询功能开发。" },
  { week_start: "2026-05-18", week: 21, topic: "核心开发", completed: "完成周报提交、列表查询和详情读取的核心链路。", next: "接入组织关系并验证上级权限。" },
  { week_start: "2026-05-25", week: 22, topic: "权限联调", completed: "接通组织关系数据，验证直接上级和间接上级的可见范围。", next: "开发附件上传与文本提取能力。" },
  { week_start: "2026-06-01", week: 23, topic: "附件能力", completed: "完成附件校验、存储、下载授权和常用格式文本提取。", next: "实现上级评论与消息提醒。" },
  { week_start: "2026-06-08", week: 24, topic: "评论通知", completed: "完成评论提交、未读消息提示和评论区定位功能。", next: "接入个人 Agent 分析能力。" },
  { week_start: "2026-06-15", week: 25, topic: "Agent 分析", completed: "完成当前周报、历史内容、附件文本和评论的 Agent 输入组装。", next: "开展端到端回归与交互优化。" },
  { week_start: "2026-06-22", week: 26, topic: "回归验收", completed: "完成主要业务链路回归，修复权限、附件和响应式页面问题。", next: "整理验收结果并准备阶段发布。" },
].map((item) => ({
  week_start: item.week_start,
  title: `用户 1 · 第 ${item.week} 周工作记录 · ${item.topic}`,
  content: `本周完成\n1. ${item.completed}\n2. 同步本周结果并更新相关记录。\n\n下周计划\n${item.next}`,
}));

await ensureReports(demoUser1, [
  ...demoUser1History,
  {
    week_start: "2026-06-29",
    title: "用户 1 · 第 27 周工作记录",
    content: `本周完成
1. 完成需求清单整理与优先级确认。
2. 汇总本周交付结果并补充验收记录。

下周计划
推进下一阶段任务并同步风险项。`,
  },
  {
    week_start: "2026-07-06",
    title: "用户 1 · 第 28 周工作记录",
    content: `本周完成
1. 完成核心功能联调。
2. 跟进问题清单并关闭已确认事项。

下周计划
完成剩余功能的回归验证。`,
  },
  {
    week_start: "2026-07-13",
    title: "用户 1 · 第 29 周工作记录",
    content: `本周完成
1. 完成本周计划内的功能交付。
2. 整理测试结果与后续改进项。

下周计划
继续推进体验优化与文档补充。`,
  },
]);

await request("/session", demoUser2);

await ensureReports(demoUser3, [
  {
    week_start: "2026-07-06",
    title: "用户 3 · 第 28 周管理周报",
    content: `本周完成
1. 完成团队阶段目标复盘。
2. 确认重点事项的负责人和完成时间。

下周计划
跟进关键风险与跨团队协作事项。`,
  },
  {
    week_start: "2026-07-13",
    title: "用户 3 · 第 29 周管理周报",
    content: `本周完成
1. 汇总团队进展并完成管理评审。
2. 明确下一阶段目标与资源安排。

下周计划
持续审阅下级周报并跟进重点交付。`,
  },
]);

const [user1Session, user2Session, user3Session] = await Promise.all([
  request("/session", demoUser1),
  request("/session", demoUser2),
  request("/session", demoUser3),
]);

const expected = [
  { id: demoUser1, stats: user1Session.stats, mine: 13, review: 0 },
  { id: demoUser2, stats: user2Session.stats, mine: 0, review: 13 },
  { id: demoUser3, stats: user3Session.stats, mine: 2, review: 13 },
];
for (const item of expected) {
  if (item.stats.mine !== item.mine || item.stats.review !== item.review) {
    throw new Error(`展示用户 ${item.id} 数据不符合预期：${JSON.stringify(item.stats)}`);
  }
}

console.log(JSON.stringify({
  alice: { reports: final.count, latest_title: final.items[0]?.title, latest_id: final.items[0]?.id },
  demo_users: expected.map((item) => ({ id: item.id, mine: item.stats.mine, review: item.stats.review })),
}, null, 2));
