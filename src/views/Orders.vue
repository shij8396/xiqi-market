<script setup>
import { ref, onMounted, watch, computed } from "vue";
import { useStore } from "../store";
import { api, price, imageUrl, labels, date } from "../api";
import {
  PackageCheck,
  MapPin,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-vue-next";
import { showConfirmDialog, showToast } from "vant";
const store = useStore(),
  orders = ref([]),
  tab = ref("buy"),
  expanded = ref(null),
  busy = ref(false),
  actionOrder = ref(null),
  proposalOrder = ref(null),
  proposalDate = ref(""),
  proposalTime = ref(""),
  proposalLocationId = ref(""),
  ratingOrder = ref(null),
  ratingScore = ref(0),
  selectedAction = ref(""),
  reason = ref("");
const list = computed(() =>
  orders.value.filter(
    (o) =>
      String(o[tab.value === "buy" ? "buyer_id" : "seller_id"]) ===
      String(store.user.id),
  ),
);
async function load() {
  try {
    orders.value = await api("get", "/orders");
  } catch {}
}
onMounted(load);
watch(() => store.revision, load);
async function action(o, a) {
  if (["cancel", "reject", "dispute"].includes(a)) {
    actionOrder.value = o;
    selectedAction.value = a;
    reason.value = "";
    return;
  }
  try {
    await showConfirmDialog({
      title: {
        accept: "确认面交约定",
        deliver: "已当面交付商品？",
        receive: "确认已收到商品？",
      }[a],
      message:
        a === "receive"
          ? "请确认已经当面验货，收货确认后订单完成。"
          : a === "accept"
            ? o.meeting
            : "请在真实完成交付后再操作。",
    });
    await perform(o, a, "");
  } catch {}
}
async function perform(o, a, r) {
  busy.value = true;
  try {
    await api("post", "/orders/" + o.id + "/" + a, { reason: r });
    actionOrder.value = null;
    showToast("订单状态已更新");
    await load();
  } catch {
  } finally {
    busy.value = false;
  }
}
function openProposal(o) {
  proposalOrder.value = o;
  proposalDate.value = "";
  proposalTime.value = "";
  proposalLocationId.value = String(o.meetup_location_id || "");
}
async function sendProposal() {
  busy.value = true;
  try {
    await api("post", `/orders/${proposalOrder.value.id}/meetup-proposal`, {
      meetingAt: new Date(
        `${proposalDate.value}T${proposalTime.value}:00+08:00`,
      ).toISOString(),
      locationId: Number(proposalLocationId.value),
    });
    proposalOrder.value = null;
    showToast("已发送改约请求，等待对方确认");
    await load();
  } catch {
  } finally {
    busy.value = false;
  }
}
async function replyProposal(o, reply) {
  busy.value = true;
  try {
    await api("post", `/orders/${o.id}/meetup-proposal/${reply}`);
    showToast(reply === "accept" ? "已确认新的面交约定" : "已拒绝改约");
    await load();
  } catch {
  } finally {
    busy.value = false;
  }
}
function openRating(o) {
  ratingOrder.value = o;
  ratingScore.value = 0;
}
async function submitRating() {
  if (!ratingOrder.value || !ratingScore.value) return;
  busy.value = true;
  try {
    await api("post", `/orders/${ratingOrder.value.id}/review`, {
      score: ratingScore.value,
    });
    ratingOrder.value = null;
    showToast("评价已提交，感谢你分享交易体验");
    await load();
  } catch {
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="section-heading page-heading">
    <div>
      <span class="small-label">YOUR EXCHANGES</span>
      <h1>每一份好物，都有去向<span class="heading-dot">.</span></h1>
    </div>
    <span class="muted">线下面交 · 订单全程可追踪</span>
  </div>
  <div class="tabs">
    <button :class="{ active: tab === 'buy' }" @click="tab = 'buy'">
      我买到的</button
    ><button :class="{ active: tab === 'sell' }" @click="tab = 'sell'">
      我卖出的
    </button>
  </div>
  <div class="order-list">
    <article v-for="o in list" :key="o.id" class="order-card">
      <div class="order-header">
        <span
          >{{ date(o.created_at) }} <small>订单 {{ o.order_no }}</small></span
        ><span class="status-pill" :class="o.status">{{
          labels[o.status]
        }}</span>
      </div>
      <div class="order-product">
        <router-link :to="'/products/' + o.product_id"
          ><img :src="imageUrl(o.snapshot.images[0])" :alt="o.snapshot.title"
        /></router-link>
        <div>
          <h3>{{ o.snapshot.title }}</h3>
          <p>
            {{ tab === "buy" ? "卖家" : "买家" }}：{{
              tab === "buy" ? o.seller_name : o.buyer_name
            }}
          </p>
          <span class="pill">{{ o.snapshot.condition }}</span>
        </div>
        <div class="order-price">
          <span class="muted">成交价格</span
          ><strong>¥{{ price(o.amount_cents) }}</strong>
        </div>
      </div>
      <div class="order-meeting">
        <MapPin :size="16" /><span>{{
          o.meetup_at
            ? "约定面交：" + o.meeting
            : o.status === "COMPLETED"
              ? "交易已完成"
              : o.meeting
        }}</span
        ><small v-if="o.status === 'PENDING_ACCEPT'"
          >{{ date(o.accept_deadline) }} 前等待卖家确认</small
        >
      </div>
      <div
        v-if="o.status === 'AWAITING_MEETUP' && o.meetup_proposed_at"
        class="meeting-proposal"
      >
        <strong>改约请求：</strong>{{ date(o.meetup_proposed_at) }} ·
        {{ o.meetup_proposed_location_name }}
        <span v-if="String(o.meetup_proposed_by) === String(store.user.id)"
          >（等待对方确认）</span
        >
        <span v-else class="button-row">
          <button
            class="btn subtle compact"
            :disabled="busy"
            @click="replyProposal(o, 'reject')"
          >
            拒绝改约
          </button>
          <button
            class="btn primary compact"
            :disabled="busy"
            @click="replyProposal(o, 'accept')"
          >
            同意改约
          </button>
        </span>
      </div>
      <div class="order-footer">
        <button
          class="text-btn muted"
          @click="expanded = expanded === o.id ? null : o.id"
        >
          <Clock :size="15" />交易记录<ChevronDown :size="15" />
        </button>
        <div class="button-row">
          <template v-if="o.status === 'PENDING_ACCEPT' && tab === 'sell'"
            ><button
              class="btn subtle compact"
              :disabled="busy"
              @click="action(o, 'reject')"
            >
              拒绝</button
            ><button
              class="btn primary compact"
              :disabled="busy"
              @click="action(o, 'accept')"
            >
              确认接单
            </button></template
          ><button
            v-if="['PENDING_ACCEPT', 'AWAITING_MEETUP'].includes(o.status)"
            class="btn subtle compact"
            :disabled="busy"
            @click="action(o, 'cancel')"
          >
            取消订单</button
          ><button
            v-if="o.status === 'AWAITING_MEETUP' && tab === 'sell'"
            class="btn primary compact"
            :disabled="busy || Boolean(o.meetup_proposed_by)"
            @click="action(o, 'deliver')"
          >
            确认已交付</button
          ><button
            v-if="
              o.status === 'AWAITING_MEETUP' &&
              (!o.meetup_proposed_by ||
                String(o.meetup_proposed_by) === String(store.user.id))
            "
            class="btn subtle compact"
            :disabled="busy"
            @click="openProposal(o)"
          >
            协商改约</button
          ><button
            v-if="o.status === 'AWAITING_RECEIPT' && tab === 'buy'"
            class="btn primary compact"
            :disabled="busy"
            @click="action(o, 'receive')"
          >
            确认收货</button
          ><button
            v-if="['AWAITING_MEETUP', 'AWAITING_RECEIPT'].includes(o.status)"
            class="text-btn muted"
            :disabled="busy"
            @click="action(o, 'dispute')"
          >
            {{
              o.status === "AWAITING_MEETUP"
                ? "未能面交 / 申请处理"
                : "申请处理"
            }}
          </button>
          <button
            v-if="o.status === 'COMPLETED' && tab === 'buy' && !o.review_score"
            class="btn subtle compact"
            @click="openRating(o)"
          >
            评价卖家
          </button>
          <span v-if="o.review_score" class="order-rating">
            已评价 {{ o.review_score }} 星
          </span>
        </div>
      </div>
      <div v-if="expanded === o.id" class="timeline">
        <div v-for="e in o.events">
          <i /><span>{{ e.detail }}</span
          ><small>{{ date(e.created_at) }}</small>
        </div>
      </div>
    </article>
    <div v-if="!list.length" class="empty-state">
      <PackageCheck :size="48" />
      <h3>还没有{{ tab === "buy" ? "买到" : "卖出" }}的好物</h3>
      <p>你的闲置交易故事，从这里开始。</p>
      <router-link to="/" class="btn primary">去逛逛好物</router-link>
    </div>
  </div>
  <div
    v-if="actionOrder"
    class="modal-backdrop"
    @click.self="actionOrder = null"
  >
    <section class="modal">
      <h2>
        {{ selectedAction === "dispute" ? "说明你遇到的问题" : "填写操作原因" }}
      </h2>
      <form @submit.prevent="perform(actionOrder, selectedAction, reason)">
        <label
          >原因<textarea
            v-model="reason"
            required
            minlength="2"
            maxlength="500"
            placeholder="请如实描述，双方及管理员可查看"
          />
        </label>
        <div class="button-row">
          <button class="btn subtle" type="button" @click="actionOrder = null">
            返回</button
          ><button class="btn primary" :disabled="busy">确认提交</button>
        </div>
      </form>
    </section>
  </div>
  <div
    v-if="ratingOrder"
    class="modal-backdrop"
    @click.self="ratingOrder = null"
  >
    <section class="modal">
      <h2>评价这次交易</h2>
      <p class="muted">仅完成交易的买家可以评价，每笔订单只能评价一次。</p>
      <form @submit.prevent="submitRating">
        <fieldset class="rating-fieldset">
          <legend>给卖家的交易体验打分</legend>
          <label v-for="n in 5" :key="n" class="rating-choice">
            <input
              v-model.number="ratingScore"
              type="radio"
              name="score"
              :value="n"
              required
            />
            {{ n }} 星
          </label>
        </fieldset>
        <div class="button-row">
          <button type="button" class="btn subtle" @click="ratingOrder = null">
            返回
          </button>
          <button class="btn primary" :disabled="busy || !ratingScore">
            提交评价
          </button>
        </div>
      </form>
    </section>
  </div>
  <div
    v-if="proposalOrder"
    class="modal-backdrop"
    @click.self="proposalOrder = null"
  >
    <section class="modal">
      <h2>提出新的面交约定</h2>
      <p class="muted">对方同意后生效；原约定在此之前保持不变。</p>
      <form @submit.prevent="sendProposal">
        <label
          >面交日期<input
            v-model="proposalDate"
            type="date"
            :min="
              new Date().toLocaleDateString('sv-SE', {
                timeZone: 'Asia/Shanghai',
              })
            "
            required
        /></label>
        <label
          >面交时间<input v-model="proposalTime" type="time" required
        /></label>
        <label
          >面交地点<select v-model="proposalLocationId" required>
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
        <div class="button-row">
          <button
            type="button"
            class="btn subtle"
            @click="proposalOrder = null"
          >
            返回
          </button>
          <button class="btn primary" :disabled="busy">发送改约请求</button>
        </div>
      </form>
    </section>
  </div>
</template>
