import express from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import argon2 from "argon2";
import { z } from "zod";
import multer from "multer";
import sharp from "sharp";
import {
  randomBytes,
  randomUUID,
  randomInt,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pool, rows, one, transaction, fail, json } from "./db.js";
import { MysqlSessionStore } from "./session.js";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const uploadDir = path.resolve("uploads");
await fs.mkdir(uploadDir, { recursive: true });
const id = z.string().regex(/^\d+$/);
const money = z.number().int().min(1).max(10000000);
const accountActive = (u) =>
  u &&
  u.status === "ACTIVE" &&
  (!u.verified_until || new Date(u.verified_until) > new Date());
const productSchema = z
  .object({
    title: z.string().trim().min(2).max(60),
    description: z.string().trim().min(10).max(3000),
    categoryId: z.number().int().positive(),
    locationId: z.number().int().positive(),
    condition: z.enum([
      "全新",
      "几乎全新",
      "轻微使用痕迹",
      "明显使用痕迹",
      "功能有瑕疵",
    ]),
    priceCents: money,
    negotiable: z.boolean(),
    images: z.array(z.string().uuid()).min(1).max(9),
    version: z.number().int().positive().optional(),
  })
  .strict();
export const sessionMiddleware = session({
  name: "xiqi.sid",
  secret:
    process.env.SESSION_SECRET ||
    (() => {
      throw Error("缺少SESSION_SECRET");
    })(),
  store: new MysqlSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 86400000,
  },
});
export const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": ["'self'", "blob:", "data:"],
        "connect-src": ["'self'", "ws:", "wss:"],
      },
    },
  }),
);
app.use(express.json({ limit: "64kb" }));
app.use(sessionMiddleware);
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.set("X-Request-ID", req.requestId);
  next();
});
const ok = (res, data) => res.json({ data });
app.get("/health", async (req, res) => {
  await one("SELECT 1");
  ok(res, { status: "ready" });
});
app.get("/api/config", (req, res) =>
  ok(res, {
    demo: process.env.DEMO_MODE === "true",
    school: "西安汽车职业大学",
    wechat: Boolean(
      process.env.WECHAT_APP_ID &&
      process.env.WECHAT_APP_SECRET &&
      process.env.WECHAT_REDIRECT_URI,
    ),
  }),
);
app.get("/api/auth/session", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const u =
    req.session.userId &&
    (await one("SELECT * FROM users WHERE id=?", [req.session.userId]));
  ok(res, accountActive(u) ? publicUser(u) : null);
});
app.get("/api/auth/csrf", (req, res) => {
  req.session.csrf ??= randomBytes(32).toString("hex");
  ok(res, { token: req.session.csrf });
});
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const a = Buffer.from(String(req.headers["x-csrf-token"] || "")),
    b = Buffer.from(req.session.csrf || "");
  if (!a.length || a.length !== b.length || !timingSafeEqual(a, b))
    return next(
      Object.assign(Error("会话已更新，请刷新后重试"), { status: 403 }),
    );
  if (req.headers.origin) {
    const allowed = [process.env.APP_ORIGIN || "http://127.0.0.1:3088"];
    if (process.env.NODE_ENV !== "production")
      allowed.push("http://127.0.0.1:5173");
    if (!allowed.includes(req.headers.origin))
      return next(Object.assign(Error("请求来源不允许"), { status: 403 }));
  }
  next();
});
const authLimiter = rateLimit({
  windowMs: 60000,
  limit: process.env.NODE_ENV === "test" ? 200 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const student = (req, res, next) =>
  ["USER", "STUDENT"].includes(req.user.role)
    ? next()
    : next(Object.assign(Error("请使用普通账号进行交易"), { status: 403 }));
const admin = (req, res, next) =>
  req.user.role === "ADMIN"
    ? next()
    : next(Object.assign(Error("没有管理员权限"), { status: 403 }));
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const d = z
    .object({
      login: z.string().min(1).max(40),
      password: z.string().min(1).max(200),
    })
    .parse(req.body);
  const u = await one("SELECT * FROM users WHERE login=? OR phone=?", [
    d.login,
    d.login,
  ]);
  if (!u || !(await argon2.verify(u.password_hash, d.password)))
    fail("账号或密码不正确", 401);
  if (!accountActive(u)) fail("账号不可用或认证已过期", 403);
  await new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
  req.session.userId = u.id;
  req.session.csrf = randomBytes(32).toString("hex");
  req.session.cookie.maxAge = u.role === "ADMIN" ? 8 * 3600000 : 86400000;
  await new Promise((r, j) => req.session.save((e) => (e ? j(e) : r())));
  ok(res, { user: publicUser(u), csrf: req.session.csrf });
});
const phone = z.string().regex(/^1[3-9]\d{9}$/);
const studentNo = z.string().regex(/^\d{6,20}$/);
const codeDigest = (student, mobile, code) =>
  hash(`${student}:${mobile}:${code}:${process.env.SESSION_SECRET}`);
async function sendSms(mobile, code, template) {
  if (process.env.DEMO_MODE === "true") return;
  if (!process.env.SMS_GATEWAY_URL || !process.env.SMS_GATEWAY_TOKEN)
    fail("短信服务尚未配置，请联系管理员", 503, "NOT_CONFIGURED");
  const response = await fetch(process.env.SMS_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SMS_GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({ phone: mobile, code, template }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) fail("短信发送失败，请稍后再试", 502);
}
const smsLimiter = rateLimit({
  windowMs: 60000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
app.post("/api/auth/phone-code", smsLimiter, async (req, res) => {
  const d = z.object({ studentNo, phone }).parse(req.body);
  const roster = await one(
    "SELECT expires_at,consumed_at FROM roster WHERE student_no=?",
    [d.studentNo],
  );
  if (
    !roster ||
    roster.consumed_at ||
    new Date(roster.expires_at) <= new Date()
  )
    fail("学号不在可注册名册中，请联系学校管理员", 403);
  if (await one("SELECT id FROM users WHERE phone=?", [d.phone]))
    fail("手机号已注册", 409);
  const previous = await one(
    "SELECT sent_at FROM phone_codes WHERE phone=? AND student_no=?",
    [d.phone, d.studentNo],
  );
  if (previous && Date.now() - new Date(previous.sent_at).getTime() < 60000)
    fail("请在60秒后重新获取验证码", 429);
  const code = String(randomInt(100000, 1000000));
  await sendSms(d.phone, code, "campus-registration");
  await rows(
    "INSERT INTO phone_codes(phone,student_no,code_hash,expires_at,sent_at,attempts) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),UTC_TIMESTAMP(),0) ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),sent_at=VALUES(sent_at),attempts=0",
    [d.phone, d.studentNo, codeDigest(d.studentNo, d.phone, code)],
  );
  ok(res, {
    message: "验证码已发送，有效期5分钟",
    ...(process.env.DEMO_MODE === "true" ? { demoCode: code } : {}),
  });
});
app.post("/api/auth/register", authLimiter, async (req, res) => {
  const d = z
    .object({
      studentNo,
      phone,
      code: z.string().regex(/^\d{6}$/),
      password: z.string().min(10).max(100),
      nickname: z.string().trim().min(2).max(20),
    })
    .parse(req.body);
  const ph = await argon2.hash(d.password);
  const registered = await transaction(async (c) => {
    const r = await one(
      "SELECT * FROM roster WHERE student_no=? FOR UPDATE",
      [d.studentNo],
      c,
    );
    if (!r || r.consumed_at || new Date(r.expires_at) <= new Date())
      fail("学号不在可注册名册中", 403);
    const verification = await one(
      "SELECT * FROM phone_codes WHERE phone=? AND student_no=? FOR UPDATE",
      [d.phone, d.studentNo],
      c,
    );
    if (
      !verification ||
      new Date(verification.expires_at) <= new Date() ||
      verification.attempts >= 5
    )
      fail("验证码已失效，请重新获取", 400);
    const expected = Buffer.from(verification.code_hash, "hex"),
      actual = Buffer.from(codeDigest(d.studentNo, d.phone, d.code), "hex");
    if (!timingSafeEqual(expected, actual)) {
      await rows(
        "UPDATE phone_codes SET attempts=attempts+1 WHERE phone=? AND student_no=?",
        [d.phone, d.studentNo],
        c,
      );
      return false;
    }
    if (
      await one(
        "SELECT id FROM users WHERE login=? OR phone=?",
        [d.studentNo, d.phone],
        c,
      )
    )
      fail("学号或手机号已注册", 409);
    await rows(
      "INSERT INTO users(login,phone,password_hash,nickname,role,verified_until) VALUES(?,?,?,?,?,?)",
      [d.studentNo, d.phone, ph, d.nickname, "STUDENT", r.expires_at],
      c,
    );
    await rows(
      "UPDATE roster SET consumed_at=UTC_TIMESTAMP() WHERE student_no=?",
      [d.studentNo],
      c,
    );
    await rows(
      "DELETE FROM phone_codes WHERE phone=? AND student_no=?",
      [d.phone, d.studentNo],
      c,
    );
    return true;
  });
  if (!registered) fail("验证码错误", 400);
  ok(res, { message: "注册成功，可使用手机号或学号登录" });
});
app.post("/api/auth/public/phone-code", smsLimiter, async (req, res) => {
  const d = z.object({ phone }).strict().parse(req.body);
  if (
    await one("SELECT id FROM users WHERE phone=? OR login=?", [
      d.phone,
      d.phone,
    ])
  )
    fail("手机号已注册", 409);
  const previous = await one(
    "SELECT sent_at FROM phone_codes WHERE phone=? AND student_no=''",
    [d.phone],
  );
  if (previous && Date.now() - new Date(previous.sent_at).getTime() < 60000)
    fail("请在60秒后重新获取验证码", 429);
  const code = String(randomInt(100000, 1000000));
  await sendSms(d.phone, code, "registration");
  await rows(
    "INSERT INTO phone_codes(phone,student_no,code_hash,expires_at,sent_at,attempts) VALUES(?,'',?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),UTC_TIMESTAMP(),0) ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),sent_at=VALUES(sent_at),attempts=0",
    [d.phone, codeDigest("public-registration", d.phone, code)],
  );
  ok(res, {
    message: "验证码已发送，有效期5分钟",
    ...(process.env.DEMO_MODE === "true" ? { demoCode: code } : {}),
  });
});
app.post("/api/auth/public/register", authLimiter, async (req, res) => {
  const d = z
    .object({
      phone,
      code: z.string().regex(/^\d{6}$/),
      password: z.string().min(10).max(100),
      nickname: z.string().trim().min(2).max(20),
    })
    .strict()
    .parse(req.body);
  const passwordHash = await argon2.hash(d.password);
  const registered = await transaction(async (c) => {
    const verification = await one(
      "SELECT * FROM phone_codes WHERE phone=? AND student_no='' FOR UPDATE",
      [d.phone],
      c,
    );
    if (
      !verification ||
      new Date(verification.expires_at) <= new Date() ||
      verification.attempts >= 5
    )
      fail("验证码已失效，请重新获取", 400);
    const expected = Buffer.from(verification.code_hash, "hex");
    const actual = Buffer.from(
      codeDigest("public-registration", d.phone, d.code),
      "hex",
    );
    if (!timingSafeEqual(expected, actual)) {
      await rows(
        "UPDATE phone_codes SET attempts=attempts+1 WHERE phone=? AND student_no=''",
        [d.phone],
        c,
      );
      return false;
    }
    if (
      await one(
        "SELECT id FROM users WHERE phone=? OR login=?",
        [d.phone, d.phone],
        c,
      )
    )
      fail("手机号已注册", 409);
    await rows(
      "INSERT INTO users(login,phone,password_hash,nickname,role,verified_until) VALUES(?,?,?,?, 'USER',NULL)",
      [d.phone, d.phone, passwordHash, d.nickname],
      c,
    );
    await rows(
      "DELETE FROM phone_codes WHERE phone=? AND student_no=''",
      [d.phone],
      c,
    );
    return true;
  });
  if (!registered) fail("验证码错误", 400);
  ok(res, { message: "注册成功，请使用手机号登录" });
});
app.post(
  "/api/auth/public/password-reset/code",
  smsLimiter,
  async (req, res) => {
    const d = z.object({ phone }).strict().parse(req.body);
    const message = "如果手机号已注册，验证码将发送到该手机";
    if (
      !(await one(
        "SELECT id FROM users WHERE phone=? AND role<>'ADMIN' AND status='ACTIVE'",
        [d.phone],
      ))
    )
      return ok(res, { message });
    const previous = await one(
      "SELECT sent_at FROM password_reset_codes WHERE phone=?",
      [d.phone],
    );
    if (previous && Date.now() - new Date(previous.sent_at).getTime() < 60000)
      fail("请在60秒后重新获取验证码", 429);
    const code = String(randomInt(100000, 1000000));
    await sendSms(d.phone, code, "password-reset");
    await rows(
      "INSERT INTO password_reset_codes(phone,code_hash,expires_at,sent_at,attempts) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),UTC_TIMESTAMP(),0) ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),sent_at=VALUES(sent_at),attempts=0",
      [d.phone, codeDigest("reset-phone", d.phone, code)],
    );
    ok(res, {
      message,
      ...(process.env.DEMO_MODE === "true" ? { demoCode: code } : {}),
    });
  },
);
app.post("/api/auth/public/password-reset", authLimiter, async (req, res) => {
  const d = z
    .object({
      phone,
      code: z.string().regex(/^\d{6}$/),
      newPassword: z.string().min(10).max(100),
    })
    .strict()
    .parse(req.body);
  const passwordHash = await argon2.hash(d.newPassword);
  const done = await transaction(async (c) => {
    const u = await one(
      "SELECT id FROM users WHERE phone=? AND role<>'ADMIN' AND status='ACTIVE' FOR UPDATE",
      [d.phone],
      c,
    );
    const verification = await one(
      "SELECT * FROM password_reset_codes WHERE phone=? FOR UPDATE",
      [d.phone],
      c,
    );
    if (
      !u ||
      !verification ||
      new Date(verification.expires_at) <= new Date() ||
      verification.attempts >= 5
    )
      fail("验证码无效或已过期", 400);
    const expected = Buffer.from(verification.code_hash, "hex");
    const actual = Buffer.from(
      codeDigest("reset-phone", d.phone, d.code),
      "hex",
    );
    if (!timingSafeEqual(expected, actual)) {
      await rows(
        "UPDATE password_reset_codes SET attempts=attempts+1 WHERE phone=?",
        [d.phone],
        c,
      );
      return false;
    }
    await rows(
      "UPDATE users SET password_hash=? WHERE id=?",
      [passwordHash, u.id],
      c,
    );
    await rows("DELETE FROM password_reset_codes WHERE phone=?", [d.phone], c);
    await rows("DELETE FROM sessions WHERE user_id=?", [u.id], c);
    return true;
  });
  if (!done) fail("验证码错误", 400);
  await new Promise((resolve, reject) =>
    req.session.destroy((error) => (error ? reject(error) : resolve())),
  );
  ok(res, { message: "密码已重置，请重新登录" });
});
app.post("/api/auth/password-reset/code", smsLimiter, async (req, res) => {
  const d = z.object({ studentNo, phone }).strict().parse(req.body);
  const u = await one(
    "SELECT id FROM users WHERE login=? AND phone=? AND role='STUDENT' AND status='ACTIVE'",
    [d.studentNo, d.phone],
  );
  const message = "若学号与手机号匹配，验证码将发送到该手机";
  if (!u) return ok(res, { message });
  const previous = await one(
    "SELECT sent_at FROM password_reset_codes WHERE phone=?",
    [d.phone],
  );
  if (previous && Date.now() - new Date(previous.sent_at).getTime() < 60000)
    fail("请在60秒后重新获取验证码", 429);
  const code = String(randomInt(100000, 1000000));
  await sendSms(d.phone, code, "campus-password-reset");
  await rows(
    "INSERT INTO password_reset_codes(phone,code_hash,expires_at,sent_at,attempts) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),UTC_TIMESTAMP(),0) ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),sent_at=VALUES(sent_at),attempts=0",
    [d.phone, codeDigest("reset:" + d.studentNo, d.phone, code)],
  );
  ok(res, {
    message,
    ...(process.env.DEMO_MODE === "true" ? { demoCode: code } : {}),
  });
});
app.post("/api/auth/password-reset", authLimiter, async (req, res) => {
  const d = z
    .object({
      studentNo,
      phone,
      code: z.string().regex(/^\d{6}$/),
      newPassword: z.string().min(10).max(100),
    })
    .strict()
    .parse(req.body);
  const ph = await argon2.hash(d.newPassword);
  const done = await transaction(async (c) => {
    const u = await one(
      "SELECT id FROM users WHERE login=? AND phone=? AND role='STUDENT' AND status='ACTIVE' FOR UPDATE",
      [d.studentNo, d.phone],
      c,
    );
    const code = await one(
      "SELECT * FROM password_reset_codes WHERE phone=? FOR UPDATE",
      [d.phone],
      c,
    );
    if (
      !u ||
      !code ||
      new Date(code.expires_at) <= new Date() ||
      code.attempts >= 5
    )
      fail("验证码无效或已过期", 400);
    const expected = Buffer.from(code.code_hash, "hex");
    const actual = Buffer.from(
      codeDigest("reset:" + d.studentNo, d.phone, d.code),
      "hex",
    );
    if (!timingSafeEqual(expected, actual)) {
      await rows(
        "UPDATE password_reset_codes SET attempts=attempts+1 WHERE phone=?",
        [d.phone],
        c,
      );
      return false;
    }
    await rows("UPDATE users SET password_hash=? WHERE id=?", [ph, u.id], c);
    await rows("DELETE FROM password_reset_codes WHERE phone=?", [d.phone], c);
    await rows("DELETE FROM sessions WHERE user_id=?", [u.id], c);
    return true;
  });
  if (!done) fail("验证码错误", 400);
  await new Promise((resolve, reject) =>
    req.session.destroy((error) => (error ? reject(error) : resolve())),
  );
  ok(res, { message: "密码已重置，请重新登录" });
});
function publicUser(u) {
  return {
    id: String(u.id),
    nickname: u.nickname,
    role: u.role,
    login: u.login,
    phone: u.phone,
    wechatBound: Boolean(u.wechat_openid),
  };
}
app.get("/api/auth/wechat/start", async (req, res) => {
  if (
    !process.env.WECHAT_APP_ID ||
    !process.env.WECHAT_APP_SECRET ||
    !process.env.WECHAT_REDIRECT_URI
  )
    fail("微信登录尚未配置", 503, "NOT_CONFIGURED");
  const bind = req.query.action === "bind";
  if (bind && !req.session.userId) fail("请先登录账号再绑定微信", 401);
  const state = randomBytes(24).toString("hex");
  req.session.wechatState = {
    state,
    bind,
    userId: bind ? String(req.session.userId) : null,
  };
  await new Promise((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
  const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
  url.search = new URLSearchParams({
    appid: process.env.WECHAT_APP_ID,
    redirect_uri: process.env.WECHAT_REDIRECT_URI,
    response_type: "code",
    scope: "snsapi_login",
    state,
  }).toString();
  res.redirect(url.toString() + "#wechat_redirect");
});
app.get("/api/auth/wechat/callback", async (req, res) => {
  const pending = req.session.wechatState;
  delete req.session.wechatState;
  await new Promise((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
  if (
    !pending ||
    !req.query.state ||
    String(req.query.state) !== pending.state ||
    !req.query.code
  )
    return res.redirect("/login?error=wechat");
  try {
    const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    url.search = new URLSearchParams({
      appid: process.env.WECHAT_APP_ID,
      secret: process.env.WECHAT_APP_SECRET,
      code: String(req.query.code),
      grant_type: "authorization_code",
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("微信接口不可用");
    const credential = await response.json();
    if (!credential.openid || credential.errcode) throw Error("微信授权失败");
    let user;
    if (pending.bind) {
      user = await one("SELECT * FROM users WHERE id=?", [pending.userId]);
      if (
        !user ||
        !["USER", "STUDENT"].includes(user.role) ||
        !accountActive(user)
      )
        throw Error("账号不可用");
      const owner = await one("SELECT id FROM users WHERE wechat_openid=?", [
        credential.openid,
      ]);
      if (owner && String(owner.id) !== String(user.id))
        throw Error("此微信已绑定其他账号");
      await rows("UPDATE users SET wechat_openid=? WHERE id=?", [
        credential.openid,
        user.id,
      ]);
      return res.redirect("/settings?wechat=bound");
    }
    user = await one("SELECT * FROM users WHERE wechat_openid=?", [
      credential.openid,
    ]);
    if (
      !user ||
      !accountActive(user) ||
      !["USER", "STUDENT"].includes(user.role)
    )
      return res.redirect("/login?error=wechat-unbound");
    await new Promise((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve())),
    );
    req.session.userId = user.id;
    req.session.csrf = randomBytes(32).toString("hex");
    await new Promise((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve())),
    );
    return res.redirect("/");
  } catch {
    return res.redirect(
      pending.bind ? "/settings?error=wechat" : "/login?error=wechat",
    );
  }
});
app.use("/api", async (req, res, next) => {
  if (
    req.method === "GET" &&
    (req.path === "/meta" ||
      req.path === "/products" ||
      /^\/products\/\d+$/.test(req.path) ||
      /^\/sellers\/\d+\/reputation$/.test(req.path) ||
      /^\/assets\/[0-9a-f-]{36}$/i.test(req.path))
  ) {
    const u =
      req.session.userId &&
      (await one("SELECT * FROM users WHERE id=?", [req.session.userId]));
    req.user = accountActive(u) ? u : { id: 0, role: "GUEST" };
    return next();
  }
  const u =
    req.session.userId &&
    (await one("SELECT * FROM users WHERE id=?", [req.session.userId]));
  if (!u) return next(Object.assign(Error("请先登录"), { status: 401 }));
  if (!accountActive(u))
    return next(
      Object.assign(Error("账号不可用或认证已过期"), { status: 403 }),
    );
  req.user = u;
  next();
});
app.get("/api/auth/me", (req, res) => ok(res, publicUser(req.user)));
app.patch("/api/auth/profile", student, async (req, res) => {
  const d = z
    .object({ nickname: z.string().trim().min(2).max(20) })
    .parse(req.body);
  await rows("UPDATE users SET nickname=? WHERE id=?", [
    d.nickname,
    req.user.id,
  ]);
  ok(res, publicUser({ ...req.user, nickname: d.nickname }));
});
app.post("/api/auth/password", student, async (req, res) => {
  const d = z
    .object({
      oldPassword: z.string().min(1),
      newPassword: z.string().min(10).max(100),
    })
    .parse(req.body);
  if (!(await argon2.verify(req.user.password_hash, d.oldPassword)))
    fail("原密码不正确", 400);
  await rows("UPDATE users SET password_hash=? WHERE id=?", [
    await argon2.hash(d.newPassword),
    req.user.id,
  ]);
  ok(res, { message: "密码已更新" });
});
app.delete("/api/auth/wechat/binding", student, async (req, res) => {
  await rows("UPDATE users SET wechat_openid=NULL WHERE id=?", [req.user.id]);
  ok(res, { message: "已解除微信绑定" });
});
app.post("/api/auth/logout", async (req, res) => {
  await new Promise((r, j) => req.session.destroy((e) => (e ? j(e) : r())));
  res.clearCookie("xiqi.sid");
  ok(res, {});
});
const notify = async (db, uid, text, targetPath = null) => {
  await rows(
    "INSERT INTO notifications(user_id,text,target_path) VALUES(?,?,?)",
    [uid, text, targetPath],
    db,
  );
};
const emit = (req, ids) => {
  for (const uid of new Set(ids.map(String)))
    req.app
      .get("io")
      ?.to("user:" + uid)
      .emit("sync");
};
const audit = (db, uid, action, target, reason) =>
  rows(
    "INSERT INTO audit_logs(admin_id,action,target_id,reason) VALUES(?,?,?,?)",
    [uid, action, String(target), reason],
    db,
  );
app.get("/api/meta", async (req, res) =>
  ok(res, {
    categories: await rows("SELECT * FROM categories ORDER BY id"),
    locations: await rows("SELECT * FROM locations ORDER BY id"),
  }),
);
app.get("/api/notifications", async (req, res) =>
  ok(
    res,
    await rows(
      "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50",
      [req.user.id],
    ),
  ),
);
app.get("/api/notifications/unread-count", async (req, res) =>
  ok(
    res,
    await one(
      "SELECT COUNT(*) count FROM notifications WHERE user_id=? AND read_at IS NULL",
      [req.user.id],
    ),
  ),
);
app.post("/api/notifications/:id/read", async (req, res) => {
  const notificationId = id.parse(req.params.id);
  await rows(
    "UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE id=? AND user_id=?",
    [notificationId, req.user.id],
  );
  ok(res, {});
});
app.post("/api/notifications/read", async (req, res) => {
  await rows(
    "UPDATE notifications SET read_at=UTC_TIMESTAMP() WHERE user_id=?",
    [req.user.id],
  );
  ok(res, {});
});
const productSelect = `SELECT p.*,u.nickname seller_name,u.role seller_role,c.name category_name,l.name location_name, EXISTS(SELECT 1 FROM favorites f WHERE f.product_id=p.id AND f.user_id=?) favorite FROM products p JOIN users u ON u.id=p.seller_id JOIN categories c ON c.id=p.category_id JOIN locations l ON l.id=p.location_id`;
function productView(p) {
  return {
    ...p,
    id: String(p.id),
    seller_id: String(p.seller_id),
    images: json(p.images),
    negotiable: !!p.negotiable,
    favorite: !!p.favorite,
  };
}
app.get("/api/products", async (req, res) => {
  let where =
      "p.status='ON_SALE' AND u.status='ACTIVE' AND (u.verified_until IS NULL OR u.verified_until>UTC_TIMESTAMP())",
    params = [req.user.id];
  if (req.query.mine === "true") {
    where = "p.seller_id=?";
    params.push(req.user.id);
  }
  if (req.query.favorites === "true") {
    where =
      "EXISTS(SELECT 1 FROM favorites f WHERE f.product_id=p.id AND f.user_id=?)";
    params.push(req.user.id);
  }
  if (req.query.q) {
    const q = String(req.query.q).slice(0, 60).replace(/[!%_]/g, "!$&");
    where +=
      " AND (p.title LIKE ? ESCAPE '!' OR p.description LIKE ? ESCAPE '!')";
    params.push("%" + q + "%", "%" + q + "%");
  }
  if (req.query.category) {
    where += " AND p.category_id=?";
    params.push(Number(req.query.category) || 0);
  }
  if (req.query.condition) {
    where += " AND p.condition_code=?";
    params.push(req.query.condition);
  }
  for (const [key, op] of [
    ["min", ">="],
    ["max", "<="],
  ])
    if (req.query[key]) {
      const n = Number(req.query[key]);
      if (!Number.isFinite(n) || n < 0) fail("价格筛选无效");
      where += ` AND p.price_cents ${op} ?`;
      params.push(Math.round(n * 100));
    }
  if (req.query.location) {
    where += " AND p.location_id=?";
    params.push(Number(req.query.location) || 0);
  }
  const sorts = {
    new: "p.created_at DESC,p.id DESC",
    price: "p.price_cents ASC,p.id DESC",
    price_desc: "p.price_cents DESC,p.id DESC",
  };
  const paged = req.query.page !== undefined;
  const page = paged
    ? z.coerce.number().int().min(1).max(100000).parse(req.query.page)
    : 1;
  const pageSize = paged ? 20 : 100;
  const offset =
    paged && req.query.offset !== undefined
      ? z.coerce.number().int().min(0).max(2000000).parse(req.query.offset)
      : (page - 1) * pageSize;
  const total = paged
    ? Number(
        (
          await one(
            "SELECT COUNT(*) total FROM products p JOIN users u ON u.id=p.seller_id WHERE " +
              where,
            params.slice(1),
          )
        ).total,
      )
    : null;
  const list = await rows(
    productSelect +
      " WHERE " +
      where +
      " ORDER BY " +
      (sorts[req.query.sort] || sorts.new) +
      " LIMIT ? OFFSET ?",
    [...params, pageSize, offset],
  );
  ok(
    res,
    paged
      ? { items: list.map(productView), total, page, pageSize }
      : list.map(productView),
  );
});
app.get("/api/products/:id", async (req, res) => {
  const p = await one(productSelect + " WHERE p.id=?", [
    req.user.id,
    req.params.id,
  ]);
  if (!p) fail("商品不存在", 404);
  if (
    req.user.role === "GUEST" &&
    !["ON_SALE", "RESERVED", "SOLD"].includes(p.status)
  )
    fail("商品不存在", 404);
  if (
    !["ON_SALE", "RESERVED", "SOLD", "OFF_SHELF", "REMOVED"].includes(
      p.status,
    ) &&
    String(p.seller_id) !== String(req.user.id) &&
    req.user.role !== "ADMIN"
  )
    fail("商品不存在", 404);
  ok(res, productView(p));
});
app.get("/api/sellers/:id/reputation", async (req, res) => {
  const sellerId = id.parse(req.params.id);
  const seller = await one(
    "SELECT id FROM users WHERE id=? AND role IN ('USER','STUDENT')",
    [sellerId],
  );
  if (!seller) fail("卖家不存在", 404);
  const result = await one(
    "SELECT COUNT(*) review_count,ROUND(AVG(r.score),1) rating FROM order_reviews r JOIN orders o ON o.id=r.order_id WHERE r.seller_id=? AND o.status='COMPLETED'",
    [sellerId],
  );
  ok(res, {
    reviewCount: Number(result.review_count),
    rating: result.rating === null ? null : Number(result.rating),
  });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
app.post("/api/uploads", student, upload.single("file"), async (req, res) => {
  if (!req.file) fail("请选择图片");
  let output;
  try {
    const img = sharp(req.file.buffer, { limitInputPixels: 25000000 });
    const meta = await img.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format))
      fail("仅支持JPEG、PNG、WebP图片");
    output = await img
      .rotate()
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    fail("图片格式无效或尺寸过大");
  }
  const aid = randomUUID(),
    filename = aid + ".webp";
  await fs.writeFile(path.join(uploadDir, filename), output);
  await rows("INSERT INTO assets(id,owner_id,filename) VALUES(?,?,?)", [
    aid,
    req.user.id,
    filename,
  ]);
  ok(res, { id: aid });
});
app.get("/api/assets/:id", async (req, res) => {
  const a = await one("SELECT * FROM assets WHERE id=?", [req.params.id]);
  if (!a) fail("图片不存在", 404);
  if (String(a.owner_id) !== String(req.user.id) && req.user.role !== "ADMIN") {
    const p = await one(
      "SELECT id FROM products WHERE JSON_CONTAINS(images, JSON_QUOTE(?)) AND status IN ('ON_SALE','RESERVED','SOLD'" +
        (req.user.role === "GUEST" ? "" : ",'OFF_SHELF','REMOVED'") +
        ") LIMIT 1",
      [a.id],
    );
    if (!p) fail("无权访问图片", 404);
  }
  res.set("Cache-Control", "private, max-age=3600");
  res.sendFile(path.join(uploadDir, a.filename));
});
async function validateProduct(d, uid, c) {
  if (
    !(await one("SELECT id FROM categories WHERE id=?", [d.categoryId], c)) ||
    !(await one("SELECT id FROM locations WHERE id=?", [d.locationId], c))
  )
    fail("分类或交易地点无效");
  for (const aid of d.images) {
    if (
      !(await one(
        "SELECT id FROM assets WHERE id=? AND owner_id=?",
        [aid, uid],
        c,
      ))
    )
      fail("只能使用自己上传的图片", 403);
  }
}
app.post("/api/products", student, async (req, res) => {
  const d = productSchema.parse(req.body);
  const result = await transaction(async (c) => {
    await validateProduct(d, req.user.id, c);
    return rows(
      "INSERT INTO products(seller_id,category_id,location_id,title,description,condition_code,price_cents,negotiable,images) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        req.user.id,
        d.categoryId,
        d.locationId,
        d.title,
        d.description,
        d.condition,
        d.priceCents,
        d.negotiable,
        JSON.stringify(d.images),
      ],
      c,
    );
  });
  ok(res, { id: String(result.insertId) });
});
app.patch("/api/products/:id", student, async (req, res) => {
  const d = productSchema.parse(req.body);
  await transaction(async (c) => {
    const p = await one(
      "SELECT * FROM products WHERE id=? FOR UPDATE",
      [req.params.id],
      c,
    );
    if (!p || String(p.seller_id) !== String(req.user.id))
      fail("没有商品编辑权限", 403);
    if (["RESERVED", "SOLD"].includes(p.status))
      fail("交易中或已售商品不能编辑", 409);
    if (
      await one(
        "SELECT order_id FROM product_reservations WHERE product_id=?",
        [p.id],
        c,
      )
    )
      fail("商品关联的订单尚未处理完毕，暂不能编辑", 409);
    if (p.version !== d.version) fail("商品已被修改，请刷新后重试", 409);
    await validateProduct(d, req.user.id, c);
    await rows(
      "UPDATE products SET category_id=?,location_id=?,title=?,description=?,condition_code=?,price_cents=?,negotiable=?,images=?,status='PENDING_REVIEW',version=version+1,review_reason=NULL WHERE id=?",
      [
        d.categoryId,
        d.locationId,
        d.title,
        d.description,
        d.condition,
        d.priceCents,
        d.negotiable,
        JSON.stringify(d.images),
        p.id,
      ],
      c,
    );
    await invalidate(c, p.id);
  });
  ok(res, {});
});
async function invalidate(c, pid) {
  await rows(
    "UPDATE offers o JOIN conversations cv ON cv.id=o.conversation_id SET o.status='INVALIDATED' WHERE cv.product_id=? AND o.status IN ('PENDING','ACCEPTED')",
    [pid],
    c,
  );
}
app.post("/api/products/:id/off-shelf", student, async (req, res) => {
  await transaction(async (c) => {
    const p = await one(
      "SELECT * FROM products WHERE id=? FOR UPDATE",
      [req.params.id],
      c,
    );
    if (!p || String(p.seller_id) !== String(req.user.id))
      fail("没有权限", 403);
    if (!["ON_SALE", "PENDING_REVIEW"].includes(p.status))
      fail("当前商品不能下架", 409);
    await rows("UPDATE products SET status='OFF_SHELF' WHERE id=?", [p.id], c);
    await invalidate(c, p.id);
  });
  ok(res, {});
});
app.put("/api/favorites/:id", student, async (req, res) => {
  const p = await one(
    "SELECT id FROM products WHERE id=? AND status IN ('ON_SALE','RESERVED','SOLD')",
    [req.params.id],
  );
  if (!p) fail("商品不可收藏", 404);
  await rows("INSERT IGNORE INTO favorites(user_id,product_id) VALUES(?,?)", [
    req.user.id,
    p.id,
  ]);
  ok(res, {});
});
app.delete("/api/favorites/:id", student, async (req, res) => {
  await rows("DELETE FROM favorites WHERE user_id=? AND product_id=?", [
    req.user.id,
    req.params.id,
  ]);
  ok(res, {});
});
async function conversation(cid, uid, c = pool, lock = false) {
  const cv = await one(
    "SELECT * FROM conversations WHERE id=?" + (lock ? " FOR UPDATE" : ""),
    [cid],
    c,
  );
  if (!cv || ![String(cv.buyer_id), String(cv.seller_id)].includes(String(uid)))
    fail("会话不存在", 404);
  return cv;
}
async function addMessage(
  c,
  cv,
  sender,
  text,
  offerId = null,
  clientId = null,
) {
  await rows(
    "UPDATE conversations SET sequence=sequence+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
    [cv.id],
    c,
  );
  const fresh = await one(
    "SELECT sequence FROM conversations WHERE id=?",
    [cv.id],
    c,
  );
  const r = await rows(
    "INSERT INTO messages(conversation_id,sequence,sender_id,text,offer_id,client_id) VALUES(?,?,?,?,?,?)",
    [cv.id, fresh.sequence, sender, text, offerId, clientId],
    c,
  );
  return String(r.insertId);
}
app.post("/api/conversations", student, async (req, res) => {
  const { productId } = z.object({ productId: id }).parse(req.body);
  const p = await one(
    "SELECT * FROM products WHERE id=? AND status='ON_SALE'",
    [productId],
  );
  if (!p) fail("商品已不可交易", 409);
  if (String(p.seller_id) === String(req.user.id)) fail("不能与自己交易");
  await rows(
    "INSERT IGNORE INTO conversations(product_id,buyer_id,seller_id) VALUES(?,?,?)",
    [p.id, req.user.id, p.seller_id],
  );
  ok(
    res,
    await one(
      "SELECT id FROM conversations WHERE product_id=? AND buyer_id=?",
      [p.id, req.user.id],
    ),
  );
});
app.get("/api/conversations", student, async (req, res) => {
  ok(
    res,
    await rows(
      `SELECT cv.*,p.title,p.price_cents,p.images,b.nickname buyer_name,s.nickname seller_name,(SELECT text FROM messages m WHERE m.conversation_id=cv.id ORDER BY sequence DESC LIMIT 1) last_message FROM conversations cv JOIN products p ON p.id=cv.product_id JOIN users b ON b.id=cv.buyer_id JOIN users s ON s.id=cv.seller_id WHERE cv.buyer_id=? OR cv.seller_id=? ORDER BY cv.updated_at DESC`,
      [req.user.id, req.user.id],
    ),
  );
});
app.get("/api/conversations/:id", student, async (req, res) => {
  const cv = await conversation(req.params.id, req.user.id);
  const p = await one(productSelect + " WHERE p.id=?", [
    req.user.id,
    cv.product_id,
  ]);
  const after = Math.max(0, Number(req.query.after) || 0);
  const messages = await rows(
    "SELECT * FROM messages WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT 500",
    [cv.id, after],
  );
  const offers = await rows(
    "SELECT * FROM offers WHERE conversation_id=? ORDER BY id",
    [cv.id],
  );
  ok(res, { conversation: cv, product: productView(p), messages, offers });
});
app.post("/api/conversations/:id/messages", student, async (req, res) => {
  const d = z
    .object({
      text: z.string().trim().min(1).max(2000),
      clientMessageId: z.string().uuid(),
    })
    .parse(req.body);
  const result = await transaction(async (c) => {
    const cv = await conversation(req.params.id, req.user.id, c, true);
    const old = await one(
      "SELECT id,conversation_id,text FROM messages WHERE sender_id=? AND client_id=?",
      [req.user.id, d.clientMessageId],
      c,
    );
    if (old) {
      if (String(old.conversation_id) !== String(cv.id) || old.text !== d.text)
        fail("消息标识冲突", 409);
      return { id: old.id, cv };
    }
    return {
      id: await addMessage(c, cv, req.user.id, d.text, null, d.clientMessageId),
      cv,
    };
  });
  emit(req, [result.cv.buyer_id, result.cv.seller_id]);
  ok(res, { id: result.id });
});
app.put("/api/conversations/:id/read", student, async (req, res) => {
  const cv = await conversation(req.params.id, req.user.id);
  const field =
    String(cv.buyer_id) === String(req.user.id) ? "buyer_read" : "seller_read";
  await rows(
    `UPDATE conversations SET ${field}=GREATEST(${field},LEAST(sequence,?)) WHERE id=?`,
    [Math.max(0, Number(req.body.sequence) || 0), cv.id],
  );
  ok(res, {});
});
app.post("/api/conversations/:id/offers", student, async (req, res) => {
  const d = z.object({ amountCents: money }).parse(req.body);
  const result = await transaction(async (c) => {
    const prelim = await conversation(req.params.id, req.user.id, c);
    const p = await one(
      "SELECT * FROM products WHERE id=? FOR UPDATE",
      [prelim.product_id],
      c,
    );
    const cv = await conversation(req.params.id, req.user.id, c, true);
    if (p.status !== "ON_SALE" || !p.negotiable) fail("商品暂不支持议价", 409);
    if (String(cv.buyer_id) !== String(req.user.id))
      fail("首次报价由买家发起", 403);
    const active = await one(
      "SELECT id FROM offers WHERE conversation_id=? AND ((status='PENDING' AND expires_at>UTC_TIMESTAMP()) OR (status='ACCEPTED' AND purchase_deadline>UTC_TIMESTAMP()))",
      [cv.id],
      c,
    );
    if (active) fail("已有报价待处理，请在报价卡片中操作", 409);
    if (d.amountCents >= p.price_cents) fail("砍价金额需要低于标价");
    const r = await rows(
      "INSERT INTO offers(conversation_id,proposer_id,recipient_id,amount_cents,product_version,expires_at) VALUES(?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR))",
      [cv.id, req.user.id, cv.seller_id, d.amountCents, p.version],
      c,
    );
    await addMessage(c, cv, req.user.id, "发起报价", r.insertId);
    return cv;
  });
  emit(req, [result.buyer_id, result.seller_id]);
  ok(res, {});
});
app.post("/api/offers/:id/:action", student, async (req, res) => {
  const action = z
    .enum(["accept", "reject", "counter", "withdraw"])
    .parse(req.params.action);
  const amount =
    action === "counter" ? money.parse(req.body.amountCents) : null;
  const cv = await transaction(async (c) => {
    const pre = await one(
      "SELECT cv.* FROM offers o JOIN conversations cv ON cv.id=o.conversation_id WHERE o.id=?",
      [req.params.id],
      c,
    );
    if (!pre) fail("报价不存在", 404);
    const p = await one(
      "SELECT * FROM products WHERE id=? FOR UPDATE",
      [pre.product_id],
      c,
    );
    const cv = await conversation(pre.id, req.user.id, c, true);
    const o = await one(
      "SELECT * FROM offers WHERE id=? FOR UPDATE",
      [req.params.id],
      c,
    );
    if (
      p.status !== "ON_SALE" ||
      p.version !== o.product_version ||
      o.status !== "PENDING" ||
      new Date(o.expires_at) <= new Date()
    )
      fail("报价已失效，请刷新", 409);
    if (action === "withdraw") {
      if (String(o.proposer_id) !== String(req.user.id))
        fail("只能撤回自己的报价", 403);
    } else if (String(o.recipient_id) !== String(req.user.id))
      fail("只有报价接收方可以操作", 403);
    if (action === "counter") {
      if (amount === o.amount_cents || amount > p.price_cents)
        fail("请给出不同且不超过标价的还价");
      const seller = String(req.user.id) === String(cv.seller_id);
      if (
        (seller && amount < o.amount_cents) ||
        (!seller && amount > o.amount_cents)
      )
        fail("还价方向不合理");
      await rows("UPDATE offers SET status='SUPERSEDED' WHERE id=?", [o.id], c);
      const r = await rows(
        "INSERT INTO offers(conversation_id,proposer_id,recipient_id,amount_cents,product_version,expires_at) VALUES(?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR))",
        [cv.id, req.user.id, o.proposer_id, amount, p.version],
        c,
      );
      await addMessage(c, cv, req.user.id, "提出还价", r.insertId);
    } else {
      const state = {
        accept: "ACCEPTED",
        reject: "REJECTED",
        withdraw: "WITHDRAWN",
      }[action];
      await rows(
        "UPDATE offers SET status=?,purchase_deadline=IF(?='ACCEPTED',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE),NULL) WHERE id=?",
        [state, state, o.id],
        c,
      );
      await addMessage(
        c,
        cv,
        req.user.id,
        {
          accept: "已接受报价，买家可在30分钟内下单。成功下单后才保留商品。",
          reject: "已拒绝该报价",
          withdraw: "已撤回报价",
        }[action],
      );
    }
    return cv;
  });
  emit(req, [cv.buyer_id, cv.seller_id]);
  ok(res, {});
});
async function meetupDetails(meetingAt, locationId) {
  const when = new Date(meetingAt);
  if (
    when.getTime() < Date.now() + 30 * 60000 ||
    when.getTime() > Date.now() + 30 * 86400000
  )
    fail("面交时间须在30分钟后至30天内");
  const location = await one("SELECT name FROM locations WHERE id=?", [
    locationId,
  ]);
  if (!location) fail("面交地点不存在");
  return {
    sql: when.toISOString().slice(0, 19).replace("T", " "),
    text:
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(when) +
      " · " +
      location.name,
  };
}
app.post("/api/orders", student, async (req, res) => {
  const d = z
    .object({
      productId: id,
      offerId: id.optional(),
      expectedProductVersion: z.number().int().positive(),
      meeting: z.string().trim().min(5).max(250).optional(),
      meetingAt: z.string().datetime({ offset: true }).optional(),
      locationId: z.number().int().positive().optional(),
    })
    .strict()
    .parse(req.body);
  if (
    Boolean(d.meetingAt) !== Boolean(d.locationId) ||
    (!d.meetingAt && !d.meeting)
  )
    fail("请选择完整的面交时间和地点");
  let meetingText = d.meeting;
  let meetupAtSql = null;
  if (d.meetingAt) {
    const details = await meetupDetails(d.meetingAt, d.locationId);
    meetupAtSql = details.sql;
    meetingText = details.text;
  }
  const key = z.string().min(8).max(80).parse(req.headers["idempotency-key"]);
  const digest = hash(JSON.stringify(d));
  const result = await transaction(async (c) => {
    const p = await one(
      "SELECT * FROM products WHERE id=? FOR UPDATE",
      [d.productId],
      c,
    );
    if (!p) fail("商品不存在", 404);
    const old = await one(
      "SELECT * FROM idempotency_keys WHERE user_id=? AND request_key=?",
      [req.user.id, key],
      c,
    );
    if (old) {
      if (old.request_hash !== digest)
        fail("同一请求标识不能用于不同订单", 409);
      return { id: String(old.order_id), seller_id: p.seller_id };
    }
    if (p.status !== "ON_SALE")
      fail("商品已被预订或下架", 409, "PRODUCT_UNAVAILABLE");
    if (String(p.seller_id) === String(req.user.id)) fail("不能购买自己的商品");
    if (p.version !== d.expectedProductVersion)
      fail("商品信息已改变，请重新确认", 409);
    const seller = await one(
      "SELECT status,verified_until FROM users WHERE id=?",
      [p.seller_id],
      c,
    );
    if (
      seller.status !== "ACTIVE" ||
      (seller.verified_until && new Date(seller.verified_until) < new Date())
    )
      fail("卖家暂不可交易", 409);
    let amount = p.price_cents;
    if (d.offerId) {
      const offer = await one(
        "SELECT o.*,cv.buyer_id,cv.product_id FROM offers o JOIN conversations cv ON cv.id=o.conversation_id WHERE o.id=? FOR UPDATE",
        [d.offerId],
        c,
      );
      if (
        !offer ||
        String(offer.product_id) !== d.productId ||
        String(offer.buyer_id) !== String(req.user.id) ||
        offer.status !== "ACCEPTED" ||
        new Date(offer.purchase_deadline) <= new Date() ||
        offer.product_version !== p.version
      )
        fail("议定价已失效", 409);
      amount = offer.amount_cents;
      await rows("UPDATE offers SET status='USED' WHERE id=?", [offer.id], c);
    }
    const snapshot = {
      title: p.title,
      images: json(p.images),
      description: p.description,
      condition: p.condition_code,
      originalPrice: p.price_cents,
    };
    const r = await rows(
      "INSERT INTO orders(order_no,product_id,buyer_id,seller_id,offer_id,amount_cents,snapshot,meeting,meetup_at,meetup_location_id,accept_deadline) VALUES(?,?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR))",
      [
        "XQ" + Date.now() + randomBytes(3).toString("hex"),
        p.id,
        req.user.id,
        p.seller_id,
        d.offerId || null,
        amount,
        JSON.stringify(snapshot),
        meetingText,
        meetupAtSql,
        d.locationId || null,
      ],
      c,
    );
    const oid = String(r.insertId);
    await rows(
      "INSERT INTO product_reservations(product_id,order_id) VALUES(?,?)",
      [p.id, oid],
      c,
    );
    await rows("UPDATE products SET status='RESERVED' WHERE id=?", [p.id], c);
    await invalidate(c, p.id);
    await rows(
      "INSERT INTO idempotency_keys(user_id,request_key,request_hash,order_id) VALUES(?,?,?,?)",
      [req.user.id, key, digest, oid],
      c,
    );
    await rows(
      "INSERT INTO order_events(order_id,actor_id,status,detail) VALUES(?,?,?,?)",
      [oid, req.user.id, "PENDING_ACCEPT", "买家下单，等待卖家确认面交约定"],
      c,
    );
    await notify(
      c,
      p.seller_id,
      "有新订单，请在24小时内确认：" + p.title,
      "/orders",
    );
    return { id: oid, seller_id: p.seller_id };
  });
  emit(req, [req.user.id, result.seller_id]);
  ok(res, { id: result.id });
});
app.get("/api/orders", async (req, res) => {
  const list = await rows(
    "SELECT o.*,b.nickname buyer_name,s.nickname seller_name,pl.name meetup_proposed_location_name,r.score review_score FROM orders o JOIN users b ON b.id=o.buyer_id JOIN users s ON s.id=o.seller_id LEFT JOIN locations pl ON pl.id=o.meetup_proposed_location_id LEFT JOIN order_reviews r ON r.order_id=o.id WHERE o.buyer_id=? OR o.seller_id=? ORDER BY o.id DESC",
    [req.user.id, req.user.id],
  );
  for (const o of list) {
    o.snapshot = json(o.snapshot);
    o.events = await rows(
      "SELECT * FROM order_events WHERE order_id=? ORDER BY id",
      [o.id],
    );
  }
  ok(res, list);
});
app.post("/api/orders/:id/review", student, async (req, res) => {
  const orderId = id.parse(req.params.id);
  const { score } = z
    .object({ score: z.number().int().min(1).max(5) })
    .strict()
    .parse(req.body);
  const sellerId = await transaction(async (c) => {
    const order = await one(
      "SELECT * FROM orders WHERE id=? FOR UPDATE",
      [orderId],
      c,
    );
    if (!order || String(order.buyer_id) !== String(req.user.id))
      fail("订单不存在", 404);
    if (order.status !== "COMPLETED") fail("订单完成后才能评价", 409);
    if (
      await one(
        "SELECT order_id FROM order_reviews WHERE order_id=?",
        [orderId],
        c,
      )
    )
      fail("这笔订单已经评价过", 409);
    await rows(
      "INSERT INTO order_reviews(order_id,buyer_id,seller_id,score) VALUES(?,?,?,?)",
      [orderId, req.user.id, order.seller_id, score],
      c,
    );
    await notify(
      c,
      order.seller_id,
      `买家已为完成的交易评价：${score}星`,
      "/me",
    );
    return order.seller_id;
  });
  emit(req, [req.user.id, sellerId]);
  ok(res, { score });
});
app.post("/api/orders/:id/meetup-proposal", student, async (req, res) => {
  const orderId = id.parse(req.params.id);
  const d = z
    .object({
      meetingAt: z.string().datetime({ offset: true }),
      locationId: z.number().int().positive(),
    })
    .strict()
    .parse(req.body);
  const details = await meetupDetails(d.meetingAt, d.locationId);
  const target = await transaction(async (c) => {
    const o = await one(
      "SELECT * FROM orders WHERE id=? FOR UPDATE",
      [orderId],
      c,
    );
    if (
      !o ||
      ![o.buyer_id, o.seller_id].some(
        (uid) => String(uid) === String(req.user.id),
      )
    )
      fail("订单不存在", 404);
    if (o.status !== "AWAITING_MEETUP") fail("当前订单不能改约", 409);
    if (
      o.meetup_proposed_by &&
      String(o.meetup_proposed_by) !== String(req.user.id)
    )
      fail("请先回应对方的改约请求", 409);
    await rows(
      "UPDATE orders SET meetup_proposed_at=?,meetup_proposed_location_id=?,meetup_proposed_by=? WHERE id=?",
      [details.sql, d.locationId, req.user.id, orderId],
      c,
    );
    await rows(
      "INSERT INTO order_events(order_id,actor_id,status,detail) VALUES(?,?,?,?)",
      [orderId, req.user.id, o.status, "提出改约：" + details.text],
      c,
    );
    const other =
      String(o.buyer_id) === String(req.user.id) ? o.seller_id : o.buyer_id;
    await notify(c, other, "对方提出改约：" + details.text, "/orders");
    return other;
  });
  emit(req, [target]);
  ok(res, {});
});
app.post(
  "/api/orders/:id/meetup-proposal/:action",
  student,
  async (req, res) => {
    const orderId = id.parse(req.params.id);
    const action = z.enum(["accept", "reject"]).parse(req.params.action);
    const target = await transaction(async (c) => {
      const o = await one(
        "SELECT * FROM orders WHERE id=? FOR UPDATE",
        [orderId],
        c,
      );
      if (
        !o ||
        ![o.buyer_id, o.seller_id].some(
          (uid) => String(uid) === String(req.user.id),
        )
      )
        fail("订单不存在", 404);
      if (
        o.status !== "AWAITING_MEETUP" ||
        !o.meetup_proposed_at ||
        String(o.meetup_proposed_by) === String(req.user.id)
      )
        fail("当前没有需要回应的改约请求", 409);
      let detail = "已拒绝改约，原面交约定不变";
      if (action === "accept") {
        if (new Date(o.meetup_proposed_at).getTime() < Date.now() + 30 * 60000)
          fail("改约时间已太近，请对方重新发起", 409);
        const newMeeting = await meetupDetails(
          o.meetup_proposed_at.toISOString(),
          o.meetup_proposed_location_id,
        );
        await rows(
          "UPDATE orders SET meeting=?,meetup_at=?,meetup_location_id=?,meetup_reminded_at=NULL WHERE id=?",
          [
            newMeeting.text,
            newMeeting.sql,
            o.meetup_proposed_location_id,
            orderId,
          ],
          c,
        );
        detail = "已同意改约：" + newMeeting.text;
      }
      await rows(
        "UPDATE orders SET meetup_proposed_at=NULL,meetup_proposed_location_id=NULL,meetup_proposed_by=NULL WHERE id=?",
        [orderId],
        c,
      );
      await rows(
        "INSERT INTO order_events(order_id,actor_id,status,detail) VALUES(?,?,?,?)",
        [orderId, req.user.id, o.status, detail],
        c,
      );
      await notify(c, o.meetup_proposed_by, detail, "/orders");
      return o.meetup_proposed_by;
    });
    emit(req, [target]);
    ok(res, {});
  },
);
async function orderTransition(c, oid, uid, action, reason, isAdmin = false) {
  const pre = await one("SELECT product_id FROM orders WHERE id=?", [oid], c);
  if (!pre) fail("订单不存在", 404);
  const p = await one(
    "SELECT * FROM products WHERE id=? FOR UPDATE",
    [pre.product_id],
    c,
  );
  const o = await one("SELECT * FROM orders WHERE id=? FOR UPDATE", [oid], c);
  const buyer = String(o.buyer_id) === String(uid),
    seller = String(o.seller_id) === String(uid);
  if (!isAdmin && !buyer && !seller) fail("订单不存在", 404);
  let state, productState;
  if (
    action === "accept" &&
    seller &&
    o.status === "PENDING_ACCEPT" &&
    new Date(o.accept_deadline) > new Date()
  )
    state = "AWAITING_MEETUP";
  if (action === "reject" && seller && o.status === "PENDING_ACCEPT") {
    state = "CANCELLED";
    productState = "ON_SALE";
  }
  if (
    action === "cancel" &&
    ["PENDING_ACCEPT", "AWAITING_MEETUP"].includes(o.status) &&
    (buyer || seller)
  ) {
    state = "CANCELLED";
    productState = "ON_SALE";
  }
  if (
    action === "deliver" &&
    seller &&
    o.status === "AWAITING_MEETUP" &&
    !o.meetup_proposed_by
  )
    state = "AWAITING_RECEIPT";
  if (action === "receive" && buyer && o.status === "AWAITING_RECEIPT") {
    state = "COMPLETED";
    productState = "SOLD";
  }
  if (
    action === "dispute" &&
    ["AWAITING_MEETUP", "AWAITING_RECEIPT"].includes(o.status) &&
    (buyer || seller)
  )
    state = "DISPUTED";
  if (isAdmin && o.status === "DISPUTED") {
    if (action === "close") {
      state = "CLOSED";
      productState = "OFF_SHELF";
    }
    if (action === "complete") {
      state = "COMPLETED";
      productState = "SOLD";
    }
  }
  if (
    action === "expire" &&
    isAdmin &&
    o.status === "PENDING_ACCEPT" &&
    new Date(o.accept_deadline) <= new Date()
  ) {
    state = "CLOSED";
    productState = "ON_SALE";
  }
  if (!state) fail("当前状态或身份不允许此操作", 409);
  if (state === "DISPUTED")
    await rows("UPDATE orders SET previous_status=status WHERE id=?", [oid], c);
  await rows(
    "UPDATE orders SET status=?,reason=? WHERE id=?",
    [state, reason || null, oid],
    c,
  );
  if (productState) {
    const reserve = await one(
      "SELECT order_id FROM product_reservations WHERE product_id=?",
      [p.id],
      c,
    );
    if (!reserve || String(reserve.order_id) !== String(oid))
      fail("订单预留状态异常，请联系管理员", 409);
    if (productState === "ON_SALE") {
      const u = await one(
        "SELECT status,verified_until FROM users WHERE id=?",
        [p.seller_id],
        c,
      );
      if (p.status === "REMOVED") productState = "REMOVED";
      else if (!accountActive(u)) productState = "OFF_SHELF";
    }
    await rows(
      "UPDATE products SET status=? WHERE id=?",
      [productState, p.id],
      c,
    );
    await rows(
      "DELETE FROM product_reservations WHERE product_id=? AND order_id=?",
      [p.id, oid],
      c,
    );
  }
  const details = {
    accept: "卖家已确认面交约定",
    reject: "卖家拒绝订单",
    cancel: "订单已取消",
    deliver: "卖家标记已交付，等待买家确认",
    receive: "买家确认收货，交易完成",
    dispute: "订单进入争议处理",
    close: "管理员关闭订单，商品保持下架",
    complete: "管理员核实交易完成",
    expire: "卖家确认超时，订单自动关闭",
  };
  await rows(
    "INSERT INTO order_events(order_id,actor_id,status,detail) VALUES(?,?,?,?)",
    [oid, uid, state, details[action] + (reason ? "：" + reason : "")],
    c,
  );
  await notify(c, o.buyer_id, details[action], "/orders");
  await notify(c, o.seller_id, details[action], "/orders");
  return o;
}
app.post("/api/orders/:id/:action", student, async (req, res) => {
  const action = z
    .enum(["accept", "reject", "cancel", "deliver", "receive", "dispute"])
    .parse(req.params.action);
  const reason = z
    .string()
    .max(500)
    .parse(req.body.reason || "");
  if (
    ["cancel", "reject", "dispute"].includes(action) &&
    reason.trim().length < 2
  )
    fail("请填写原因");
  const o = await transaction((c) =>
    orderTransition(c, req.params.id, req.user.id, action, reason),
  );
  emit(req, [o.buyer_id, o.seller_id]);
  ok(res, {});
});
app.post("/api/reports", student, async (req, res) => {
  const d = z
    .object({ productId: id, reason: z.string().trim().min(5).max(1000) })
    .parse(req.body);
  if (!(await one("SELECT id FROM products WHERE id=?", [d.productId])))
    fail("商品不存在", 404);
  await rows(
    "INSERT INTO reports(reporter_id,product_id,reason) VALUES(?,?,?)",
    [req.user.id, d.productId, d.reason],
  );
  ok(res, {});
});
app.get("/api/reports", student, async (req, res) =>
  ok(
    res,
    await rows(
      "SELECT r.*,p.title FROM reports r JOIN products p ON p.id=r.product_id WHERE reporter_id=? ORDER BY id DESC",
      [req.user.id],
    ),
  ),
);
app.use("/api/admin", admin);
app.get("/api/admin/overview", async (req, res) => {
  ok(res, {
    users: (await one("SELECT COUNT(*) n FROM users WHERE role<>'ADMIN'")).n,
    products: (await one("SELECT COUNT(*) n FROM products")).n,
    pending: (
      await one("SELECT COUNT(*) n FROM products WHERE status='PENDING_REVIEW'")
    ).n,
    orders: (await one("SELECT COUNT(*) n FROM orders")).n,
    volume: (
      await one(
        "SELECT COALESCE(SUM(amount_cents),0) n FROM orders WHERE status='COMPLETED'",
      )
    ).n,
  });
});
app.get("/api/admin/products", async (req, res) =>
  ok(
    res,
    (
      await rows(productSelect + " ORDER BY p.id DESC LIMIT 300", [req.user.id])
    ).map(productView),
  ),
);
app.post("/api/admin/products/:id/review", async (req, res) => {
  const d = z
    .object({
      action: z.enum(["approve", "reject", "remove"]),
      version: z.number().int(),
      reason: z.string().trim().min(2).max(500),
    })
    .parse(req.body);
  await transaction(async (c) => {
    const p = await one(
      "SELECT * FROM products WHERE id=? FOR UPDATE",
      [req.params.id],
      c,
    );
    if (!p) fail("商品不存在", 404);
    if (p.version !== d.version) fail("商品版本已更新", 409);
    if (d.action !== "remove" && p.status !== "PENDING_REVIEW")
      fail("商品不在待审核状态", 409);
    if (d.action === "approve") {
      if (
        await one(
          "SELECT order_id FROM product_reservations WHERE product_id=?",
          [p.id],
          c,
        )
      )
        fail("商品仍关联有效订单，不能重新上架", 409);
      const owner = await one(
        "SELECT status,verified_until FROM users WHERE id=?",
        [p.seller_id],
        c,
      );
      if (
        owner.status !== "ACTIVE" ||
        (owner.verified_until && new Date(owner.verified_until) <= new Date())
      )
        fail("卖家身份不可用，不能上架", 409);
    }
    if (d.action === "remove" && p.status === "SOLD")
      fail("已售商品保留交易记录，请处理举报", 409);
    const state = { approve: "ON_SALE", reject: "REJECTED", remove: "REMOVED" }[
      d.action
    ];
    await rows(
      "UPDATE products SET status=?,review_reason=? WHERE id=?",
      [state, d.reason, p.id],
      c,
    );
    if (d.action !== "approve") await invalidate(c, p.id);
    if (d.action === "remove" && p.status === "RESERVED") {
      const r = await one(
        "SELECT order_id FROM product_reservations WHERE product_id=?",
        [p.id],
        c,
      );
      if (r) {
        const o = await one(
          "SELECT * FROM orders WHERE id=? FOR UPDATE",
          [r.order_id],
          c,
        );
        if (o.status !== "DISPUTED") {
          await rows(
            "UPDATE orders SET previous_status=status,status='DISPUTED' WHERE id=?",
            [o.id],
            c,
          );
          await rows(
            "INSERT INTO order_events(order_id,actor_id,status,detail) VALUES(?,?,?,?)",
            [o.id, req.user.id, "DISPUTED", "商品违规下架：" + d.reason],
            c,
          );
          await notify(c, o.buyer_id, "订单商品被下架，订单进入争议处理");
        }
      }
    }
    await notify(c, p.seller_id, "商品审核结果：" + state + "；" + d.reason);
    await audit(c, req.user.id, "PRODUCT_" + d.action, p.id, d.reason);
  });
  ok(res, {});
});
app.get("/api/admin/users", async (req, res) =>
  ok(
    res,
    await rows(
      "SELECT id,login,nickname,role,status,verified_until,created_at FROM users WHERE role<>'ADMIN' ORDER BY id",
    ),
  ),
);
app.post("/api/admin/users/:id/status", async (req, res) => {
  const d = z
    .object({
      status: z.enum(["ACTIVE", "BANNED"]),
      reason: z.string().min(2).max(500),
    })
    .parse(req.body);
  await transaction(async (c) => {
    const u = await one(
      "SELECT id FROM users WHERE id=? AND role<>'ADMIN'",
      [req.params.id],
      c,
    );
    if (!u) fail("用户不存在", 404);
    await rows("UPDATE users SET status=? WHERE id=?", [d.status, u.id], c);
    await rows("DELETE FROM sessions WHERE user_id=?", [u.id], c);
    await audit(c, req.user.id, "USER_" + d.status, u.id, d.reason);
  });
  req.app
    .get("io")
    ?.in("user:" + req.params.id)
    .disconnectSockets(true);
  ok(res, {});
});
app.post("/api/admin/roster", async (req, res) => {
  const d = z
    .object({
      studentNo: z.string().regex(/^\d{6,20}$/),
      nickname: z.string().min(2).max(30),
      validUntil: z.string().datetime(),
    })
    .parse(req.body);
  if (new Date(d.validUntil) <= new Date()) fail("有效期必须晚于现在");
  await transaction(async (c) => {
    if (
      (await one(
        "SELECT student_no FROM roster WHERE student_no=?",
        [d.studentNo],
        c,
      )) ||
      (await one("SELECT id FROM users WHERE login=?", [d.studentNo], c))
    )
      fail("此学号已存在", 409);
    await rows(
      "INSERT INTO roster(student_no,nickname,expires_at) VALUES(?,?,?)",
      [d.studentNo, d.nickname, new Date(d.validUntil)],
      c,
    );
    await audit(c, req.user.id, "ROSTER_ADD", d.studentNo, "录入授权学生名册");
  });
  ok(res, { studentNo: d.studentNo });
});
app.get("/api/admin/orders", async (req, res) => {
  const list = await rows(
    "SELECT o.*,b.nickname buyer_name,s.nickname seller_name FROM orders o JOIN users b ON b.id=o.buyer_id JOIN users s ON s.id=o.seller_id ORDER BY o.id DESC LIMIT 300",
  );
  for (const o of list) {
    o.snapshot = json(o.snapshot);
    o.events = await rows(
      "SELECT * FROM order_events WHERE order_id=? ORDER BY id",
      [o.id],
    );
  }
  ok(res, list);
});
app.post("/api/admin/orders/:id/resolve", async (req, res) => {
  const d = z
    .object({
      action: z.enum(["close", "complete"]),
      reason: z.string().min(5).max(500),
    })
    .parse(req.body);
  await transaction(async (c) => {
    await orderTransition(
      c,
      req.params.id,
      req.user.id,
      d.action,
      d.reason,
      true,
    );
    await audit(c, req.user.id, "ORDER_RESOLVE", req.params.id, d.reason);
  });
  ok(res, {});
});
app.get("/api/admin/reports", async (req, res) =>
  ok(
    res,
    await rows(
      "SELECT r.*,p.title,u.nickname FROM reports r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.reporter_id ORDER BY r.id DESC",
    ),
  ),
);
app.post("/api/admin/reports/:id/resolve", async (req, res) => {
  const d = z
    .object({ resolution: z.string().min(5).max(1000) })
    .parse(req.body);
  await transaction(async (c) => {
    const r = await one(
      "SELECT * FROM reports WHERE id=? AND status='PENDING' FOR UPDATE",
      [req.params.id],
      c,
    );
    if (!r) fail("举报已处理或不存在", 409);
    await rows(
      "UPDATE reports SET status='RESOLVED',resolution=? WHERE id=?",
      [d.resolution, r.id],
      c,
    );
    await notify(c, r.reporter_id, "举报处理结果：" + d.resolution);
    await audit(c, req.user.id, "REPORT_RESOLVE", r.id, d.resolution);
  });
  ok(res, {});
});
app.get("/api/admin/audit", async (req, res) =>
  ok(
    res,
    await rows(
      "SELECT a.*,u.nickname FROM audit_logs a JOIN users u ON u.id=a.admin_id ORDER BY id DESC LIMIT 200",
    ),
  ),
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: { message: "接口不存在" } }),
);
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.use((err, req, res, next) => {
  if (err instanceof z.ZodError)
    return res.status(422).json({
      error: {
        message: err.issues
          .map((x) => x.path.join(".") + ": " + x.message)
          .join("；"),
      },
    });
  if (err.code === "LIMIT_FILE_SIZE")
    return res.status(422).json({ error: { message: "图片不能超过5MB" } });
  const status = err.status || (err.code === "ER_DUP_ENTRY" ? 409 : 500);
  if (status >= 500 && err.code !== "NOT_CONFIGURED")
    console.error(req.requestId, err);
  res.status(status).json({
    error: {
      message:
        status >= 500 && err.code !== "NOT_CONFIGURED"
          ? "服务暂时不可用，请稍后重试"
          : err.message,
      code: err.code || "REQUEST_ERROR",
    },
    requestId: req.requestId,
  });
});
export async function sweep(io) {
  const expired = await rows(
    "SELECT id FROM orders WHERE status='PENDING_ACCEPT' AND accept_deadline<=UTC_TIMESTAMP() LIMIT 100",
  );
  for (const o of expired)
    try {
      await transaction((c) =>
        orderTransition(c, o.id, null, "expire", "", true),
      );
    } catch (e) {
      if (e.status !== 409) console.error("sweep", e.message);
    }
  const upcoming = await rows(
    "SELECT id FROM orders WHERE status='AWAITING_MEETUP' AND meetup_at BETWEEN UTC_TIMESTAMP() AND DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 HOUR) AND meetup_reminded_at IS NULL LIMIT 100",
  );
  for (const item of upcoming) {
    const reminded = await transaction(async (c) => {
      const order = await one(
        "SELECT * FROM orders WHERE id=? FOR UPDATE",
        [item.id],
        c,
      );
      if (
        !order ||
        order.status !== "AWAITING_MEETUP" ||
        order.meetup_reminded_at ||
        new Date(order.meetup_at) < new Date()
      )
        return null;
      await rows(
        "UPDATE orders SET meetup_reminded_at=UTC_TIMESTAMP() WHERE id=?",
        [order.id],
        c,
      );
      await notify(
        c,
        order.buyer_id,
        "面交时间临近：" + order.meeting,
        "/orders",
      );
      await notify(
        c,
        order.seller_id,
        "面交时间临近：" + order.meeting,
        "/orders",
      );
      return [order.buyer_id, order.seller_id];
    });
    for (const uid of reminded || []) io?.to("user:" + uid)?.emit("sync");
  }
  await rows(
    "UPDATE offers SET status='EXPIRED' WHERE (status='PENDING' AND expires_at<=UTC_TIMESTAMP()) OR (status='ACCEPTED' AND purchase_deadline<=UTC_TIMESTAMP())",
  );
  await rows("DELETE FROM sessions WHERE expires_at<UTC_TIMESTAMP()");
}
