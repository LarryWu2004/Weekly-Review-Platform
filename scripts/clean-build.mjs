import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const serverOutput = path.join(root, "dist-server");
if (path.dirname(serverOutput) !== root || path.basename(serverOutput) !== "dist-server") throw new Error("拒绝清理非预期构建目录");
await fs.rm(serverOutput, { recursive: true, force: true });
