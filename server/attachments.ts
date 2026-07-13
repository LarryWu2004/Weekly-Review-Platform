import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import { config } from "./config.js";

const textExtensions = new Set([".txt", ".md", ".csv", ".json", ".log", ".xml", ".html"]);
const zipExtensions = new Set([".xlsx", ".docx"]);
const oleExtensions = new Set([".xls"]);
const allowedExtensions = new Set([...textExtensions, ...zipExtensions, ...oleExtensions, ".pdf"]);

export function isAllowedAttachmentName(originalName: string) {
  return allowedExtensions.has(path.extname(originalName).toLowerCase());
}

async function scanForMalware(filePath: string) {
  if (!config.clamAvHost) return;
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: config.clamAvHost, port: config.clamAvPort });
    let response = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    socket.setTimeout(config.clamAvTimeoutMs);
    socket.on("timeout", () => finish(new Error("附件病毒扫描超时")));
    socket.on("error", (error) => finish(new Error(`附件病毒扫描不可用：${error.message}`)));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (!response.includes("\0")) return;
      const verdict = response.split("\0", 1)[0];
      if (verdict.endsWith("OK")) finish();
      else if (verdict.includes("FOUND")) finish(new Error("附件未通过病毒安全检查"));
      else finish(new Error(`附件病毒扫描失败：${verdict}`));
    });
    socket.on("connect", () => {
      void (async () => {
        socket.write("zINSTREAM\0");
        for await (const chunk of createReadStream(filePath)) {
          const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(content.length);
          socket.write(length);
          socket.write(content);
        }
        socket.write(Buffer.alloc(4));
      })().catch((error: unknown) => finish(error instanceof Error ? error : new Error("附件读取失败")));
    });
  });
}

export async function validateAttachment(filePath: string, originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error(`不支持的附件类型：${extension || "无扩展名"}`);

  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    if (!bytesRead) throw new Error("附件内容为空");

    if (textExtensions.has(extension)) {
      if (head.includes(0)) throw new Error("文本附件包含二进制内容");
    } else if (extension === ".pdf" && !head.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("PDF 文件签名不正确");
    } else if (zipExtensions.has(extension) && !(head[0] === 0x50 && head[1] === 0x4b)) {
      throw new Error("Office 文件签名不正确");
    } else if (oleExtensions.has(extension) && !head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
      throw new Error("Excel 文件签名不正确");
    }
  } finally {
    await handle.close();
  }
  await scanForMalware(filePath);
}

export async function extractText(filePath: string, originalName: string): Promise<string> {
  const extension = path.extname(originalName).toLowerCase();
  try {
    let text = "";
    if (textExtensions.has(extension)) {
      text = await fs.readFile(filePath, "utf8");
    } else if (extension === ".xlsx" || extension === ".xls") {
      const workbook = XLSX.readFile(filePath);
      text = workbook.SheetNames.map((name) => {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
        return `工作表：${name}\n${csv}`;
      }).join("\n\n");
    } else if (extension === ".docx") {
      text = (await mammoth.extractRawText({ path: filePath })).value;
    } else if (extension === ".pdf") {
      text = (await pdf(await fs.readFile(filePath))).text;
    }
    return text.replace(/\u0000/g, "").trim().slice(0, 12000);
  } catch {
    return "";
  }
}
