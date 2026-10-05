import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import sharp from "sharp";
import request from "supertest";
process.env.DB_NAME = "xiqi_market_test";
process.env.NODE_ENV = "test";
const { app, sweep } = await import("../server/app.js");
const { pool, rows, one } = await import("../server/db.js");
let buyer,
  seller,
  other,
  admin,
  buyerId,
  sellerId,
  assetId,
  pid,
  cvId,
  offerId,
  oid;
const key = randomUUID();
async function agent(login) {
  const a = request.agent(app);
  let csrf = (await a.get("/api/auth/csrf")).body.data.token;
  const r = await a
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ login, password: "TestCampus2026!" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  csrf = r.body.data.csrf;
  return {
    a,
    call(method, url, data = {}, headers = {}) {
      let req = a[method](url).set("X-CSRF-Token", csrf);
      for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
      return req.send(data);
    },
  };
}
before(async () => {
  const sql = await readFile(
    new URL("../server/schema.sql", import.meta.url),
    "utf8",
  );
  for (const s of sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await pool.query(s);
  for (const [name, definition] of [
    ["phone", "VARCHAR(11) NULL UNIQUE"],
    ["wechat_openid", "VARCHAR(100) NULL UNIQUE"],
  ]) {
    const [columns] = await pool.query("SHOW COLUMNS FROM users LIKE ?", [
      name,
    ]);
    if (!columns.length)
      await pool.query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  }
  await pool.query(
    "ALTER TABLE users MODIFY COLUMN verified_until DATETIME NULL",
  );
  await pool.query("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'USER'");
  for (const [table, name, definition] of [
    ["orders", "meetup_at", "DATETIME NULL"],
    ["orders", "meetup_location_id", "INT NULL"],
    ["orders", "meetup_reminded_at", "DATETIME NULL"],
    ["orders", "meetup_proposed_at", "DATETIME NULL"],
    ["orders", "meetup_proposed_location_id", "INT NULL"],
    ["orders", "meetup_proposed_by", "BIGINT UNSIGNED NULL"],
    ["notifications", "target_path", "VARCHAR(200) NULL"],
  ]) {
    const [columns] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [
      name,
    ]);
    if (!columns.length)
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  const [oldActivationColumn] = await pool.query(
    "SHOW COLUMNS FROM roster LIKE 'activation_hash'",
  );
  if (oldActivationColumn.length)
    await pool.query("ALTER TABLE roster DROP COLUMN activation_hash");
  await pool.query("SET FOREIGN_KEY_CHECKS=0");
  for (const t of [
    "idempotency_keys",
    "product_reservations",
    "order_events",
    "order_reviews",
    "orders",
    "messages",
    "offers",
    "conversations",
    "favorites",
    "assets",
    "products",
    "notifications",
    "reports",
    "audit_logs",
    "sessions",
    "roster",
    "phone_codes",
    "password_reset_codes",
    "users",
    "categories",
    "locations",
  ])
    await pool.query("TRUNCATE TABLE " + t);
  await pool.query("SET FOREIGN_KEY_CHECKS=1");
  const ph = await argon2.hash("TestCampus2026!");
  for (const [login, nick, role] of [
    ["testbuyer", "买家", "STUDENT"],
    ["testseller", "卖家", "STUDENT"],
    ["testother", "其他同学", "STUDENT"],
    ["testadmin", "管理员", "ADMIN"],
  ])
    await rows(
      "INSERT INTO users(login,password_hash,nickname,role,verified_until) VALUES(?,?,?,?,?)",
      [login, ph, nick, role, "2030-01-01"],
    );
  await rows("INSERT INTO categories VALUES(1,'数码','Laptop')");
  await rows("INSERT INTO locations VALUES(1,'测试广场')");
  buyer = await agent("testbuyer");
  seller = await agent("testseller");
  other = await agent("testother");
  admin = await agent("testadmin");
  buyerId = (await one("SELECT id FROM users WHERE login='testbuyer'")).id;
  sellerId = (await one("SELECT id FROM users WHERE login='testseller'")).id;
});
after(async () => pool.end());
test("访客可浏览；未登录不能交易；普通用户不能进入后台；写请求需要CSRF", async () => {
  assert.equal((await request(app).get("/api/products")).status, 200);
  assert.equal((await request(app).get("/api/meta")).status, 200);
  assert.equal((await request(app).get("/api/orders")).status, 401);
  assert.equal((await buyer.call("get", "/api/admin/users")).status, 403);
  assert.equal((await buyer.a.post("/api/products").send({})).status, 403);
});
test("手机号注册须有授权名册及正确短信码，学号和手机号均可登录", async () => {
  const student = "20990001",
    mobile = "13800000009";
  const rosterResult = await admin.call("post", "/api/admin/roster", {
    studentNo: student,
    nickname: "新同学",
    validUntil: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(rosterResult.status, 200);
  assert.equal(rosterResult.body.data.code, undefined);
  const a = request.agent(app),
    csrf = (await a.get("/api/auth/csrf")).body.data.token;
  const register = (body) =>
    a.post("/api/auth/register").set("X-CSRF-Token", csrf).send(body);
  assert.equal(
    (
      await a
        .post("/api/auth/phone-code")
        .set("X-CSRF-Token", csrf)
        .send({ studentNo: "20999999", phone: mobile })
    ).status,
    403,
  );
  const codeResponse = await a
    .post("/api/auth/phone-code")
    .set("X-CSRF-Token", csrf)
    .send({ studentNo: student, phone: mobile });
  assert.equal(codeResponse.status, 200, JSON.stringify(codeResponse.body));
  const code = codeResponse.body.data.demoCode;
  assert.match(code, /^\d{6}$/);
  const payload = {
    studentNo: student,
    phone: mobile,
    code,
    password: "LongTestPass123!",
    nickname: "新同学",
  };
  assert.equal((await register({ ...payload, code: "000000" })).status, 400);
  assert.equal(
    (
      await one(
        "SELECT attempts FROM phone_codes WHERE phone=? AND student_no=?",
        [mobile, student],
      )
    ).attempts,
    1,
  );
  assert.equal((await register(payload)).status, 200);
  assert.equal((await register(payload)).status, 403);
  assert.equal(
    (await one("SELECT COUNT(*) n FROM users WHERE login=?", [student])).n,
    "1",
  );
  const activeSessions = [];
  for (const login of [student, mobile]) {
    const b = request.agent(app);
    activeSessions.push(b);
    const token = (await b.get("/api/auth/csrf")).body.data.token;
    assert.equal(
      (
        await b
          .post("/api/auth/login")
          .set("X-CSRF-Token", token)
          .send({ login, password: payload.password })
      ).status,
      200,
    );
  }
  const resetCode = await a
    .post("/api/auth/password-reset/code")
    .set("X-CSRF-Token", csrf)
    .send({ studentNo: student, phone: mobile });
  assert.equal(resetCode.status, 200);
  assert.match(resetCode.body.data.demoCode, /^\d{6}$/);
  const resetBody = {
    studentNo: student,
    phone: mobile,
    code: resetCode.body.data.demoCode,
    newPassword: "ChangedCampus2026!",
  };
  assert.equal(
    (
      await a
        .post("/api/auth/password-reset")
        .set("X-CSRF-Token", csrf)
        .send({ ...resetBody, code: "000000" })
    ).status,
    400,
  );
  assert.equal(
    (
      await a
        .post("/api/auth/password-reset")
        .set("X-CSRF-Token", csrf)
        .send(resetBody)
    ).status,
    200,
  );
  for (const session of activeSessions)
    assert.equal((await session.get("/api/auth/me")).status, 401);
  const previousLogin = request.agent(app);
  const previousCsrf = (await previousLogin.get("/api/auth/csrf")).body.data
    .token;
  assert.equal(
    (
      await previousLogin
        .post("/api/auth/login")
        .set("X-CSRF-Token", previousCsrf)
        .send({ login: student, password: payload.password })
    ).status,
    401,
  );
  assert.equal(
    (
      await previousLogin
        .post("/api/auth/login")
        .set("X-CSRF-Token", previousCsrf)
        .send({ login: student, password: resetBody.newPassword })
    ).status,
    200,
  );
});
test("大众用户无需学号可注册、登录、发布，并可凭手机号重置密码", async () => {
  const mobile = "13900000018";
  const client = request.agent(app);
  const token = (await client.get("/api/auth/csrf")).body.data.token;
  const send = (path, body) =>
    client.post(path).set("X-CSRF-Token", token).send(body);
  const codeResponse = await send("/api/auth/public/phone-code", {
    phone: mobile,
  });
  assert.equal(codeResponse.status, 200, JSON.stringify(codeResponse.body));
  const details = {
    phone: mobile,
    code: codeResponse.body.data.demoCode,
    nickname: "同城买家",
    password: "PublicPass2026!",
  };
  assert.equal(
    (await send("/api/auth/public/register", { ...details, code: "000000" }))
      .status,
    400,
  );
  assert.equal((await send("/api/auth/public/register", details)).status, 200);
  assert.equal((await send("/api/auth/public/register", details)).status, 400);
  const account = await one(
    "SELECT role,verified_until FROM users WHERE phone=?",
    [mobile],
  );
  assert.equal(account.role, "USER");
  assert.equal(account.verified_until, null);
  const login = await send("/api/auth/login", {
    login: mobile,
    password: details.password,
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.data.user.role, "USER");
  assert.equal((await client.get("/api/admin/users")).status, 403);
  const image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#d2deac" },
  })
    .png()
    .toBuffer();
  const upload = await client
    .post("/api/uploads")
    .set("X-CSRF-Token", login.body.data.csrf)
    .attach("file", image, "public.png");
  assert.equal(upload.status, 200, JSON.stringify(upload.body));
  const product = await client
    .post("/api/products")
    .set("X-CSRF-Token", login.body.data.csrf)
    .send({
      title: "同城闲置背包",
      description: "普通用户发布的同城二手背包，欢迎面交查看。",
      categoryId: 1,
      locationId: 1,
      condition: "几乎全新",
      priceCents: 5000,
      negotiable: true,
      images: [upload.body.data.id],
    });
  assert.equal(product.status, 200, JSON.stringify(product.body));
  const resetCode = await client
    .post("/api/auth/public/password-reset/code")
    .set("X-CSRF-Token", login.body.data.csrf)
    .send({ phone: mobile });
  assert.equal(resetCode.status, 200, JSON.stringify(resetCode.body));
  const reset = await client
    .post("/api/auth/public/password-reset")
    .set("X-CSRF-Token", login.body.data.csrf)
    .send({
      phone: mobile,
      code: resetCode.body.data.demoCode,
      newPassword: "NewPublicPass2026!",
    });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal((await client.get("/api/auth/me")).status, 401);
});
test("商品图片上传、发布待审核；其他学生不能编辑或查看待审图片", async () => {
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#d2deac" },
  })
    .png()
    .toBuffer();
  const token = (await seller.a.get("/api/auth/csrf")).body.data.token;
  const upload = await seller.a
    .post("/api/uploads")
    .set("X-CSRF-Token", token)
    .attach("file", image, "test.png");
  assert.equal(upload.status, 200, JSON.stringify(upload.body));
  assetId = upload.body.data.id;
  const r = await seller.call("post", "/api/products", {
    title: "测试耳机",
    description: "这是测试用的完好耳机，可以当面查看。",
    categoryId: 1,
    locationId: 1,
    condition: "几乎全新",
    priceCents: 12000,
    negotiable: true,
    images: [assetId],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  pid = r.body.data.id;
  assert.equal((await buyer.call("get", "/api/assets/" + assetId)).status, 404);
  const wrong = await buyer.call("patch", "/api/products/" + pid, {
    title: "越权编辑",
    description: "测试另一名用户能否修改他人的商品",
    categoryId: 1,
    locationId: 1,
    condition: "几乎全新",
    priceCents: 1,
    negotiable: true,
    images: [assetId],
    version: 1,
  });
  assert.equal(wrong.status, 403);
  assert.equal((await buyer.call("get", "/api/products/" + pid)).status, 404);
});
test("拒绝伪造图片；审核通过商品可搜索和收藏", async () => {
  const csrf = (await seller.a.get("/api/auth/csrf")).body.data.token;
  const bad = await seller.a
    .post("/api/uploads")
    .set("X-CSRF-Token", csrf)
    .attach("file", Buffer.from('<svg onload="alert(1)"></svg>'), "fake.png");
  assert.equal(bad.status, 400);
  assert.equal(
    (
      await admin.call("post", `/api/admin/products/${pid}/review`, {
        action: "approve",
        version: 1,
        reason: "测试审核通过",
      })
    ).status,
    200,
  );
  assert.equal(
    (await buyer.call("get", "/api/products?q=耳机")).body.data.length,
    1,
  );
  assert.equal((await request(app).get("/api/products/" + pid)).status, 200);
  assert.equal((await request(app).get("/api/assets/" + assetId)).status, 200);
  const page = await buyer.call("get", "/api/products?q=耳机&page=1");
  assert.equal(page.status, 200);
  assert.equal(page.body.data.total, 1);
  assert.equal(page.body.data.items.length, 1);
  assert.equal((await buyer.call("put", "/api/favorites/" + pid)).status, 200);
  await buyer.call("put", "/api/favorites/" + pid);
  assert.equal((await one("SELECT COUNT(*) n FROM favorites")).n, "1");
});
test("商品分页返回真实总数，按当前偏移加载不漏商品", async () => {
  for (let i = 0; i < 25; i++)
    await rows(
      "INSERT INTO products(seller_id,category_id,location_id,title,description,condition_code,price_cents,negotiable,images,status) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [
        sellerId,
        1,
        1,
        `分页测试商品${i}`,
        "分页测试商品描述",
        "全新",
        1000,
        0,
        JSON.stringify([assetId]),
        "ON_SALE",
      ],
    );
  const first = (await buyer.call("get", "/api/products?q=分页测试&page=1"))
    .body.data;
  const second = (
    await buyer.call("get", "/api/products?q=分页测试&page=2&offset=20")
  ).body.data;
  const shifted = (
    await buyer.call("get", "/api/products?q=分页测试&page=2&offset=19")
  ).body.data;
  assert.equal(first.total, 25);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 5);
  assert.equal(shifted.items.length, 6);
  assert.equal(
    new Set([...first.items, ...second.items].map((p) => p.id)).size,
    25,
  );
});
test("聊天成员隔离；重复发送不重复入库", async () => {
  cvId = (await buyer.call("post", "/api/conversations", { productId: pid }))
    .body.data.id;
  const body = { text: "你好，商品还在吗？", clientMessageId: randomUUID() };
  assert.equal(
    (await buyer.call("post", `/api/conversations/${cvId}/messages`, body))
      .status,
    200,
  );
  assert.equal(
    (await buyer.call("post", `/api/conversations/${cvId}/messages`, body))
      .status,
    200,
  );
  assert.equal(
    (
      await one("SELECT COUNT(*) n FROM messages WHERE conversation_id=?", [
        cvId,
      ])
    ).n,
    "1",
  );
  assert.equal(
    (await other.call("get", "/api/conversations/" + cvId)).status,
    404,
  );
});
test("完整议价：90元报价→105元还价→接受；旧报价操作失败", async () => {
  assert.equal(
    (
      await buyer.call("post", `/api/conversations/${cvId}/offers`, {
        amountCents: 9000,
      })
    ).status,
    200,
  );
  const old = await one(
    "SELECT * FROM offers WHERE conversation_id=? ORDER BY id DESC LIMIT 1",
    [cvId],
  );
  assert.equal(
    (await buyer.call("post", `/api/offers/${old.id}/accept`)).status,
    403,
  );
  assert.equal(
    (
      await seller.call("post", `/api/offers/${old.id}/counter`, {
        amountCents: 10500,
      })
    ).status,
    200,
  );
  assert.equal(
    (await seller.call("post", `/api/offers/${old.id}/accept`)).status,
    409,
  );
  offerId = String(
    (
      await one(
        "SELECT id FROM offers WHERE conversation_id=? ORDER BY id DESC LIMIT 1",
        [cvId],
      )
    ).id,
  );
  assert.equal(
    (await buyer.call("post", `/api/offers/${offerId}/accept`)).status,
    200,
  );
  assert.equal(
    (await one("SELECT status FROM products WHERE id=?", [pid])).status,
    "ON_SALE",
  );
});
test("下单按服务端议定价；重放返回原订单；客户端不能篡改价格", async () => {
  const body = {
    productId: pid,
    offerId,
    expectedProductVersion: 1,
    meetingAt: new Date(Date.now() + 60 * 60000).toISOString(),
    locationId: 1,
  };
  const bad = await buyer.call(
    "post",
    "/api/orders",
    { ...body, amountCents: 1 },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(bad.status, 422);
  const r = await buyer.call("post", "/api/orders", body, {
    "Idempotency-Key": key,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  oid = r.body.data.id;
  const scheduled = await one(
    "SELECT meeting,meetup_at,meetup_location_id FROM orders WHERE id=?",
    [oid],
  );
  assert.equal(scheduled.meetup_location_id, 1);
  assert.match(scheduled.meeting, /测试广场/);
  assert.equal(
    Number(
      (await one("SELECT amount_cents FROM orders WHERE id=?", [oid]))
        .amount_cents,
    ),
    10500,
  );
  const repeat = await buyer.call("post", "/api/orders", body, {
    "Idempotency-Key": key,
  });
  assert.equal(repeat.body.data.id, oid);
  assert.equal(
    (
      await buyer.call(
        "post",
        "/api/orders",
        { ...body, meeting: "不同地点不同请求" },
        { "Idempotency-Key": key },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await other.call(
        "post",
        "/api/orders",
        { productId: pid, expectedProductVersion: 1, meeting: "明天学校广场" },
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    409,
  );
});
test("卖家接单→交付→买家收货，商品已售且无法再次下单", async () => {
  assert.equal(
    (await buyer.call("post", `/api/orders/${oid}/review`, { score: 5 }))
      .status,
    409,
  );
  assert.equal(
    (await buyer.call("post", `/api/orders/${oid}/accept`)).status,
    409,
  );
  assert.equal(
    (await seller.call("post", `/api/orders/${oid}/accept`)).status,
    200,
  );
  const proposal = {
    meetingAt: new Date(Date.now() + 90 * 60000).toISOString(),
    locationId: 1,
  };
  const originalMeetingAt = (
    await one("SELECT meetup_at FROM orders WHERE id=?", [oid])
  ).meetup_at.getTime();
  assert.equal(
    (await other.call("post", `/api/orders/${oid}/meetup-proposal`, proposal))
      .status,
    404,
  );
  assert.equal(
    (await buyer.call("post", `/api/orders/${oid}/meetup-proposal`, proposal))
      .status,
    200,
  );
  assert.equal(
    (await seller.call("post", `/api/orders/${oid}/meetup-proposal/reject`))
      .status,
    200,
  );
  assert.equal(
    (
      await one("SELECT meetup_at FROM orders WHERE id=?", [oid])
    ).meetup_at.getTime(),
    originalMeetingAt,
  );
  assert.equal(
    (await buyer.call("post", `/api/orders/${oid}/meetup-proposal`, proposal))
      .status,
    200,
  );
  assert.equal(
    (await buyer.call("post", `/api/orders/${oid}/meetup-proposal/accept`))
      .status,
    409,
  );
  assert.equal(
    (await seller.call("post", `/api/orders/${oid}/meetup-proposal/accept`))
      .status,
    200,
  );
  assert.equal(
    (await one("SELECT meetup_proposed_by FROM orders WHERE id=?", [oid]))
      .meetup_proposed_by,
    null,
  );
  await sweep();
  assert.equal(
    Number(
      (
        await one(
          "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND text LIKE '面交时间临近%'",
          [buyerId],
        )
      ).n,
    ),
    1,
  );
  const unread = await buyer.call("get", "/api/notifications/unread-count");
  assert.ok(Number(unread.body.data.count) > 0);
  const reminder = await one(
    "SELECT id,target_path FROM notifications WHERE user_id=? AND text LIKE '面交时间临近%'",
    [buyerId],
  );
  assert.equal(reminder.target_path, "/orders");
  assert.equal(
    (await buyer.call("post", `/api/notifications/${reminder.id}/read`)).status,
    200,
  );
  assert.equal(
    (await one("SELECT read_at FROM notifications WHERE id=?", [reminder.id]))
      .read_at !== null,
    true,
  );
  for (const [a, action] of [
    [seller, "deliver"],
    [buyer, "receive"],
  ])
    assert.equal(
      (await a.call("post", `/api/orders/${oid}/${action}`)).status,
      200,
    );
  assert.equal(
    (await one("SELECT status FROM orders WHERE id=?", [oid])).status,
    "COMPLETED",
  );
  assert.equal(
    (await one("SELECT status FROM products WHERE id=?", [pid])).status,
    "SOLD",
  );
  assert.equal(
    (await one("SELECT COUNT(*) n FROM product_reservations")).n,
    "0",
  );
  assert.equal(
    (
      await other.call(
        "post",
        "/api/orders",
        { productId: pid, expectedProductVersion: 1, meeting: "测试面交地点" },
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    409,
  );
});
test("完成订单后买家只能评价一次，评分进入卖家展示", async () => {
  const url = `/api/orders/${oid}/review`;
  assert.equal((await seller.call("post", url, { score: 1 })).status, 404);
  assert.equal((await other.call("post", url, { score: 1 })).status, 404);
  assert.equal((await buyer.call("post", url, { score: 6 })).status, 422);
  const first = await buyer.call("post", url, { score: 4 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal((await buyer.call("post", url, { score: 5 })).status, 409);
  const reputation = await request(app).get(
    `/api/sellers/${sellerId}/reputation`,
  );
  assert.equal(reputation.status, 200);
  assert.deepEqual(reputation.body.data, { reviewCount: 1, rating: 4 });
  const orders = await buyer.call("get", "/api/orders");
  assert.equal(
    orders.body.data.find((o) => String(o.id) === String(oid)).review_score,
    4,
  );
});
async function freshProduct() {
  const r = await rows(
    "INSERT INTO products(seller_id,category_id,location_id,title,description,condition_code,price_cents,images,status) VALUES(?,1,1,'并发商品','测试描述内容足够长','全新',10000,?,'ON_SALE')",
    [sellerId, JSON.stringify([assetId])],
  );
  return String(r.insertId);
}
test("10个独立买家并发下单，恰好一笔订单和一条预留", async () => {
  const p = await freshProduct(),
    ph = await argon2.hash("TestCampus2026!");
  const agents = [];
  for (let i = 0; i < 10; i++) {
    await rows(
      "INSERT INTO users(login,password_hash,nickname,verified_until) VALUES(?,?,?,?)",
      ["race" + i, ph, "并发同学" + i, "2030-01-01"],
    );
    agents.push(await agent("race" + i));
  }
  const results = await Promise.all(
    agents.map((a) =>
      a.call(
        "post",
        "/api/orders",
        {
          productId: p,
          expectedProductVersion: 1,
          meeting: "并发测试 校内广场",
        },
        { "Idempotency-Key": randomUUID() },
      ),
    ),
  );
  assert.equal(
    results.filter((r) => r.status === 200).length,
    1,
    JSON.stringify(results.map((r) => [r.status, r.body])),
  );
  assert.equal(results.filter((r) => r.status === 409).length, 9);
  assert.equal(
    (
      await one(
        "SELECT COUNT(*) n FROM product_reservations WHERE product_id=?",
        [p],
      )
    ).n,
    "1",
  );
});
test("取消订单释放商品；过期订单扫尾关闭", async () => {
  const p = await freshProduct(),
    body = { productId: p, expectedProductVersion: 1, meeting: "明天测试广场" };
  let r = await buyer.call("post", "/api/orders", body, {
    "Idempotency-Key": randomUUID(),
  });
  assert.equal(
    (
      await buyer.call("post", `/api/orders/${r.body.data.id}/cancel`, {
        reason: "时间不合适",
      })
    ).status,
    200,
  );
  assert.equal(
    (await one("SELECT status FROM products WHERE id=?", [p])).status,
    "ON_SALE",
  );
  r = await buyer.call("post", "/api/orders", body, {
    "Idempotency-Key": randomUUID(),
  });
  await rows(
    "UPDATE orders SET accept_deadline=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?",
    [r.body.data.id],
  );
  await sweep();
  assert.equal(
    (await one("SELECT status FROM orders WHERE id=?", [r.body.data.id]))
      .status,
    "CLOSED",
  );
  assert.equal(
    (await one("SELECT status FROM products WHERE id=?", [p])).status,
    "ON_SALE",
  );
});
test("商品在途被下架，订单转争议；关闭争议保持下架", async () => {
  const p = await freshProduct(),
    r = await buyer.call(
      "post",
      "/api/orders",
      { productId: p, expectedProductVersion: 1, meeting: "校内公共地点面交" },
      { "Idempotency-Key": randomUUID() },
    ),
    o = r.body.data.id;
  assert.equal(
    (
      await admin.call("post", `/api/admin/products/${p}/review`, {
        action: "remove",
        version: 1,
        reason: "商品存在违规内容",
      })
    ).status,
    200,
  );
  assert.equal(
    (await one("SELECT status FROM orders WHERE id=?", [o])).status,
    "DISPUTED",
  );
  assert.equal(
    (
      await seller.call("patch", `/api/products/${p}`, {
        title: "试图重卖争议商品",
        description: "商品订单尚未结案，不应该允许编辑重卖。",
        categoryId: 1,
        locationId: 1,
        condition: "全新",
        priceCents: 10000,
        negotiable: true,
        images: [assetId],
        version: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await admin.call("post", `/api/admin/orders/${o}/resolve`, {
        action: "close",
        reason: "核实未完成交付，关闭订单",
      })
    ).status,
    200,
  );
  assert.equal(
    (await one("SELECT status FROM products WHERE id=?", [p])).status,
    "OFF_SHELF",
  );
});
test("举报处理可追踪，封禁撤销会话", async () => {
  await buyer.call("post", "/api/reports", {
    productId: pid,
    reason: "测试举报商品描述有误",
  });
  const r = await one("SELECT id FROM reports ORDER BY id DESC LIMIT 1");
  assert.equal(
    (
      await admin.call("post", `/api/admin/reports/${r.id}/resolve`, {
        resolution: "核实是演示商品，已解释说明",
      })
    ).status,
    200,
  );
  assert.equal(
    (await buyer.call("get", "/api/reports")).body.data[0].status,
    "RESOLVED",
  );
  const uid = (await one("SELECT id FROM users WHERE login='testother'")).id;
  assert.equal(
    (
      await admin.call("post", `/api/admin/users/${uid}/status`, {
        status: "BANNED",
        reason: "测试封禁规则",
      })
    ).status,
    200,
  );
  assert.equal((await other.call("get", "/api/products")).status, 200);
  assert.equal((await other.call("get", "/api/orders")).status, 401);
});
test("账号设置更新昵称和密码；微信未配置时不启动授权", async () => {
  assert.equal(
    (await seller.call("patch", "/api/auth/profile", { nickname: "新昵称" }))
      .status,
    200,
  );
  assert.equal(
    (
      await seller.call("post", "/api/auth/password", {
        oldPassword: "wrong",
        newPassword: "AnewPassword123!",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await seller.call("post", "/api/auth/password", {
        oldPassword: "TestCampus2026!",
        newPassword: "AnewPassword123!",
      })
    ).status,
    200,
  );
  const a = request.agent(app),
    token = (await a.get("/api/auth/csrf")).body.data.token;
  assert.equal(
    (
      await a
        .post("/api/auth/login")
        .set("X-CSRF-Token", token)
        .send({ login: "testseller", password: "AnewPassword123!" })
    ).status,
    200,
  );
  assert.equal((await a.get("/api/auth/wechat/start")).status, 503);
});
