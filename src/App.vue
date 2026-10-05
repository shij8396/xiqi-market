<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "./store";
import {
  ShoppingBag,
  Search,
  Heart,
  MessageCircle,
  Plus,
  UserRound,
  ArrowUpRight,
  ShieldCheck,
  LogOut,
  Compass,
  PackageCheck,
} from "lucide-vue-next";
const route = useRoute(),
  router = useRouter(),
  store = useStore();
const shell = computed(
  () => route.path !== "/admin" && route.path !== "/login",
);
async function logout() {
  await store.logout();
  router.push("/login");
}
const links = [
  ["/", "逛好物", Compass],
  ["/favorites", "我的收藏", Heart],
  ["/messages", "消息", MessageCircle],
  ["/orders", "我的订单", PackageCheck],
];
</script>
<template>
  <div v-if="shell" class="campus-strip">
    <span>西汽闲市 · 西安同城闲置交易</span
    ><span
      ><ShieldCheck :size="13" /> 手机验证 · 当面验货
      <span v-if="store.demo" class="demo-chip">演示环境</span></span
    >
  </div>
  <header v-if="shell" class="site-header">
    <div class="header-inner">
      <router-link to="/" class="brand"
        ><span class="brand-symbol"
          ><ShoppingBag :size="25" stroke-width="2.4" /></span
        ><span>西汽闲市<small>XI QI MARKET</small></span></router-link
      >
      <nav class="desktop-nav">
        <router-link
          v-for="[url, label, icon] in links"
          :key="url"
          :to="url"
          :class="{
            active:
              route.path === url ||
              (url === '/messages' && route.path.startsWith(url)),
          }"
          >{{ label }}</router-link
        >
      </nav>
      <div class="header-actions">
        <router-link
          :to="store.user ? '/publish' : '/login'"
          class="btn primary compact"
          ><Plus :size="17" /> 发布闲置</router-link
        ><router-link class="user-link" :to="store.user ? '/me' : '/login'"
          ><span class="avatar">{{
            store.user?.nickname?.slice(0, 1) || "访"
          }}</span
          ><span
            >{{ store.user?.nickname || "登录 / 注册"
            }}<small v-if="store.unreadCount" class="nav-count">{{
              store.unreadCount
            }}</small></span
          ></router-link
        ><button
          v-if="store.user"
          class="icon-btn logout"
          aria-label="退出登录"
          @click="logout"
        >
          <LogOut :size="17" />
        </button>
      </div>
    </div>
  </header>
  <main :class="{ 'page-shell': shell }"><router-view /></main>
  <footer v-if="shell" class="site-footer">
    <span class="footer-brand">西汽闲市</span
    ><span>让闲置遇见需要，让好物继续发光。</span
    ><span>同城面交 · 当面验货后付款</span>
  </footer>
  <nav v-if="shell" class="bottom-nav">
    <router-link to="/"><Compass /><span>首页</span></router-link
    ><router-link to="/favorites"><Heart /><span>收藏</span></router-link
    ><router-link to="/publish" class="publish-nav"
      ><span><Plus /></span><small>发布</small></router-link
    ><router-link to="/messages"><MessageCircle /><span>消息</span></router-link
    ><router-link to="/me"
      ><UserRound /><span
        >我的<small v-if="store.unreadCount" class="nav-count">{{
          store.unreadCount
        }}</small></span
      ></router-link
    >
  </nav>
</template>
