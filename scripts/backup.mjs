import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(root, "uploads"));
const backupRoot = path.resolve(process.env.BACKUP_DIR || path.join(root, "backups"));
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const target = path.join(backupRoot, stamp);
const sourceDatabase = path.join(dataDir, "weekly.db");

await fs.mkdir(target, { recursive: true });
const database = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
try {
  await database.backup(path.join(target, "weekly.db"));
} finally {
  database.close();
}
try {
  await fs.cp(uploadDir, path.join(target, "uploads"), { recursive: true, errorOnExist: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await fs.writeFile(path.join(target, "manifest.json"), JSON.stringify({ created_at: new Date().toISOString(), database: "weekly.db", uploads: "uploads" }, null, 2));
console.log(`Backup created: ${target}`);
