<script setup>
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "../store";
import { api, price, imageUrl, arr, labels, date } from "../api";
import {
  Send,
  MessageCircle,
  ArrowLeft,
  ArrowUpRight,
  ShieldCheck,
  X,
  HandCoins,
} from "lucide-vue-next";
import { showToast } from "vant";
const route = useRoute(),
  router = useRouter(),
  store = useStore(),
  list = ref([]),
  data = ref(null),
  text = ref(""),
  busy = ref(false),
  bargain = ref(false),
  amount = ref(""),
  counterId = ref(null),
  checkout = ref(false),
  chosen = ref(null),
  meetingDate = ref(""),
  meetingTime = ref(""),
  meetingLocationId = ref(""),
  scroll = ref(null),
  key = ref(crypto.randomUUID());
let timer;
const mine = computed(
  () => String(data.value?.conversation.buyer_id) === String(store.user.id),
);
async function load() {
  try {
    list.value = await api("get", "/conversations");
    if (route.params.id) {
      const d = await api("get", "/conversations/" + route.params.id);
      const changed = d.messages.length !== data.value?.messages.length;
      data.value = d;
      await api("put", "/conversations/" + route.params.id + "/read", {
        sequence: d.conversation.sequence,
      });
      if (changed) {
        await nextTick();
        scroll.value?.scrollTo({
          top: scroll.value.scrollHeight,
          behavior: "smooth",
        });
      }
    } else data.value = null;
  } catch {}
}
watch(
  () => route.params.id,
  () => {
    data.value = null;
    load();
  },
);
watch(() => store.revision, load);
onMounted(() => {
  load();
  timer = setInterval(load, 15000);
});
onUnmounted(() => clearInterval(timer));
const offer = (id) =>
  data.value?.offers.find((o) => String(o.id) === String(id));
const valid = (o) =>
  o &&
  o.status === "PENDING" &&
  new Date(o.expires_at) > new Date() &&
  data.value.product.status === "ON_SALE";
const canBuy = (o) =>
  o &&
  o.status === "ACCEPTED" &&
  new Date(o.purchase_deadline) > new Date() &&
  mine.value &&
  data.value.product.status === "ON_SALE";
async function send() {
  if (!text.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await api("post", "/conversations/" + route.params.id + "/messages", {
      text: text.value,
      clientMessageId: crypto.randomUUID(),
    });
    text.value = "";
    await load();
  } catch {
  } finally {
    busy.value = false;
  }
}
async function action(o, a) {
  busy.value = true;
  try {
    await api("post", "/offers/" + o.id + "/" + a);
    await load();
  } catch {
  } finally {
    busy.value = false;
  }
}
function openOffer(o = null) {
  counterId.value = o?.id || null;
  amount.value = "";
  bargain.value = true;
}
async function submitOffer() {
  busy.value = true;
  try {
    await api(
      "post",
      counterId.value
        ? "/offers/" + counterId.value + "/counter"
        : "/conversations/" + route.params.id + "/offers",
      { amountCents: Math.round(Number(amount.value) * 100) },
    );
    bargain.value = false;
    await load();
  } catch {
  } finally {
    busy.value = false;
  }
}
async function purchase() {
  busy.value = true;
  try {
    await api(
      "post",
      "/orders",
      {
        productId: data.value.product.id,
        offerId: String(chosen.value.id),
        expectedProductVersion: data.value.product.version,
        meetingAt: new Date(
          `${meetingDate.value}T${meetingTime.value}:00+08:00`,
        ).toISOString(),
        locationId: Number(meetingLocationId.value),
      },
      { headers: { "Idempotency-Key": key.value } },
    );
    router.push("/orders");
    showToast("已按议定价下单");
  } catch {
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="section-heading page-heading">
    <div>
      <span class="small-label">LET'S TALK</span>
      <h1>聊聊心动好物<span class="heading-dot">.</span></h1>
    </div>
    <span class="muted">好价格，从聊一聊开始</span>
  </div>
  <div class="messages-layout" :class="{ 'has-chat': data }">
    <aside class="conversation-list">
      <h3>
        我的消息 <span>{{ list.length }}</span>
      </h3>
      <button
        v-for="c in list"
        :key="c.id"
        class="conversation-item"
        :class="{ active: String(c.id) === route.params.id }"
        @click="router.push('/messages/' + c.id)"
      >
        <img :src="imageUrl(arr(c.images)[0])" alt="关联商品" />
        <div>
          <strong>{{
            String(c.buyer_id) === String(store.user.id)
              ? c.seller_name
              : c.buyer_name
          }}</strong
          ><span>{{ c.last_message || "打个招呼，聊聊这件好物" }}</span
          ><small>{{ c.title }}</small>
        </div>
        <i
          v-if="
            c.sequence >
            (String(c.buyer_id) === String(store.user.id)
              ? c.buyer_read
              : c.seller_read)
          "
        />
      </button>
      <p v-if="!list.length" class="empty-small">
        还没有会话<br />去商品详情点「聊一聊」吧
      </p>
    </aside>
    <section v-if="data" class="chat-panel">
      <div class="chat-header">
        <button
          class="icon-btn mobile-only"
          aria-label="返回消息列表"
          @click="router.push('/messages')"
        >
          <ArrowLeft /></button
        ><strong>{{
          list.find((c) => String(c.id) === route.params.id)?.[
            mine ? "seller_name" : "buyer_name"
          ] || "用户"
        }}</strong
        ><span><ShieldCheck :size="14" />交易沟通</span>
      </div>
      <router-link :to="'/products/' + data.product.id" class="chat-product"
        ><img :src="imageUrl(data.product.images[0])" alt="商品" />
        <div>
          <strong>{{ data.product.title }}</strong
          ><span class="price"
            ><small>¥</small>{{ price(data.product.price_cents) }}</span
          >
        </div>
        <ArrowUpRight :size="20"
      /></router-link>
      <div class="chat-safety">
        同城面交，请在公共场所验货后付款。接受报价不会锁定商品。
      </div>
      <div ref="scroll" class="message-stream">
        <div
          v-for="m in data.messages"
          :key="m.id"
          class="message-row"
          :class="{ mine: String(m.sender_id) === String(store.user.id) }"
        >
          <span class="message-time">{{ date(m.created_at) }}</span>
          <div v-if="m.offer_id && offer(m.offer_id)" class="offer-card">
            <div class="offer-title">
              <HandCoins :size="18" />{{ m.text
              }}<span>{{ labels[offer(m.offer_id).status] }}</span>
            </div>
            <div class="price">
              <small>¥</small>{{ price(offer(m.offer_id).amount_cents) }}
            </div>
            <p>报价有效至 {{ date(offer(m.offer_id).expires_at) }}</p>
            <div v-if="valid(offer(m.offer_id))" class="offer-actions">
              <template
                v-if="
                  String(offer(m.offer_id).recipient_id) ===
                  String(store.user.id)
                "
                ><button
                  class="btn primary compact"
                  :disabled="busy"
                  @click="action(offer(m.offer_id), 'accept')"
                >
                  接受</button
                ><button
                  class="btn subtle compact"
                  :disabled="busy"
                  @click="openOffer(offer(m.offer_id))"
                >
                  还价</button
                ><button
                  class="text-btn"
                  :disabled="busy"
                  @click="action(offer(m.offer_id), 'reject')"
                >
                  拒绝
                </button></template
              ><button
                v-else
                class="text-btn"
                :disabled="busy"
                @click="action(offer(m.offer_id), 'withdraw')"
              >
                撤回报价
              </button>
            </div>
            <button
              v-if="canBuy(offer(m.offer_id))"
              class="btn primary wide compact"
              @click="
                chosen = offer(m.offer_id);
                checkout = true;
              "
            >
              按议定价下单 <ArrowUpRight :size="16" />
            </button>
          </div>
          <div v-else class="message-bubble">{{ m.text }}</div>
        </div>
        <div v-if="!data.messages.length" class="empty-small">
          这是你们的第一次对话<br />打个招呼，让好物开启新故事
        </div>
      </div>
      <form class="chat-composer" @submit.prevent="send">
        <div class="chat-tools">
          <button
            v-if="
              mine &&
              data.product.negotiable &&
              data.product.status === 'ON_SALE'
            "
            type="button"
            class="bargain-btn"
            @click="openOffer()"
          >
            <HandCoins :size="16" />砍一刀</button
          ><span class="muted">友善沟通，诚信交易</span>
        </div>
        <div class="composer-input">
          <input
            v-model="text"
            aria-label="聊天消息"
            placeholder="问问成色，聊聊价格…"
            maxlength="2000"
          /><button
            class="btn primary compact"
            :disabled="busy || !text.trim()"
          >
            <Send :size="17" /><span>发送</span>
          </button>
        </div>
      </form>
    </section>
    <div v-else class="chat-placeholder">
      <MessageCircle :size="60" stroke-width="1" />
      <h3>每一次对话，都是好物的新开始</h3>
      <p>选择一个会话，和对方聊一聊</p>
    </div>
  </div>
  <div v-if="bargain" class="modal-backdrop" @click.self="bargain = false">
    <section class="modal">
      <button
        class="modal-close icon-btn"
        @click="bargain = false"
        aria-label="关闭"
      >
        <X />
      </button>
      <h2>{{ counterId ? "给一个新价格" : "心动好物，商量着来" }}</h2>
      <p class="muted">
        标价 ¥{{ price(data.product.price_cents) }} · 合理出价更容易成交
      </p>
      <form @submit.prevent="submitOffer">
        <label
          >你的报价（元）<input
            v-model="amount"
            type="number"
            step="0.01"
            min="0.01"
            :max="data.product.price_cents / 100"
            required
            placeholder="输入期望价格" /></label
        ><button class="btn primary wide" :disabled="busy">发送报价</button>
      </form>
    </section>
  </div>
  <div v-if="checkout" class="modal-backdrop" @click.self="checkout = false">
    <section class="modal">
      <button
        class="modal-close icon-btn"
        @click="checkout = false"
        aria-label="关闭"
      >
        <X />
      </button>
      <h2>按议定价下单</h2>
      <p class="price"><small>¥</small>{{ price(chosen.amount_cents) }}</p>
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
            <option value="" disabled>请选择公共面交地点</option>
            <option
              v-for="location in store.meta.locations"
              :key="location.id"
              :value="String(location.id)"
            >
              {{ location.name }}
            </option>
          </select></label
        >
        <p class="form-tip">下单成功后保留商品，线下当面付款。</p>
        <button class="btn primary wide" :disabled="busy">确认下单</button>
      </form>
    </section>
  </div>
</template>
