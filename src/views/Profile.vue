<script setup>
import { ref, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "../store";
import { api, imageUrl, price, labels, date } from "../api";
import {
  ShieldCheck,
  Package,
  Heart,
  PackageCheck,
  Plus,
  ArrowUpRight,
  LogOut,
  Bell,
  Flag,
  Settings,
  Star,
} from "lucide-vue-next";
const store = useStore(),
  router = useRouter(),
  products = ref([]),
  notifications = ref([]),
  reports = ref([]),
  reputation = ref(null),
  tab = ref("products");
async function load() {
  try {
    [products.value, notifications.value, reports.value, reputation.value] =
      await Promise.all([
        api("get", "/products?mine=true"),
        api("get", "/notifications"),
        api("get", "/reports"),
        api("get", `/sellers/${store.user.id}/reputation`),
      ]);
  } catch {}
}
onMounted(load);
watch(() => store.revision, load);
async function openNotification(notification) {
  if (!notification.read_at) {
    await api("post", "/notifications/" + notification.id + "/read");
    notification.read_at = new Date().toISOString();
    store.refreshUnread();
  }
  if (
    notification.target_path?.startsWith("/") &&
    !notification.target_path.startsWith("//")
  )
    router.push(notification.target_path);
}
async function readAll() {
  await api("post", "/notifications/read");
  notifications.value.forEach(
    (notification) => (notification.read_at ??= new Date().toISOString()),
  );
  store.refreshUnread();
}
async function logout() {
  await store.logout();
  router.push("/login");
}
</script>
<template>
  <section class="profile-banner">
    <span class="avatar profile-avatar">{{
      store.user.nickname.slice(0, 1)
    }}</span>
    <div>
      <span class="small-label">MY LITTLE SECONDHAND STORE</span>
      <h1>{{ store.user.nickname }}的闲置小站</h1>
      <span class="profile-verified"
        ><ShieldCheck :size="15" />
        {{
          store.user.role === "STUDENT" ? "旧校园账号" : "手机号已验证"
        }}</span
      >
      <span v-if="reputation?.reviewCount" class="profile-verified">
        <Star :size="15" fill="currentColor" />
        卖家评分 {{ reputation.rating }} · {{ reputation.reviewCount }} 笔评价
      </span>
    </div>
    <button class="btn subtle compact" @click="logout">
      <LogOut :size="16" />退出登录
    </button>
  </section>
  <div class="profile-shortcuts">
    <router-link to="/orders"
      ><PackageCheck /><strong>我的订单</strong
      ><ArrowUpRight :size="16" /></router-link
    ><router-link to="/favorites"
      ><Heart /><strong>心动收藏</strong
      ><ArrowUpRight :size="16" /></router-link
    ><router-link to="/publish"
      ><Plus /><strong>发布闲置</strong><ArrowUpRight :size="16" /></router-link
    ><router-link to="/settings"
      ><Settings /><strong>账号设置</strong><ArrowUpRight :size="16"
    /></router-link>
  </div>
  <div class="tabs">
    <button :class="{ active: tab === 'products' }" @click="tab = 'products'">
      我的发布 <span>{{ products.length }}</span></button
    ><button
      :class="{ active: tab === 'notifications' }"
      @click="tab = 'notifications'"
    >
      系统通知
      <span v-if="store.unreadCount">{{ store.unreadCount }}</span></button
    ><button :class="{ active: tab === 'reports' }" @click="tab = 'reports'">
      举报进度
    </button>
  </div>
  <section v-if="tab === 'products'" class="my-products">
    <article v-for="p in products" class="my-product">
      <img :src="imageUrl(p.images[0])" :alt="p.title" />
      <div>
        <span class="status-pill" :class="p.status">{{
          labels[p.status]
        }}</span>
        <h3>{{ p.title }}</h3>
        <strong class="price">¥{{ price(p.price_cents) }}</strong>
        <p v-if="p.review_reason" class="muted">
          审核说明：{{ p.review_reason }}
        </p>
      </div>
      <router-link :to="'/products/' + p.id" class="btn subtle compact"
        >查看商品 <ArrowUpRight :size="15"
      /></router-link>
    </article>
    <div v-if="!products.length" class="empty-state">
      <Package :size="48" />
      <h3>你的闲置小站，等一件好物开张</h3>
      <p>把用不到的物品分享给身边需要的人。</p>
      <router-link to="/publish" class="btn primary"
        >发布第一件闲置</router-link
      >
    </div>
  </section>
  <section v-else-if="tab === 'notifications'" class="panel">
    <button v-if="store.unreadCount" class="text-btn" @click="readAll">
      全部标为已读
    </button>
    <button
      v-for="n in notifications"
      :key="n.id"
      class="notification-row notification-button"
      :class="{ unread: !n.read_at }"
      @click="openNotification(n)"
    >
      <Bell :size="19" />
      <div>
        <p>{{ n.text }}</p>
        <small
          >{{ date(n.created_at)
          }}{{ n.target_path ? " · 点击查看" : "" }}</small
        >
      </div>
    </button>
    <div v-if="!notifications.length" class="empty-small">暂时没有新通知</div>
  </section>
  <section v-else class="panel">
    <div v-for="r in reports" class="report-row">
      <span class="status-pill">{{ labels[r.status] }}</span>
      <h3>{{ r.title }}</h3>
      <p>{{ r.reason }}</p>
      <p class="muted">
        {{ r.resolution || "管理员正在等待受理，请耐心等候。" }}
      </p>
    </div>
    <div v-if="!reports.length" class="empty-small">没有提交过举报</div>
  </section>
</template>
