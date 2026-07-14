export function splitReportContent(content: string) {
  const source = String(content || "").replaceAll("\r\n", "\n").trim();
  const nextHeading = /(?:^|\n)\s*下周计划\s*[：:]?\s*(?:\n|$)/m.exec(source);
  let currentWork = nextHeading ? source.slice(0, nextHeading.index).trim() : source;
  const nextPlan = nextHeading ? source.slice(nextHeading.index + nextHeading[0].length).trim() : "";
  currentWork = currentWork.replace(/^\s*(?:本周工作(?:与下周计划)?|本周完成)\s*[：:]?\s*(?:\n|$)/, "").trim();
  return { currentWork, nextPlan };
}

export function composeReportContent(currentWork: string, nextPlan: string) {
  return `本周工作\n${currentWork.trim()}\n\n下周计划\n${nextPlan.trim()}`;
}
