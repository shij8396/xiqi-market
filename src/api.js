import axios from "axios";
import { showToast } from "vant";
export const http = axios.create({ baseURL: "/api", timeout: 15000 });
let csrf = "";
export async function refreshCsrf() {
  csrf = (await http.get("/auth/csrf")).data.token;
}
http.interceptors.request.use((c) => {
  if (!["get", "head"].includes(c.method)) c.headers["X-CSRF-Token"] = csrf;
  return c;
});
http.interceptors.response.use(
  (r) => r.data,
  (e) => {
    const message =
      e.response?.data?.error?.message || "网络连接失败，请稍后重试";
    if (!e.config?.silent) showToast({ message, duration: 2500 });
    if (e.response?.status === 401 && !location.pathname.includes("login"))
      location.assign("/login");
    throw e;
  },
);
export const api = async (method, url, data, config = {}) =>
  (await http.request({ method, url, data, ...config })).data;
export const price = (c) =>
  (Number(c) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
export const imageUrl = (id) => "/api/assets/" + id;
export const arr = (v) => (typeof v === "string" ? JSON.parse(v) : v || []);
export const date = (v) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export const labels = {
  PENDING_REVIEW: "待审核",
  ON_SALE: "在售",
  RESERVED: "交易中",
  SOLD: "已售出",
  REJECTED: "已退回",
  OFF_SHELF: "已下架",
  REMOVED: "违规下架",
  PENDING_ACCEPT: "待卖家确认",
  AWAITING_MEETUP: "待面交",
  AWAITING_RECEIPT: "待确认收货",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
  DISPUTED: "争议处理中",
  PENDING: "待回应",
  ACCEPTED: "已接受",
  WITHDRAWN: "已撤回",
  SUPERSEDED: "已还价",
  EXPIRED: "已过期",
  INVALIDATED: "已失效",
  USED: "已下单",
  RESOLVED: "已处理",
};
