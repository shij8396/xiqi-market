import session from "express-session";
import { rows, one, json } from "./db.js";
export class MysqlSessionStore extends session.Store {
  get(sid, cb) {
    one(
      "SELECT data FROM sessions WHERE sid=? AND expires_at>UTC_TIMESTAMP()",
      [sid],
    )
      .then((r) => cb(null, r ? json(r.data) : null))
      .catch(cb);
  }
  set(sid, data, cb) {
    rows(
      "INSERT INTO sessions(sid,user_id,data,expires_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),data=VALUES(data),expires_at=VALUES(expires_at)",
      [
        sid,
        data.userId || null,
        JSON.stringify(data),
        new Date(data.cookie.expires || Date.now() + 86400000),
      ],
    )
      .then(() => cb?.())
      .catch(cb);
  }
  destroy(sid, cb) {
    rows("DELETE FROM sessions WHERE sid=?", [sid])
      .then(() => cb?.())
      .catch(cb);
  }
  touch(sid, data, cb) {
    this.set(sid, data, cb);
  }
}
