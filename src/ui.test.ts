import { describe, expect, it } from "vitest";
import { formatFileSize, weekNumber } from "./ui";

describe("weekly display helpers", () => {
  it("calculates ISO week numbers across year boundaries", () => {
    expect(weekNumber("2026-01-01")).toBe("01");
    expect(weekNumber("2026-07-13")).toBe("29");
  });

  it("formats attachment sizes", () => {
    expect(formatFileSize(512)).toBe("1 KB");
    expect(formatFileSize(1572864)).toBe("1.5 MB");
  });
});
