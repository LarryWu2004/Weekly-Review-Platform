const base = process.env.APP_BASE_URL || "http://localhost:3001/api";
const alice = "a3f0d748-5104-4703-a230-f5d3931a56b2";
const manager = "f7f12c63-49c0-4ed4-a032-216ea27ad9d2";
const director = "47d2767a-a540-43e2-a9f3-31c4835687d9";

async function request(path, userId, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "x-user-id": userId, "Content-Type": "application/json", ...options.headers },
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
console.log(JSON.stringify({ reports: final.count, latest_title: final.items[0]?.title, latest_id: final.items[0]?.id }, null, 2));
