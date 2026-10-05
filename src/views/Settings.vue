<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "../store";
import { api } from "../api";
import {
  ArrowLeft,
  ShieldCheck,
  Smartphone,
  MessageCircle,
  LockKeyhole,
  UserRound,
  LogOut,
} from "lucide-vue-next";
import { showToast, showConfirmDialog } from "vant";
const store = useStore(),
  route = useRoute(),
  router = useRouter();
const nickname = ref(store.user.nickname),
  oldPassword = ref(""),
  newPassword = ref(""),
  busy = ref(false);
onMounted(async () => {
  if (route.query.wechat === "bound") {
    store.user = await api("get", "/auth/me");
    showToast("微信绑定成功");
  } else if (route.query.error) showToast("微信绑定失败，请重试");
});
async function saveName() {
  busy.value = true;
  try {
    store.user = await api("patch", "/auth/profile", {
      nickname: nickname.value,
    });
    showToast("昵称已保存");
  } catch {
  } finally {
    busy.value = false;
  }
}
async function savePassword() {
  busy.value = true;
  try {
    await api("post", "/auth/password", {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    });
    oldPassword.value = "";
    newPassword.value = "";
    showToast("密码已更新");
  } catch {
  } finally {
    busy.value = false;
  }
}
async function unbind() {
  try {
    await showConfirmDialog({
      title: "解除微信绑定？",
      message: "解除后仍可使用手机号登录。",
    });
    await api("delete", "/auth/wechat/binding");
    store.user.wechatBound = false;
    showToast("已解除绑定");
  } catch {}
}
async function logout() {
  await store.logout();
  router.push("/login");
}
</script>
<template>
  <div class="settings-page">
    <router-link to="/me" class="back-link"
      ><ArrowLeft :size="17" />返回个人中心</router-link
    >
    <div class="section-heading">
      <div>
        <span class="small-label">ACCOUNT SETTINGS</span>
        <h1>账号设置<span class="heading-dot">.</span></h1>
      </div>
    </div>
    <section class="settings-card">
      <h2><ShieldCheck :size="19" />身份信息</h2>
      <p>
        {{
          store.user.role === "STUDENT"
            ? "旧校园账号 " + store.user.login
            : "普通用户"
        }}
      </p>
      <p>
        <Smartphone :size="16" />手机号 {{ store.user.phone || "尚未绑定" }}
      </p>
      <small>手机号仅用于登录与账号安全验证，不对其他用户公开。</small>
    </section>
    <section class="settings-card">
      <h2><UserRound :size="19" />个人资料</h2>
      <form @submit.prevent="saveName">
        <label
          >昵称<input
            v-model="nickname"
            required
            minlength="2"
            maxlength="20" /></label
        ><button class="btn primary" :disabled="busy">保存昵称</button>
      </form>
    </section>
    <section class="settings-card">
      <h2><LockKeyhole :size="19" />修改密码</h2>
      <form @submit.prevent="savePassword">
        <label
          >原密码<input
            v-model="oldPassword"
            type="password"
            autocomplete="current-password"
            required /></label
        ><label
          >新密码<input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            required
            minlength="10" /></label
        ><button class="btn primary" :disabled="busy">更新密码</button>
      </form>
    </section>
    <section class="settings-card">
      <h2><MessageCircle :size="19" />微信账号</h2>
      <p>
        {{ store.user.wechatBound ? "已绑定，可使用微信登录" : "尚未绑定" }}
      </p>
      <button v-if="store.user.wechatBound" class="btn subtle" @click="unbind">
        解除绑定</button
      ><a
        v-else-if="store.wechat"
        class="btn subtle"
        href="/api/auth/wechat/start?action=bind"
        >绑定微信</a
      ><small v-else>微信开放平台尚未配置，配置后可在这里绑定。</small>
    </section>
    <button class="btn subtle settings-logout" @click="logout">
      <LogOut :size="17" />退出登录
    </button>
  </div>
</template>
