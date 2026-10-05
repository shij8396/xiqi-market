# 西汽闲市

从西安同城起步的二手闲置交易系统。全 JavaScript：Vue 3 + Vite + Node.js + Express + MySQL + Socket.IO。访客可浏览，普通用户通过手机号注册、发布和交易；旧校园账号继续兼容，管理员负责审核。数据保存到 MySQL。

## 本机使用

已经完成依赖与本地 MySQL 安装的 Windows 电脑，可以双击根目录 **启动系统.cmd**。首次克隆请先按下面的“首次安装”准备数据库。或在 PowerShell 中运行：

```powershell
cd D:\codexproject\campus-market
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

打开 http://127.0.0.1:3088 。登录管理员账号后自动进入 `/admin`。

| 用途                   | 账号     | 演示密码    |
| ---------------------- | -------- | ----------- |
| 买家                   | 20260001 | Campus2026! |
| 卖家，拥有初始演示商品 | 20260002 | Campus2026! |
| 另一位学生             | 20260003 | Campus2026! |
| 管理员                 | admin    | Campus2026! |

演示账号仅在 `DEMO_MODE=true` 初始化时创建。登录页可点击角色填入演示凭据。学号、人物、商品和面交地点均为虚构演示内容，图片为本地示意插画；平台未接入学校统一身份认证。

首次注册演示：填写一个未注册的11位手机号，点击“获取验证码”。演示模式会在页面显示验证码并自动填入；设置至少10位密码即可注册。旧学号账号仍可使用原凭据登录。

## 已实现

- 普通用户使用手机号验证码注册、手机号密码登录与找回密码；旧校园账号继续兼容。可配置微信网页扫码登录，须先与账号绑定。Argon2id密码摘要、MySQL持久化会话及用户/管理员权限隔离。
- 商品图片上传、分类、成色、价格、描述、发布审核、编辑重审、主动下架。
- 访客浏览与搜索、分类/成色/价格/地点筛选、价格排序；登录后可收藏和交易。
- 按商品聊天，实时通知，重复消息去重，历史消息保存。
- 买家报价、卖家接受/拒绝/还价、撤回、24小时报价失效、接受后30分钟议定价下单。
- 原价/议定价下单、商品独占预留、幂等请求、卖家接单、面交交付、买家收货、取消、超时关闭、争议处理和订单时间线。
- 新订单按日期、时间和地点预约同城面交；双方可提出和回应改约，面交前2小时产生站内提醒；未能面交可发起争议。
- 完成订单的买家可给卖家打一次1至5星评价，商品详情展示卖家评分和评价笔数。
- 站内通知支持未读数量、逐条已读和跳转订单；找回密码可通过已绑定手机号验证码完成，重置后旧会话失效。
- 商品列表分页加载并显示真实总数。
- 管理后台概览、商品审核和违规下架、用户封禁/恢复、订单查询/争议处置、举报处理、操作日志。
- 手机/电脑响应式页面，普通用户端与独立管理入口。
- 个人设置：昵称、密码和微信绑定；商品分类包含“其他闲置”。

线下当面付款，平台不代收款。接受报价不会保留商品，成功下单后才锁定。已完成商品不能重复出售。

## 工程结构

```text
src/                    Vue页面、组件、路由、状态与样式
server/app.js           Express接口、身份校验与业务事务
server/db.js            MySQL连接池、UTC会话、事务封装
server/session.js       MySQL Session Store
server/schema.sql       可重复执行的初始化表结构
server/index.js         HTTP、Socket.IO、定时任务与退出处理
scripts/                数据库安装启动、初始化、管理员创建
tests/market.test.js    真实MySQL集成测试（独立测试库）
docs/                   实施技术方案、接口说明、验收记录
deploy/                 可选容器部署配置
uploads/                私有商品图片，不纳入版本控制
.runtime/               本机MySQL运行包/数据/日志，不纳入版本控制
output/playwright/      浏览器验收截图与临时执行脚本
```

## 开发与验证

要求 Node.js >=22.12；本次运行环境为 Node.js 24.15.0 和独立 MySQL 8.4.11，数据库端口3308，不占用本机已有3306服务。

```powershell
npm.cmd ci
npm.cmd run db:local
npm.cmd run db:init
npm.cmd run build
npm.cmd start
```

开发前端热更新：先启动后端，再在另一终端执行 `npm.cmd run dev`，访问 http://127.0.0.1:5173 。

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit --registry=https://registry.npmjs.org
```

测试固定使用 `xiqi_market_test`，会清空该**测试库**中的业务表；不操作 `xiqi_market` 演示库。测试库必须独立存在并授权。`db:local`已负责创建两套库。不要将测试库名改成正式库。

## 换一台机器

### 首次安装

安装 Node.js >=22.12、Git，并准备 MySQL 8.4。克隆后进入项目目录：

```powershell
git clone https://github.com/shij8396/xiqi-market.git
cd xiqi-market
npm.cmd ci
```

使用自己的 MySQL 时，按下方说明填写 `.env` 并初始化。Windows 用户也可使用独立实例：

```powershell
node scripts/download-mysql.js
Expand-Archive -LiteralPath .runtime/mysql-8.4.11.zip -DestinationPath .runtime
npm.cmd run db:local
npm.cmd run db:init
npm.cmd run build
npm.cmd start
```

打开 http://127.0.0.1:3088 。后续 Windows 启动可双击 `启动系统.cmd`。独立实例安装脚本仅支持 Windows；Linux/macOS 请自行安装 MySQL，使用下面的自有数据库方式。

可配置自己的MySQL：复制 `.env.example` 为 `.env`，填写新建专用数据库与账号，执行 `db:init`、`build`、`start`。此方式不用执行 `db:local`。

Windows独立实例方式：运行 `node scripts/download-mysql.js` 下载官方MySQL 8.4.11 ZIP并校验完整性，再执行：

```powershell
Expand-Archive -LiteralPath .runtime/mysql-8.4.11.zip -DestinationPath .runtime
npm.cmd run db:local
```

脚本也支持通过 `MYSQLD_PATH` 指定已有mysqld路径。`db:local`首次生成随机应用密码、Session密钥及本地root密码；不会输出密码。配置保存在 `.env`，root密码仅存 `.runtime/root-password`。这些目录不要公开分享。

本机排查发现默认临时目录下初始化会触发MySQL InnoDB断言；独立脚本固定使用项目内英文路径 `.runtime/mysql-tmp` 后成功。初始化与启动都使用相同临时目录。

## 正式使用边界

大众用户无需学号，通过手机号注册；旧校园账号及旧名册接口为兼容保留，不应将手机号或微信绑定误认为在校认证。演示模式会直接显示短信码，仅用于本机体验。正式模式必须配置 `SMS_GATEWAY_URL` 和 `SMS_GATEWAY_TOKEN`，由可信短信服务接收 `{phone,code,template}` JSON 并实际发送；未配置时短信验证接口拒绝请求。微信网页登录需在微信开放平台审核网站应用并配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`WECHAT_REDIRECT_URI`，用户先登录账号，在设置中绑定微信；未配置时页面明确显示不可用。当前不包含学校SSO、线上支付和快递交易。

正式环境需关闭 `DEMO_MODE`，新建干净数据库，使用 `scripts/create-admin.js`创建管理员，配置HTTPS与 `NODE_ENV=production`。Cookie在production开启Secure。反向代理需正确转发协议，数据库与Node端口不可直接暴露公网。面交提醒当前为用户在线时的站内提醒，不包含短信或小程序后台推送。

管理员创建示例（自行设置环境变量，不把真实密码写进命令历史或文档）：

```powershell
node scripts/create-admin.js
```

该脚本读取 `ADMIN_PASSWORD`（至少14位）及可选 `ADMIN_LOGIN`。上线前还需完成真实数据规模压测和备份恢复演练；本次本机交易验证不替代这些操作。

当前大众版技术边界见 `docs/大众平台技术方案.md`，实际接口见 `docs/API.md`，验证证据见 `docs/验收记录.md`。`docs/实施技术方案.md`保留为早期校园版本历史说明。

## 可选容器配置

`Dockerfile`和`deploy/compose.yml`提供仅绑定本机3088端口的开发演示部署模板。需配置`DB_PASSWORD`、`MYSQL_ROOT_PASSWORD`、`SESSION_SECRET`，并先停止占用3088端口的本机Node服务，再执行`docker compose --env-file .env -f deploy/compose.yml up --build`。

该Compose默认是本地HTTP演示模式，不是公网生产配置；生产需关闭演示数据并配置HTTPS、安全Cookie、受限数据库网络和备份。本次验证使用Windows原生Node/MySQL，未在Docker引擎中运行此模板。

面向境外服务器的HTTPS部署模板见[境外网页试运行说明](docs/境外网页试运行.md)。该模板尚需真实域名、短信服务、运营主体及测试环境验收，不能把本机测试等同于公网可上线。

优先使用免费资源试运行时，按[免费资源试运行方案](docs/免费资源试运行方案.md)核对当前额度、账号资料、区域选择与部署步骤。

## 开源与贡献

本项目采用 [MIT 许可证](LICENSE)，允许使用、修改和分发，请保留版权及许可证声明。欢迎通过 Issue 报告问题，通过 Pull Request 提交改进；提交前运行 `npm.cmd test` 与 `npm.cmd run build`。

仓库只包含源码、配置示例和文档，不包含真实账号数据、上传图片、数据库文件、私密配置或本机运行环境。演示账号密码是公开测试凭据，不可用于正式服务。发现涉及密钥或用户隐私的问题时，请勿在公开 Issue 中粘贴敏感数据。
