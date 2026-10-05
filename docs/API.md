# 实际接口说明

前缀`/api`，成功响应`{ "data": ... }`，错误`{ "error": { "message": "...", "code": "..." } }`。数据写入需Session Cookie及`X-CSRF-Token`。先GET `/auth/csrf`取得token；登录后Session与token更新，应重新获取。

| 方法              | 路径                                                          | 用途                                                              |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET               | /config、/auth/session、/auth/csrf                            | 演示配置、当前可用身份、CSRF令牌                                  |
| POST              | /auth/login                                                   | login、password                                                   |
| POST              | /auth/public/phone-code、/auth/public/register                | 大众手机号验证码注册；register需phone、code、nickname、password   |
| POST              | /auth/public/password-reset/code、/auth/public/password-reset | 大众用户通过手机号验证码重置密码；重置后已有会话失效              |
| POST              | /auth/phone-code                                              | studentNo、phone；演示模式返回demoCode                            |
| POST              | /auth/register                                                | studentNo、phone、code、nickname、password                        |
| POST              | /auth/password-reset/code、/auth/password-reset                | 已绑定学号和手机号获取验证码；用验证码及newPassword重置密码      |
| GET               | /auth/wechat/start、/auth/wechat/callback                     | 微信OAuth扫码登录或action=bind绑定；需配置开放平台                |
| PATCH/POST/DELETE | /auth/profile、/auth/password、/auth/wechat/binding           | 修改昵称、修改密码、解除微信绑定                                  |
| GET/POST          | /auth/me、/auth/logout                                        | 当前身份/退出                                                     |
| GET               | /meta                                                         | 分类与面交地点；访客可用                                          |
| POST              | /uploads                                                      | multipart字段file，返回图片UUID                                   |
| GET               | /assets/:id                                                   | 在售等可见商品图片访客可读，待审核等仍受访问控制                  |
| GET               | /products                                                     | 访客可浏览；q、category、condition、min、max、location、sort、mine、favorites；传page返回items、total、page、pageSize，可用offset续取 |
| GET               | /products/:id                                                 | 商品详情                                                          |
| GET               | /sellers/:id/reputation                                       | 卖家已完成订单的平均评分与评价笔数；访客可用                      |
| POST/PATCH        | /products、/products/:id                                      | 发布、编辑重审                                                    |
| POST              | /products/:id/off-shelf                                       | 卖家下架                                                          |
| PUT/DELETE        | /favorites/:id                                                | 收藏/取消收藏                                                     |
| POST/GET          | /conversations                                                | 建立会话/会话列表                                                 |
| GET               | /conversations/:id                                            | 商品、消息、报价；可附after序号                                   |
| POST              | /conversations/:id/messages                                   | text、clientMessageId(UUID)                                       |
| PUT               | /conversations/:id/read                                       | sequence，单调推进本人已读位置                                    |
| POST              | /conversations/:id/offers                                     | amountCents，买家报价                                             |
| POST              | /offers/:id/accept、reject、withdraw                          | 接受、拒绝、撤回                                                  |
| POST              | /offers/:id/counter                                           | amountCents，还价                                                 |
| POST/GET          | /orders                                                       | 下单/我的全部订单和事件                                           |
| POST              | /orders/:id/accept、reject、cancel、deliver、receive、dispute | 明确状态动作；拒绝/取消/争议需reason                              |
| POST              | /orders/:id/review                                            | 完成订单买家提交score（整数1至5）；每笔订单只允许一次             |
| POST              | /orders/:id/meetup-proposal、/orders/:id/meetup-proposal/:action | 提出改约（meetingAt、locationId）/对方接受或拒绝                 |
| POST/GET          | /reports                                                      | productId＋reason举报/本人举报列表                                |
| GET/POST          | /notifications、/notifications/unread-count、/notifications/read、/notifications/:id/read | 通知列表、未读数量、全部或逐条已读 |
| GET               | /admin/overview、products、users、orders、reports、audit      | 管理查询                                                          |
| POST              | /admin/products/:id/review                                    | action(approve/reject/remove)、version、reason                    |
| POST              | /admin/users/:id/status                                       | status(ACTIVE/BANNED)、reason                                     |
| POST              | /admin/roster                                                 | studentNo、nickname、validUntil(ISO日期)，录入可注册名册          |
| POST              | /admin/orders/:id/resolve                                     | action(close/complete)、reason，仅争议订单                        |
| POST              | /admin/reports/:id/resolve                                    | resolution                                                        |

商品写入字段：

```json
{
  "title": "自用机械键盘",
  "description": "保养良好，没有功能损坏，支持校内当面查看。",
  "categoryId": 1,
  "locationId": 1,
  "condition": "几乎全新",
  "priceCents": 12900,
  "negotiable": true,
  "images": ["上传接口返回的UUID"],
  "version": 1
}
```

新发布可省略version；编辑必须提交当前商品version。图片必须属于发布者；示例UUID仅为字段说明。

下单示例（头部`Idempotency-Key`使用唯一随机值；重试保持相同值）：

```json
{
  "productId": "12",
  "offerId": "2",
  "expectedProductVersion": 1,
  "meetingAt": "2026-10-01T09:00:00.000Z",
  "locationId": 1
}
```

原价下单省略offerId。meetingAt为ISO时间，服务端要求至少30分钟后、至多30天内；旧客户端仍可提交meeting文字字段。不允许提交amountCents、sellerId、status等额外字段；金额与卖家由服务端读取。

HTTP状态：401未登录；403无权限或CSRF失效；404资源不可见/不存在；409业务状态或幂等冲突；422字段校验；429频率限制；500服务错误（不返回堆栈）。

Socket.IO使用同一Session连接，只能加入服务端指定的本人房间。收到`sync`后重新读取相关接口；推送不替代数据库持久化。
