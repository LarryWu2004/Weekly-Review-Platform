import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", "styles.css"), "utf8");

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

console.log("UI style regression passed: no continuous fixed-blur repaint path");
