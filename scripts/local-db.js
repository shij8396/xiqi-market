import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
const root = path.resolve(".runtime/mysql84");
mkdirSync(root, { recursive: true });
const tmpdir = path.resolve(".runtime/mysql-tmp");
mkdirSync(tmpdir, { recursive: true });
const bin =
  process.env.MYSQLD_PATH ||
  path.resolve(".runtime/mysql-8.4.11-winx64/bin/mysqld.exe");
const basedir = path.dirname(path.dirname(bin));
if (!existsSync(bin))
  throw Error("请安装MySQL或设置MYSQLD_PATH；也可使用deploy/compose.yml");
const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, stdio: "inherit" });
    p.on("exit", (c) =>
      c === 0 ? resolve() : reject(Error("MySQL退出码 " + c)),
    );
  });
if (!existsSync(path.join(root, "mysql")))
  await run([
    "--no-defaults",
    "--initialize-insecure",
    "--basedir=" + basedir,
    "--datadir=" + root,
    "--tmpdir=" + tmpdir,
    "--console",
  ]);
const rootSecretFile = path.resolve(".runtime/root-password");
async function connect() {
  return mysql.createConnection({
    host: "127.0.0.1",
    port: 3308,
    user: "root",
    password: existsSync(rootSecretFile)
      ? readFileSync(rootSecretFile, "utf8")
      : undefined,
    connectTimeout: 1000,
  });
}
let db;
try {
  db = await connect();
} catch {
  const p = spawn(
    bin,
    [
      "--no-defaults",
      "--basedir=" + basedir,
      "--datadir=" + root,
      "--tmpdir=" + tmpdir,
      "--port=3308",
      "--bind-address=127.0.0.1",
      "--mysqlx=OFF",
      "--log-error=" + path.join(root, "error.log"),
    ],
    { detached: true, windowsHide: true, stdio: "ignore" },
  );
  p.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      db = await connect();
      break;
    } catch {}
  }
}
if (!db) throw Error("独立数据库启动失败，请查看.runtime/mysql84/error.log");
const [[instance]] = await db.query("SELECT @@datadir AS data_dir");
const normalize = (value) =>
  path
    .resolve(value)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
if (normalize(instance.data_dir) !== normalize(root)) {
  await db.end();
  throw Error("3308端口由其他数据库实例占用，未对其执行任何配置变更");
}
let password = randomBytes(24).toString("hex");
if (existsSync(".env")) {
  password =
    readFileSync(".env", "utf8").match(/^DB_PASSWORD=(.*)$/m)?.[1] || password;
} else
  writeFileSync(
    ".env",
    `PORT=3088\nDB_HOST=127.0.0.1\nDB_PORT=3308\nDB_USER=campus_app\nDB_PASSWORD=${password}\nDB_NAME=xiqi_market\nSESSION_SECRET=${randomBytes(32).toString("hex")}\nAPP_ORIGIN=http://127.0.0.1:3088\nDEMO_MODE=true\nNODE_ENV=development\n`,
  );
await db.query(
  "CREATE DATABASE IF NOT EXISTS xiqi_market CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
);
await db.query(
  "CREATE USER IF NOT EXISTS 'campus_app'@'127.0.0.1' IDENTIFIED BY ?",
  [password],
);
await db.query(
  "GRANT ALL PRIVILEGES ON xiqi_market.* TO 'campus_app'@'127.0.0.1'",
);
await db.query(
  "CREATE DATABASE IF NOT EXISTS xiqi_market_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
);
await db.query(
  "GRANT ALL PRIVILEGES ON xiqi_market_test.* TO 'campus_app'@'127.0.0.1'",
);
if (!existsSync(rootSecretFile)) {
  const secret = randomBytes(32).toString("hex");
  await db.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [secret]);
  writeFileSync(rootSecretFile, secret);
}
await db.end();
console.log("独立开发数据库已就绪：127.0.0.1:3308 / xiqi_market");
