import "dotenv/config";
import mysql from "mysql2/promise";
export const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3308),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "xiqi_market",
  connectionLimit: 12,
  charset: "utf8mb4",
  timezone: "Z",
  supportBigNumbers: true,
  bigNumberStrings: true,
});
pool.on("connection", (connection) =>
  connection.query("SET time_zone='+00:00'"),
);
export const rows = async (sql, params = [], db = pool) =>
  (await db.execute(sql, params))[0];
export const one = async (sql, params = [], db = pool) =>
  (await rows(sql, params, db))[0];
export async function transaction(fn) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const value = await fn(c);
    await c.commit();
    return value;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export function fail(message, status = 400, code = "INVALID_REQUEST") {
  throw Object.assign(new Error(message), { status, code });
}
export const json = (v) => (typeof v === "string" ? JSON.parse(v) : v);
