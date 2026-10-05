import { createServer } from "node:http";
import { Server } from "socket.io";
import { app, sessionMiddleware, sweep } from "./app.js";
import { one, pool } from "./db.js";
const server = createServer(app),
  io = new Server(server, {
    allowRequest: (req, cb) =>
      cb(
        null,
        !req.headers.origin ||
          req.headers.origin ===
            (process.env.APP_ORIGIN || "http://127.0.0.1:3088") ||
          (process.env.NODE_ENV !== "production" &&
            req.headers.origin === "http://127.0.0.1:5173"),
      ),
  });
io.engine.use(sessionMiddleware);
io.use(async (socket, next) => {
  const uid = socket.request.session?.userId;
  const u = uid && (await one("SELECT * FROM users WHERE id=?", [uid]));
  if (
    !u ||
    u.status !== "ACTIVE" ||
    (u.verified_until && new Date(u.verified_until) < new Date())
  )
    return next(Error("UNAUTHORIZED"));
  socket.data.uid = String(uid);
  next();
});
io.on("connection", (socket) => socket.join("user:" + socket.data.uid));
app.set("io", io);
const timer = setInterval(() => sweep(io).catch(console.error), 60000);
timer.unref();
await sweep(io);
server.listen(
  Number(process.env.PORT || 3088),
  process.env.LISTEN_HOST || "127.0.0.1",
  () =>
    console.log(
      "西汽闲集已启动 http://127.0.0.1:" + (process.env.PORT || 3088),
    ),
);
async function close() {
  clearInterval(timer);
  io.close();
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
