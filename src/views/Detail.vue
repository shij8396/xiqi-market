<script setup>
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "../store";
import { api, price, imageUrl, labels, date } from "../api";
import {
  ArrowLeft,
  Heart,
  MessageCircle,
  ShieldCheck,
  MapPin,
  Flag,
  ArrowUpRight,
  ShoppingBag,
  X,
  Check,
  Star,
} from "lucide-vue-next";
import { showToast, showConfirmDialog } from "vant";
const store = useStore(),
  route = useRoute(),
  router = useRouter(),
  p = ref(null),
  reputation = ref(null),
  selected = ref(0),
  checkout = ref(false),
  meetingDate = ref(""),
  meetingTime = ref(""),
  meetingLocationId = ref(""),
  busy = ref(false),
  report = ref(false),
  reason = ref(""),
  key = ref(crypto.randomUUID());
const mine = computed(
  () => !!store.user && String(p.value?.seller_id) === String(store.user.id),
);
async function load() {
  try {
    p.value = await api("get", "/products/" + route.params.id);
    if (!meetingLocationId.value)
      meetingLocationId.value = String(p.value.location_id);
    reputation.value = await api(
      "get",
      `/sellers/${p.value.seller_id}/reputation`,
      null,
      {
        silent: true,
      },
    ).catch(() => null);
  } catch {
    router.push("/");
  }
}
onMounted(load);
async function favorite() {
  if (!store.user) return router.push("/login");
  try {
    const next = !p.value.favorite;
    await api(next ? "put" : "delete", "/favorites/" + p.value.id);
    p.value.favorite = next;
    showToast(next ? "已加入收藏" : "已取消收藏");
  } catch {}
}
async function chat() {
  if (!store.user) return router.push("/login");
  try {
    const c = await api("post", "/conversations", { productId: p.value.id });
    router.push("/messages/" + c.id);
  } catch {}
}
async function purchase() {
  if (!store.user) return router.push("/login");
  busy.value = true;
  try {
    await api(
      "post",
      "/orders",
      {
        productId: p.value.id,
        expectedProductVersion: p.value.version,
        meetingAt: new Date(
          `${meetingDate.value}T${meetingTime.value}:00+08:00`,
        ).toISOString(),
        locationId: Number(meetingLocationId.value),
      },
      { headers: { "Idempotency-Key": key.value } },
    );
    showToast("下单成功，等待卖家确认");
    router.push("/orders");
  } catch {
  } finally {
    busy.value = false;
  }
}
async function off() {
  try {
    await showConfirmDialog({
      title: "下架这件商品？",
      message: "下架后其他用户将无法购买。",
    });
    await api("post", "/products/" + p.value.id + "/off-shelf");
    await load();
  } catch {}
}
async function submitReport() {
  if (!store.user) return router.push("/login");
  busy.value = true;
  try {
    await api("post", "/reports", {
      productId: p.value.id,
      reason: reason.value,
    });
    report.value = false;
    showToast("举报已提交，可在个人中心查看进度");
  } catch {
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div v-if="p" class="detail-page">
    <router-link to="/" class="back-link"
      ><ArrowLeft :size="17" /> 返回同城好物</router-link
    >
    <div class="detail-grid">
      <div class="detail-gallery">
        <img
          class="detail-main-image"
          :src="imageUrl(p.images[selected])"
          :alt="p.title"
        />
        <div v-if="p.images.length > 1" class="thumbnails">
          <button
            v-for="(im, i) in p.images"
            :class="{ selected: i === selected }"
            @click="selected = i"
          >
            <img :src="imageUrl(im)" alt="商品细节" />
          </button>
        </div>
      </div>
      <div class="detail-info">
        <div class="detail-topline">
          <span class="pill">{{ p.category_name }}</span
          ><span class="muted">{{ labels[p.status] }}</span>
        </div>
        <h1>{{ p.title }}</h1>
        <div class="detail-price">
          <span class="price"><small>¥</small>{{ price(p.price_cents) }}</span
          ><span v-if="p.negotiable" class="negotiable">价格可商量</span>
        </div>
        <div class="detail-tags">
          <span>{{ p.condition_code }}</span
          ><span>同城面交</span><span>当面验货</span>
        </div>
        <div class="seller-card">
          <span class="avatar large">{{ p.seller_name.slice(0, 1) }}</span>
          <div>
            <strong>{{ p.seller_name }}</strong
            ><small
              ><ShieldCheck :size="13" />{{
                p.seller_role === "STUDENT" ? "旧校园账号" : "手机号已验证"
              }}</small
            >
          </div>
          <span class="seller-badge">
            <template v-if="reputation?.reviewCount">
              <Star :size="13" fill="currentColor" />
              {{ reputation.rating }} ·
              {{ reputation.reviewCount }} 笔已完成订单评价
            </template>
            <template v-else>暂无成交评价</template>
          </span>
        </div>
        <div class="detail-location">
          <MapPin :size="18" />
          <div>
            <strong>交易地点</strong>
            <p>{{ p.location_name }}</p>
          </div>
        </div>
        <div class="safety-note">
          <ShieldCheck :size="19" /><span
            >请约在公共场所，当面确认成色后付款。<br />平台不代收款，请勿提前转账。</span
          >
        </div>
        <div v-if="mine" class="detail-actions">
          <router-link
            v-if="!['RESERVED', 'SOLD'].includes(p.status)"
            :to="'/edit/' + p.id"
            class="btn primary"
            >编辑商品</router-link
          ><button
            v-if="['ON_SALE', 'PENDING_REVIEW'].includes(p.status)"
            class="btn subtle"
            @click="off"
          >
            下架商品
          </button>
        </div>
        <div v-else class="detail-actions">
          <button
            class="btn subtle square"
            :class="{ 'detail-favorited': p.favorite }"
            aria-label="收藏商品"
            :aria-pressed="p.favorite"
            @click="favorite"
          >
            <Heart
              :fill="p.favorite ? 'currentColor' : 'none'"
              :size="21"
            /></button
          ><button
            class="btn subtle"
            :disabled="p.status !== 'ON_SALE'"
            @click="chat"
          >
            <MessageCircle :size="18" />聊一聊 / 砍价</button
          ><button
            class="btn primary"
            :disabled="p.status !== 'ON_SALE'"
            @click="store.user ? (checkout = true) : router.push('/login')"
          >
            {{ p.status === "ON_SALE" ? "我想要" : labels[p.status]
            }}<ArrowUpRight :size="18" />
          </button>
        </div>
        <p v-if="p.review_reason" class="review-note">
          审核说明：{{ p.review_reason }}
        </p>
      </div>
    </div>
    <section class="description-block">
      <div class="section-heading">
        <h2>好物介绍</h2>
        <button v-if="!mine" class="text-btn muted" @click="report = true">
          <Flag :size="14" />举报商品
        </button>
      </div>
      <p>{{ p.description }}</p>
      <small class="muted"
        >发布于 {{ date(p.created_at) }} · 商品编号 {{ p.id }}</small
      >
    </section>
  </div>
  <div v-if="checkout" class="modal-backdrop" @click.self="checkout = false">
    <section class="modal">
      <button
        class="modal-close icon-btn"
        aria-label="关闭"
        @click="checkout = false"
      >
        <X /></button
      ><span class="small-label">ONE MORE STEP</span>
      <h2>把心动带回去</h2>
      <p>{{ p.title }}</p>
      <p class="price"><small>¥</small>{{ price(p.price_cents) }}</p>
      <form @submit.prevent="purchase">
        <label
          >面交日期<input
            v-model="meetingDate"
            type="date"
            :min="
              new Date().toLocaleDateString('sv-SE', {
                timeZone: 'Asia/Shanghai',
              })
            "
            required
        /></label>
        <label
          >面交时间<input v-model="meetingTime" type="time" required
        /></label>
        <label
          >面交地点<select v-model="meetingLocationId" required>
            <option
              v-for="location in store.meta.locations"
              :key="location.id"
              :value="String(location.id)"
            >
              {{ location.name }}
            </option>
          </select></label
        >
        <p class="form-tip">
          下单后保留商品，卖家将在24小时内确认。线下当面付款。
        </p>
        <button class="btn primary wide" :disabled="busy">
          {{ busy ? "正在提交…" : "确认下单" }}
        </button>
      </form>
    </section>
  </div>
  <div v-if="report" class="modal-backdrop" @click.self="report = false">
    <section class="modal">
      <button
        class="modal-close icon-btn"
        @click="report = false"
        aria-label="关闭"
      >
        <X />
      </button>
      <h2>举报商品</h2>
      <form @submit.prevent="submitReport">
        <label
          >说明具体问题<textarea
            v-model="reason"
            minlength="5"
            maxlength="1000"
            required
            placeholder="请描述违规内容或遇到的问题，至少5个字"
          /></label
        ><button class="btn primary wide" :disabled="busy">提交举报</button>
      </form>
    </section>
  </div>
</template>
