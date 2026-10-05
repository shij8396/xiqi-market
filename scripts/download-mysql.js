import { spawn } from "node:child_process";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
const url = "https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.11-winx64.zip",
  target = ".runtime/mysql-8.4.11.zip",
  total = 281191914,
  start = fs.existsSync(target) ? fs.statSync(target).size : 0;
fs.mkdirSync(".runtime", { recursive: true });
if (start < total) {
  const count = 8,
    size = Math.ceil((total - start) / count);
  const chunks = [];
  for (let i = 0; i < count; i++) {
    const a = start + i * size,
      b = Math.min(a + size - 1, total - 1);
    if (a > b) break;
    const file = ".runtime/chunk-" + i;
    chunks.push({ file, size: b - a + 1, a, b });
  }
  await Promise.all(
    chunks.map(
      ({ file, a, b, size }) =>
        new Promise((resolve, reject) => {
          const p = spawn(
            "curl.exe",
            [
              "--fail",
              "--silent",
              "--show-error",
              "--max-time",
              "600",
              "--retry",
              "2",
              "--range",
              `${a}-${b}`,
              url,
              "-o",
              file,
            ],
            { windowsHide: true, stdio: "inherit" },
          );
          p.on("exit", (code) =>
            code === 0 && fs.statSync(file).size === size
              ? resolve()
              : reject(Error("分片下载失败 " + file)),
          );
        }),
    ),
  );
  for (const { file } of chunks) {
    await pipeline(
      fs.createReadStream(file),
      fs.createWriteStream(target, { flags: "a" }),
    );
    fs.unlinkSync(file);
  }
}
const md5 = createHash("md5");
for await (const chunk of fs.createReadStream(target)) md5.update(chunk);
const digest = md5.digest("hex");
if (digest !== "2e833921898a9a030ea6bfe81bd811bc")
  throw Error("下载完整性校验失败");
console.log("MySQL ZIP下载完成，MD5与官方响应ETag匹配");
