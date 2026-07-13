import { describe, expect, it } from "vitest";
import { normalizeMultipartFilename } from "./filenames.js";

describe("normalizeMultipartFilename", () => {
  it("recovers a UTF-8 Chinese filename parsed as Latin-1", () => {
    const mojibake = Buffer.from("项目进展清单.csv", "utf8").toString("latin1");
    expect(normalizeMultipartFilename(mojibake)).toBe("项目进展清单.csv");
  });

  it.each(["项目进展清单.csv", "checklist.csv", "résumé.pdf"])("leaves an already valid filename unchanged: %s", (filename) => {
    expect(normalizeMultipartFilename(filename)).toBe(filename);
  });
});
