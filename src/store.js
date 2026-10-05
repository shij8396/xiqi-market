import { defineStore } from "pinia";
import { ref } from "vue";
import { api, refreshCsrf, http } from "./api";
import { io } from "socket.io-client";
export const useStore = defineStore("app", () => {
  const user = ref(null),
    meta = ref({ categories: [], locations: [] }),
    revision = ref(0),
    unreadCount = ref(0),
    demo = ref(false),
    wechat = ref(false);
  let socket;
  async function refreshUnread() {
    if (!user.value) return;
    try {
      unreadCount.value = Number(
        (
          await api("get", "/notifications/unread-count", null, {
            silent: true,
          })
        ).count,
      );
    } catch {}
  }
  async function init() {
    await refreshCsrf();
    const config = await api("get", "/config");
    demo.value = config.demo;
    wechat.value = config.wechat;
    meta.value = await api("get", "/meta");
    try {
      user.value = await api("get", "/auth/session", null, { silent: true });
      if (user.value) {
        connect();
        refreshUnread();
      }
    } catch {
      user.value = null;
    }
  }
  function connect() {
    socket?.disconnect();
    socket = io();
    socket.on("sync", () => {
      revision.value++;
      refreshUnread();
    });
    socket.on("connect", () => {
      revision.value++;
      refreshUnread();
    });
  }
  async function login(login, password) {
    const d = await api("post", "/auth/login", { login, password });
    user.value = d.user;
    await refreshCsrf();
    meta.value = await api("get", "/meta");
    connect();
    refreshUnread();
  }
  async function logout() {
    await api("post", "/auth/logout");
    user.value = null;
    unreadCount.value = 0;
    socket?.disconnect();
    await refreshCsrf();
  }
  return {
    user,
    meta,
    demo,
    wechat,
    revision,
    unreadCount,
    refreshUnread,
    init,
    login,
    logout,
  };
});
