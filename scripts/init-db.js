import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import sharp from "sharp";
import { pool, rows, one } from "../server/db.js";
const sql = await readFile(
  new URL("../server/schema.sql", import.meta.url),
  "utf8",
);
for (const statement of sql
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean))
  await pool.query(statement);
for (const [name, definition] of [
  ["phone", "VARCHAR(11) NULL UNIQUE"],
  ["wechat_openid", "VARCHAR(100) NULL UNIQUE"],
]) {
  const [columns] = await pool.query("SHOW COLUMNS FROM users LIKE ?", [name]);
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
for (const [i, name, icon] of [
  [1, "数码电子", "Laptop"],
  [2, "教材书籍", "BookOpen"],
  [3, "生活好物", "Coffee"],
  [4, "运动户外", "Bike"],
  [5, "汽车周边", "Car"],
  [6, "服饰配件", "Shirt"],
  [7, "其他闲置", "Shapes"],
])
  await rows("INSERT IGNORE INTO categories(id,name,icon) VALUES(?,?,?)", [
    i,
    name,
    icon,
  ]);
for (const [i, name] of [
  [101, "西安市·雁塔区公共场所"],
  [102, "西安市·长安区公共场所"],
  [103, "西安市·碑林区公共场所"],
  [104, "西安市·未央区公共场所"],
  [105, "西安市·莲湖区公共场所"],
])
  await rows("INSERT IGNORE INTO locations(id,name) VALUES(?,?)", [i, name]);
if (process.env.DEMO_MODE !== "true") {
  console.log(
    "数据库结构初始化完成；未创建演示账号。使用scripts/create-admin.js创建管理员。",
  );
  await pool.end();
  process.exit(0);
}
for (const [i, name] of [
  [1, "图书馆门口（演示地点）"],
  [2, "教学楼广场（演示地点）"],
  [3, "食堂门口（演示地点）"],
  [4, "体育场入口（演示地点）"],
])
  await rows("INSERT IGNORE INTO locations(id,name) VALUES(?,?)", [i, name]);
const ph = await argon2.hash("Campus2026!");
for (const [login, nickname, role] of [
  ["20260001", "小林同学", "STUDENT"],
  ["20260002", "阿北的闲置铺", "STUDENT"],
  ["20260003", "晴天同学", "STUDENT"],
  ["admin", "校园管理员", "ADMIN"],
])
  await rows(
    "INSERT IGNORE INTO users(login,password_hash,nickname,role,verified_until) VALUES(?,?,?,?,?)",
    [login, ph, nickname, role, "2027-09-01 00:00:00"],
  );
await rows(
  "INSERT IGNORE INTO roster(student_no,nickname,expires_at) VALUES(?,?,?)",
  ["20260009", "测试新同学", "2027-09-01 00:00:00"],
);
const seller = await one("SELECT id FROM users WHERE login='20260002'");
const objects = {
  camera:
    '<rect x="150" y="215" width="305" height="195" rx="24" fill="#282d2d"/><path d="M200 215l20-45h95l25 45" fill="#414849"/><circle cx="305" cy="311" r="86" fill="#15191c" stroke="#626d72" stroke-width="9"/><circle cx="305" cy="311" r="58" fill="#344856"/><circle cx="290" cy="298" r="29" fill="#789393" opacity=".6"/><rect x="389" y="235" width="45" height="22" rx="4" fill="#c9cac6"/>',
  books:
    '<g transform="rotate(-8 300 300)"><rect x="145" y="169" width="270" height="300" rx="8" fill="#243c46"/><rect x="158" y="160" width="275" height="290" rx="7" fill="#faf5dd"/><rect x="166" y="143" width="270" height="293" rx="8" fill="#427461"/><path d="M187 145v290" stroke="#a8c4b0" stroke-width="4"/><text x="221" y="230" font-size="35" fill="#faf5dd" font-family="sans-serif">DESIGN</text><text x="221" y="275" font-size="35" fill="#faf5dd" font-family="sans-serif">YOUR</text><text x="221" y="320" font-size="35" fill="#faf5dd" font-family="sans-serif">FUTURE.</text><rect x="223" y="352" width="141" height="6" fill="#b8ceab"/></g>',
  headphones:
    '<path d="M189 333v-75a112 112 0 0 1 224 0v75" fill="none" stroke="#343842" stroke-width="36"/><rect x="153" y="292" width="71" height="129" rx="33" fill="#242733" transform="rotate(-10 185 340)"/><rect x="376" y="292" width="71" height="129" rx="33" fill="#242733" transform="rotate(10 412 340)"/><path d="M197 226a109 109 0 0 1 204 0" fill="none" stroke="#747683" stroke-width="15"/>',
  bike: '<g fill="none" stroke="#343d3b" stroke-width="13"><circle cx="160" cy="370" r="85"/><circle cx="448" cy="370" r="85"/></g><g fill="none" stroke="#8aab66" stroke-width="14" stroke-linejoin="round"><path d="M160 370l83-133 66 133H160l83-133h153l52 133M309 370l87-133-16-63"/></g><path d="M210 230h62M361 174h63" stroke="#343d3b" stroke-width="15" stroke-linecap="round"/><circle cx="309" cy="370" r="21" fill="#3c4743"/>',
  lamp: '<path d="M299 419V291l90-110" fill="none" stroke="#b89962" stroke-width="15"/><path d="M237 282l88-113 105 87z" fill="#eee9d2"/><path d="M235 282l198-26" stroke="#cabc9d" stroke-width="8"/><ellipse cx="300" cy="432" rx="98" ry="22" fill="#ded2b2"/><circle cx="338" cy="270" r="16" fill="#fff9cd"/>',
  car: '<path d="M118 343l45-84 99-22h102l72 58 47 10 20 72H106z" fill="#ce593d"/><path d="M207 262l65-10h82l51 43H189z" fill="#37434e"/><path d="M306 255v38" stroke="#e8a078" stroke-width="8"/><circle cx="191" cy="369" r="43" fill="#303337"/><circle cx="423" cy="369" r="43" fill="#303337"/><circle cx="191" cy="369" r="23" fill="#b2b0a6"/><circle cx="423" cy="369" r="23" fill="#b2b0a6"/><path d="M119 323h51M455 325h30" stroke="#f8eac3" stroke-width="12"/>',
  bag: '<rect x="190" y="189" width="225" height="263" rx="43" fill="#9d8469"/><path d="M250 196v-27a54 54 0 0 1 108 0v27" fill="none" stroke="#6c5947" stroke-width="15"/><rect x="218" y="306" width="170" height="116" rx="17" fill="#bba084"/><path d="M233 333h142" stroke="#655c4c" stroke-width="5"/><rect x="274" y="237" width="60" height="27" rx="4" fill="#e6dfcf"/>',
  keyboard:
    '<g transform="rotate(-12 300 300)"><rect x="92" y="231" width="420" height="175" rx="18" fill="#d5ceb9"/><g fill="#fcfaf0">' +
    Array.from(
      { length: 36 },
      (_, i) =>
        `<rect x="${108 + (i % 12) * 32}" y="${248 + Math.floor(i / 12) * 36}" width="27" height="28" rx="4"/>`,
    ).join("") +
    '<rect x="220" y="357" width="163" height="27" rx="4"/></g><rect x="108" y="248" width="27" height="28" rx="4" fill="#b37152"/></g>',
};
const demos = [
  ["富士复古微单｜带着它记录校园", 1, 168000, "几乎全新", "camera", "#e2e8d9"],
  ["考研英语＋高数教材，一起上岸", 2, 3500, "轻微使用痕迹", "books", "#e4d9c6"],
  [
    "索尼无线耳机，通勤自习好搭子",
    1,
    26000,
    "几乎全新",
    "headphones",
    "#d9dce9",
  ],
  ["毕业出闲置｜城市通勤自行车", 4, 32000, "轻微使用痕迹", "bike", "#dde5d2"],
  ["暖光护眼台灯，把书桌点亮", 3, 4500, "几乎全新", "lamp", "#eee5d0"],
  ["1:24 合金汽车模型，收藏级质感", 5, 8800, "全新", "car", "#e3c9b7"],
  ["日系双肩包，装得下整个周末", 6, 6500, "几乎全新", "bag", "#ded7c9"],
  ["奶油色机械键盘｜安静又好敲", 1, 12900, "几乎全新", "keyboard", "#e5dfd2"],
  [
    "设计入门书籍，转给热爱设计的你",
    2,
    2800,
    "轻微使用痕迹",
    "books",
    "#d5e2dc",
  ],
  ["宿舍阅读灯，九成新无磕碰", 3, 3900, "几乎全新", "lamp", "#e6dcd6"],
  ["周末骑行好伙伴，校内自提", 4, 28000, "轻微使用痕迹", "bike", "#d3dee0"],
  ["经典红色跑车模型，附原盒", 5, 5900, "全新", "car", "#dedecb"],
];
await mkdir("uploads", { recursive: true });
for (let i = 0; i < demos.length; i++) {
  const [title, cat, price, condition, kind, bg] = demos[i];
  if (await one("SELECT id FROM products WHERE title=?", [title])) continue;
  const aid = randomUUID();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><radialGradient id="g"><stop stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="600" height="600" fill="${bg}"/><circle cx="175" cy="150" r="390" fill="url(#g)"/><ellipse cx="304" cy="468" rx="180" ry="22" fill="#263128" opacity=".09"/>${objects[kind]}<text x="38" y="553" font-size="13" fill="#536050" letter-spacing="4" font-family="sans-serif">CAMPUS FINDS · DEMO</text></svg>`;
  await sharp(Buffer.from(svg))
    .webp()
    .toFile("uploads/" + aid + ".webp");
  await rows("INSERT INTO assets(id,owner_id,filename) VALUES(?,?,?)", [
    aid,
    seller.id,
    aid + ".webp",
  ]);
  await rows(
    "INSERT INTO products(seller_id,category_id,location_id,title,description,condition_code,price_cents,negotiable,images,status) VALUES(?,?,?,?,?,?,?,?,?,?)",
    [
      seller.id,
      cat,
      (i % 4) + 1,
      title,
      "自用闲置，保养得很好，细节如图。支持校内当面查看，确认满意后再交易。欢迎同学来聊，诚心要可以商量价格。\n\n本条为虚构演示商品，图片为本地生成的示意插画，不代表实际在售商品。",
      condition,
      price,
      true,
      JSON.stringify([aid]),
      "ON_SALE",
    ],
  );
}
console.log(
  "结构与演示数据就绪。演示账号：20260001 / 20260002 / admin，密码见README。",
);
await pool.end();
