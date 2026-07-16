import { describe, expect, it } from "vitest";
import { attachmentPreviewMode, attachmentPreviewUrl, formatFileSize, weekNumber } from "./ui";

describe("weekly display helpers", () => {
  it("calculates ISO week numbers across year boundaries", () => {
    expect(weekNumber("2026-01-01")).toBe("01");
    expect(weekNumber("2026-07-13")).toBe("29");
  });

  it("formats attachment sizes", () => {
    expect(formatFileSize(512)).toBe("1 KB");
    expect(formatFileSize(1572864)).toBe("1.5 MB");
  });

  it("selects the appropriate inline preview for report attachments", () => {
    expect(attachmentPreviewMode("周报.pdf")).toBe("pdf");
    expect(attachmentPreviewMode("周报.DOCX")).toBe("document");
    expect(attachmentPreviewMode("说明.txt")).toBe("text");
    expect(attachmentPreviewMode("数据.xlsx")).toBe("text");
  });

  it("opens PDF previews at page width without changing document preview URLs", () => {
    expect(attachmentPreviewUrl("pdf-id", "pdf")).toBe("/api/attachments/pdf-id/preview#zoom=page-width&view=FitH");
    expect(attachmentPreviewUrl("word-id", "document")).toBe("/api/attachments/word-id/preview");
  });
});
