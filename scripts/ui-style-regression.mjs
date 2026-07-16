import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", "styles.css"), "utf8");
const app = fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", "App.tsx"), "utf8");
const reportDrawer = fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", "ReportDrawer.tsx"), "utf8");

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || "";
}

function assert(condition, message) {
  if (!condition) throw new Error(`UI style regression: ${message}`);
}

assert(!/background-attachment\s*:\s*fixed/.test(block("body")), "the page background must not be fixed behind translucent scrolling surfaces");
assert(!/\.main::before[\s\S]*animation\s*:\s*ambient-drift/.test(css), "large fixed blurred ambient layers must not animate continuously");
assert(!/backdrop-filter/.test(block(".report-row")), "repeated scrolling report cards must not create individual backdrop-filter compositing layers");
assert(!app.includes("点击查看内容"), "report rows must not include the redundant click-to-view hint");
assert(block(".attachment-preview-pane").includes("grid-template-rows: auto minmax(0, 1fr)"), "single-attachment preview must use a two-row grid that fills the remaining height");
assert(block(".attachment-preview-pane.has-tabs").includes("grid-template-rows: auto auto minmax(0, 1fr)"), "multi-attachment preview must reserve a row for attachment tabs");
assert(reportDrawer.includes('attachments.length > 1 ? "has-tabs" : ""'), "the preview pane must opt into the tabbed grid only when tabs are rendered");

console.log("UI style regression passed: no continuous fixed-blur repaint path");
