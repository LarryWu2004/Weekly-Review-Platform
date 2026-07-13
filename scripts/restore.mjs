import fs from "node:fs/promises";
import path from "node:path";

const sourceArg = process.argv[2];
if (!sourceArg) throw new Error("用法：npm run restore -- <备份目录>（恢复前必须停止应用）");
const source = path.resolve(sourceArg);
const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(root, "uploads"));

function assertSafeDirectory(target, label) {
  const parsed = path.parse(target);
  if (target === parsed.root || target.length <= parsed.root.length + 2) throw new Error(`${label} 不能指向磁盘根目录：${target}`);
}

await fs.access(path.join(source, "weekly.db"));
assertSafeDirectory(dataDir, "DATA_DIR");
assertSafeDirectory(uploadDir, "UPLOAD_DIR");
await fs.mkdir(dataDir, { recursive: true });
const databaseTarget = path.join(dataDir, "weekly.db");
await fs.rm(`${databaseTarget}-wal`, { force: true });
await fs.rm(`${databaseTarget}-shm`, { force: true });
await fs.rm(databaseTarget, { force: true });
await fs.copyFile(path.join(source, "weekly.db"), databaseTarget);
await fs.rm(uploadDir, { recursive: true, force: true });
try {
  await fs.cp(path.join(source, "uploads"), uploadDir, { recursive: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await fs.mkdir(uploadDir, { recursive: true });
}
console.log(`Backup restored from: ${source}`);
