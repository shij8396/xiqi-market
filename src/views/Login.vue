<script setup>
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "../store";
import { api } from "../api";
import {
  ShoppingBag,
  ArrowRight,
  ShieldCheck,
  BookOpen,
  Headphones,
  Bike,
  ArrowUpRight,
} from "lucide-vue-next";
import { showToast } from "vant";
const store = useStore(),
  router = useRouter(),
  route = useRoute(),
  login = ref(""),
  password = ref(""),
  register = ref(false),
  resetMode = ref(false),
  resetPhone = ref(""),
  resetCode = ref(""),
  resetPassword = ref(""),
  phone = ref(""),
  nickname = ref(""),
  code = ref(""),
  sending = ref(false),
  busy = ref(false);
onMounted(() => {
  if (route.query.error === "wechat-unbound")
    showToast("请先用手机号登录并在设置中绑定微信");
  else if (route.query.error === "wechat") showToast("微信授权失败，请重试");
});
async function sendCode() {
  sending.value = true;
  try {
    const result = await api("post", "/auth/public/phone-code", {
      phone: phone.value,
    });
    if (result.demoCode) {
      code.value = result.demoCode;
      showToast(`演示验证码：${result.demoCode}`);
    } else showToast("验证码已发送");
  } catch {
  } finally {
    sending.value = false;
  }
}
async function submit() {
  busy.value = true;
  try {
    if (register.value) {
      await api("post", "/auth/public/register", {
        phone: phone.value,
        code: code.value,
        password: password.value,
        nickname: nickname.value,
      });
      showToast("注册成功，现在可以登录了");
      register.value = false;
      login.value = phone.value;
    } else {
      await store.login(login.value, password.value);
      router.push(store.user.role === "ADMIN" ? "/admin" : "/");
    }
  } catch {
  } finally {
    busy.value = false;
  }
}
function demo(account) {
  login.value = account;
  password.value = "Campus2026!";
  register.value = false;
}
async function sendResetCode() {
  sending.value = true;
  try {
    const result = await api("post", "/auth/public/password-reset/code", {
      phone: resetPhone.value,
    });
    if (result.demoCode) {
      resetCode.value = result.demoCode;
      showToast(`演示验证码：${result.demoCode}`);
    } else showToast(result.message);
  } catch {
  } finally {
    sending.value = false;
  }
}
async function resetPasswordNow() {
  busy.value = true;
  try {
    await api("post", "/auth/public/password-reset", {
      phone: resetPhone.value,
      code: resetCode.value,
      newPassword: resetPassword.value,
    });
    login.value = resetPhone.value;
    resetPassword.value = "";
    resetCode.value = "";
    resetMode.value = false;
    showToast("密码已重置，请重新登录");
  } catch {
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="login-page">
    <section class="login-story">
      <router-link to="/" class="brand"
        ><span class="brand-symbol"><ShoppingBag /></span
        ><span>西汽闲市<small>XI QI MARKET</small></span></router-link
      >
      <div class="story-content">
        <span class="eyebrow">好物有来处，新主人才刚好。</span>
        <h1>你的闲置，<br />是别人的<span>心头好。</span></h1>
        <p>
          让用不到的好物，遇见刚好需要的人。<br />从西安同城开始，开启一段新的故事。
        </p>
        <div class="story-art">
          <div class="art-card one">
            <Headphones :size="83" /><span>好物循环 ♡</span>
          </div>
          <div class="art-card two">
            <BookOpen :size="72" /><span>知识，也能接力</span>
          </div>
          <div class="art-seal">GOOD<br />FINDS<ArrowUpRight :size="25" /></div>
        </div>
        <div class="story-bottom">
          <ShieldCheck :size="18" /> 手机验证 <i /> 同城面交 <i /> 闲置不闲着
        </div>
      </div>
      <span class="story-copyright">西汽闲市 · 西安同城闲置交易</span>
    </section>
    <section class="login-panel">
      <div class="login-form">
        <span class="small-label">欢迎来到西汽闲市</span>
        <h2>
          {{ resetMode ? "找回密码" : register ? "注册新账号" : "好久不见"
          }}<span> : )</span>
        </h2>
        <p class="muted">
          {{
            resetMode
              ? "用已绑定的手机号验证身份"
              : register
                ? "使用手机号注册，验证码确认手机归属"
                : "使用手机号登录，发现身边值得带走的好物"
          }}
        </p>
        <form v-if="!resetMode" @submit.prevent="submit">
          <label v-if="!register"
            >{{ login === "admin" ? "管理员账号" : "手机号或旧校园账号"
            }}<input
              v-model="login"
              autocomplete="username"
              placeholder="请输入手机号"
              required
              maxlength="40" /></label
          ><label v-if="register"
            >昵称<input
              v-model="nickname"
              placeholder="大家怎么称呼你"
              required
              minlength="2" /></label
          ><label v-if="register"
            >手机号<input
              v-model="phone"
              type="tel"
              autocomplete="tel"
              placeholder="请输入11位手机号"
              required
              pattern="1[3-9][0-9]{9}"
          /></label>
          <div v-if="register" class="phone-code-row">
            <label
              >短信验证码<input
                v-model="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="6位验证码"
                required
                pattern="[0-9]{6}" /></label
            ><button
              class="btn subtle"
              type="button"
              :disabled="sending || !/^1[3-9]\d{9}$/.test(phone)"
              @click="sendCode"
            >
              {{ sending ? "发送中…" : "获取验证码" }}
            </button>
          </div>
          <label
            >密码<input
              v-model="password"
              type="password"
              :autocomplete="register ? 'new-password' : 'current-password'"
              placeholder="请输入密码"
              required
              :minlength="register ? 10 : 1" /></label
          ><button class="btn primary wide" :disabled="busy">
            {{ busy ? "请稍候…" : register ? "注册账号" : "登录，去逛逛"
            }}<ArrowRight :size="19" />
          </button>
        </form>
        <form v-else @submit.prevent="resetPasswordNow">
          <label
            >已绑定手机号<input
              v-model="resetPhone"
              type="tel"
              required
              pattern="1[3-9][0-9]{9}"
              autocomplete="tel"
          /></label>
          <div class="phone-code-row">
            <label
              >短信验证码<input
                v-model="resetCode"
                inputmode="numeric"
                required
                pattern="[0-9]{6}"
                autocomplete="one-time-code"
            /></label>
            <button
              class="btn subtle"
              type="button"
              :disabled="sending || !/^1[3-9]\d{9}$/.test(resetPhone)"
              @click="sendResetCode"
            >
              {{ sending ? "发送中…" : "获取验证码" }}
            </button>
          </div>
          <label
            >新密码<input
              v-model="resetPassword"
              type="password"
              required
              minlength="10"
              autocomplete="new-password"
          /></label>
          <button class="btn primary wide" :disabled="busy">
            {{ busy ? "请稍候…" : "重置密码" }}
          </button>
        </form>
        <button
          v-if="!resetMode"
          class="text-btn auth-switch"
          @click="register = !register"
        >
          {{ register ? "已有账号？返回登录" : "第一次来？手机号注册" }}
          <ArrowUpRight :size="15" />
        </button>
        <button
          v-if="!register"
          class="text-btn auth-switch"
          @click="resetMode = !resetMode"
        >
          {{ resetMode ? "返回登录" : "忘记密码？" }}
        </button>
        <a
          v-if="!register && !resetMode && store.wechat"
          class="wechat-login"
          href="/api/auth/wechat/start"
          >微信登录</a
        >
        <p v-else-if="!register && !resetMode" class="muted wechat-note">
          微信登录需先登录手机号账号，在设置中绑定微信；当前未配置微信开放平台。
        </p>
        <div v-if="store.demo" class="demo-box">
          <strong>演示体验</strong>
          <p>虚构账号与商品，不关联真实身份</p>
          <div>
            <button @click="demo('20260001')">买家账号</button
            ><button @click="demo('20260002')">卖家账号</button
            ><button @click="demo('admin')">管理员</button>
          </div>
        </div>
        <div class="login-note">
          <ShieldCheck :size="16" /> 手机验证 · 同城当面验货后付款
        </div>
      </div>
    </section>
  </div>
</template>
