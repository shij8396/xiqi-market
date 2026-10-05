import argon2 from "argon2";
import { rows, pool } from "../server/db.js";
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 14)
  throw Error("请通过ADMIN_PASSWORD环境变量提供至少14位管理员密码");
await rows(
  "INSERT INTO users(login,password_hash,nickname,role,verified_until) VALUES(?,?,?,?,?)",
  [
    process.env.ADMIN_LOGIN || "admin",
    await argon2.hash(process.env.ADMIN_PASSWORD),
    "校园管理员",
    "ADMIN",
    "2099-01-01",
  ],
);
console.log("管理员已创建");
await pool.end();
