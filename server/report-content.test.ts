import { describe, expect, it } from "vitest";
import { composeReportContent, splitReportContent } from "./report-content.js";

describe("report content sections", () => {
  it("splits a legacy report into current work and next plan", () => {
    expect(splitReportContent("本周完成\n完成权限联调。\n\n下周计划\n补充监控指标。")).toEqual({
      currentWork: "完成权限联调。",
      nextPlan: "补充监控指标。",
    });
  });

  it("keeps an unstructured legacy report as current work", () => {
    expect(splitReportContent("完成第一阶段交付。")).toEqual({
      currentWork: "完成第一阶段交付。",
      nextPlan: "",
    });
  });

  it("composes the compatibility content field", () => {
    expect(composeReportContent("完成联调。", "开始验收。")).toBe("本周工作\n完成联调。\n\n下周计划\n开始验收。");
  });
});
