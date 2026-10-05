import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import "vant/lib/index.css";
import "./style.css";
import App from "./App.vue";
import Login from "./views/Login.vue";
import Market from "./views/Market.vue";
import Detail from "./views/Detail.vue";
import Publish from "./views/Publish.vue";
import Messages from "./views/Messages.vue";
import Orders from "./views/Orders.vue";
import Profile from "./views/Profile.vue";
import Settings from "./views/Settings.vue";
import { useStore } from "./store";
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: Login },
    { path: "/", component: Market },
    { path: "/favorites", component: Market },
    { path: "/products/:id", component: Detail },
    { path: "/publish", component: Publish },
    { path: "/edit/:id", component: Publish },
    { path: "/messages/:id?", component: Messages },
    { path: "/orders", component: Orders },
    { path: "/me", component: Profile },
    { path: "/settings", component: Settings },
    { path: "/admin", component: () => import("./views/Admin.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior(to, from, saved) {
    return saved || { top: 0 };
  },
});
const app = createApp(App);
app.use(createPinia());
const store = useStore();
await store.init();
router.beforeEach((to) => {
  if (
    !store.user &&
    !["/login", "/"].includes(to.path) &&
    !to.path.startsWith("/products/")
  )
    return "/login";
  if (store.user && to.path === "/login")
    return store.user.role === "ADMIN" ? "/admin" : "/";
  if (to.path === "/admin" && store.user?.role !== "ADMIN") return "/";
  if (store.user?.role === "ADMIN" && !["/admin", "/login"].includes(to.path))
    return "/admin";
});
app.use(router);
app.mount("#app");
