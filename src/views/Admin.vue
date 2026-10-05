<script setup>
import { ref, onMounted, computed } from "vue";
import { useStore } from "../store";
import { useRouter } from "vue-router";
import { api, labels, price, imageUrl, date } from "../api";
import {
  ElTable,
  ElTableColumn,
  ElDialog,
  ElInput,
  ElButton,
  ElTag,
  ElSelect,
  ElOption,
} from "element-plus";
import "element-plus/dist/index.css";
import {
  ShoppingBag,
  LayoutDashboard,
  Package,
  Users,
  ClipboardList,
  Flag,
  ScrollText,
  LogOut,
  Search,
  ArrowUpRight,
  ShieldCheck,
  Plus,
  UserPlus,
} from "lucide-vue-next";
import { showToast } from "vant";
const store = useStore(),
  router = useRouter(),
  tab = ref("overview"),
  stats = ref({}),
  records = ref([]),
  q = ref(""),
  filter = ref(""),
  busy = ref(false),
  dialog = ref(false),
  detail = ref(null),
  operation = ref(null),
  reason = ref(""),
  generated = ref(""),
  studentNo = ref(""),
  nickname = ref(""),
  valid = ref("2027-09-01");
const menus = [
  ["overview", "工作台", LayoutDashboard],
  ["products", "商品管理", Package],
  ["users", "用户管理", Users],
  ["orders", "订单管理", ClipboardList],
  ["reports", "举报处理", Flag],
  ["audit", "操作日志", ScrollText],
];
const title = computed(() => menus.find((x) => x[0] === tab.value)?.[1] || "");
const filtered = computed(() =>
  records.value.filter(
    (r) =>
      (!filter.value || r.status === filter.value) &&
      JSON.stringify(r).toLowerCase().includes(q.value.toLowerCase()),
  ),
);
async function load() {
  busy.value = true;
  try {
    stats.value = await api("get", "/admin/overview");
    records.value =
      tab.value === "overview"
        ? await api("get", "/admin/products")
        : await api("get", "/admin/" + tab.value);
  } catch {
  } finally {
    busy.value = false;
  }
}
function change(t) {
  tab.value = t;
  q.value = "";
  filter.value = "";
  load();
}
onMounted(load);
function open(row, op) {
  detail.value = row;
  operation.value = op;
  reason.value = op === "approve" ? "信息完整，审核通过" : "";
  generated.value = "";
  dialog.value = true;
}
async function submit() {
  busy.value = true;
  try {
    if (operation.value === "roster") {
      const result = await api("post", "/admin/roster", {
        studentNo: studentNo.value,
        nickname: nickname.value,
        validUntil: new Date(valid.value).toISOString(),
      });
      generated.value = result.studentNo;
      return;
    }
    if (tab.value === "products" || tab.value === "overview")
      await api("post", "/admin/products/" + detail.value.id + "/review", {
        action: operation.value,
        version: detail.value.version,
        reason: reason.value,
      });
    if (tab.value === "users")
      await api("post", "/admin/users/" + detail.value.id + "/status", {
        status: operation.value,
        reason: reason.value,
      });
    if (tab.value === "reports")
      await api("post", "/admin/reports/" + detail.value.id + "/resolve", {
        resolution: reason.value,
      });
    if (tab.value === "orders")
      await api("post", "/admin/orders/" + detail.value.id + "/resolve", {
        action: operation.value,
        reason: reason.value,
      });
    dialog.value = false;
    showToast("操作已保存并记录审计日志");
    await load();
  } catch {
  } finally {
    busy.value = false;
  }
}
async function logout() {
  await store.logout();
  router.push("/login");
}
</script>
<template>
  <div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="brand">
        <span class="brand-symbol"><ShoppingBag /></span
        ><span>西汽闲市<small>平台管理中心</small></span>
      </div>
      <span class="sidebar-label">WORKSPACE</span>
      <nav>
        <button
          v-for="[key, label, icon] in menus"
          :class="{ active: tab === key }"
          @click="change(key)"
        >
          <component :is="icon" :size="19" />{{ label
          }}<span v-if="key === 'products' && Number(stats.pending) > 0">{{
            stats.pending
          }}</span>
        </button>
      </nav>
      <div class="admin-sidebar-bottom">
        <ShieldCheck :size="28" /><strong>守护同城交易</strong>
        <p>每一次审核，让好物交换<br />多一份安心。</p>
        <button @click="logout"><LogOut :size="16" />退出管理后台</button>
      </div>
    </aside>
    <section class="admin-main">
      <header class="admin-topbar">
        <span
          >西汽闲市 <span class="muted">/ 管理后台 / {{ title }}</span></span
        ><span
          ><span v-if="store.demo" class="demo-chip">演示环境</span
          ><span class="avatar">管</span>管理员</span
        >
      </header>
      <main class="admin-content">
        <div class="section-heading">
          <div>
            <span class="small-label">MARKET CONSOLE</span>
            <h1>
              {{ tab === "overview" ? "让闲置交易，有序而温暖。" : title }}
            </h1>
            <p class="muted">
              {{
                tab === "overview"
                  ? "欢迎回来，这里是今天的平台交易概况。"
                  : "审核每一份信息，留下每一次操作记录。"
              }}
            </p>
          </div>
        </div>
        <div v-if="tab === 'overview'" class="stats-grid">
          <div
            v-for="(s, i) in [
              ['注册用户', stats.users, '位用户'],
              ['商品总数', stats.products, '件闲置好物'],
              ['待审核商品', stats.pending, '件等待你处理'],
              ['交易订单', stats.orders, '笔交易'],
            ]"
            :class="{ highlight: i === 2 }"
          >
            <span
              >{{ s[0]
              }}<component
                :is="[Users, Package, ShieldCheck, ClipboardList][i]"
                :size="19" /></span
            ><strong>{{ s[1] || 0 }}</strong
            ><small>{{ s[2] }}</small>
          </div>
        </div>
        <div class="admin-table-panel">
          <div class="admin-table-heading">
            <h3>
              {{ tab === "overview" ? "等待审核的好物" : title + "列表" }}
            </h3>
            <div class="admin-table-tools">
              <ElInput
                v-model="q"
                placeholder="搜索关键词"
                clearable
              /><ElSelect
                v-if="['products', 'orders'].includes(tab)"
                v-model="filter"
                placeholder="全部状态"
                clearable
                ><ElOption
                  v-for="s in tab === 'products'
                    ? [
                        'PENDING_REVIEW',
                        'ON_SALE',
                        'RESERVED',
                        'SOLD',
                        'REJECTED',
                        'REMOVED',
                        'OFF_SHELF',
                      ]
                    : [
                        'PENDING_ACCEPT',
                        'AWAITING_MEETUP',
                        'AWAITING_RECEIPT',
                        'COMPLETED',
                        'CANCELLED',
                        'DISPUTED',
                        'CLOSED',
                      ]"
                  :key="s"
                  :label="labels[s]"
                  :value="s" /></ElSelect
              ><button class="btn subtle compact" @click="load">刷新</button>
            </div>
          </div>
          <ElTable
            v-if="['products', 'overview'].includes(tab)"
            :data="
              tab === 'overview'
                ? filtered.filter((p) => p.status === 'PENDING_REVIEW')
                : filtered
            "
            empty-text="暂无需要处理的商品"
            stripe
            ><ElTableColumn label="商品信息" min-width="270"
              ><template #default="{ row }"
                ><div class="admin-product-cell">
                  <img :src="imageUrl(row.images[0])" alt="商品" />
                  <div>
                    <strong>{{ row.title }}</strong
                    ><small
                      >{{ row.category_name }} · {{ row.condition_code }}</small
                    >
                  </div>
                </div></template
              ></ElTableColumn
            ><ElTableColumn
              prop="seller_name"
              label="发布者"
              width="140"
            /><ElTableColumn label="价格" width="95"
              ><template #default="{ row }"
                >¥{{ price(row.price_cents) }}</template
              ></ElTableColumn
            ><ElTableColumn label="状态" width="110"
              ><template #default="{ row }"
                ><span class="status-pill" :class="row.status">{{
                  labels[row.status]
                }}</span></template
              ></ElTableColumn
            ><ElTableColumn label="操作" min-width="180"
              ><template #default="{ row }"
                ><ElButton link @click="open(row, 'view')">详情</ElButton
                ><template v-if="row.status === 'PENDING_REVIEW'"
                  ><ElButton link type="success" @click="open(row, 'approve')"
                    >通过</ElButton
                  ><ElButton link type="danger" @click="open(row, 'reject')"
                    >退回</ElButton
                  ></template
                ><ElButton
                  v-if="['ON_SALE', 'RESERVED'].includes(row.status)"
                  link
                  type="danger"
                  @click="open(row, 'remove')"
                  >下架</ElButton
                ></template
              ></ElTableColumn
            ></ElTable
          >
          <ElTable v-else-if="tab === 'users'" :data="filtered" stripe
            ><ElTableColumn prop="login" label="登录账号" /><ElTableColumn
              prop="nickname"
              label="昵称"
            /><ElTableColumn label="账号类型 / 认证有效期"
              ><template #default="{ row }">{{
                row.verified_until ? date(row.verified_until) : "普通账号"
              }}</template></ElTableColumn
            ><ElTableColumn label="账号状态"
              ><template #default="{ row }"
                ><ElTag
                  :type="row.status === 'ACTIVE' ? 'success' : 'danger'"
                  >{{ row.status === "ACTIVE" ? "正常" : "已封禁" }}</ElTag
                ></template
              ></ElTableColumn
            ><ElTableColumn label="操作"
              ><template #default="{ row }"
                ><ElButton
                  link
                  :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
                  @click="
                    open(row, row.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE')
                  "
                  >{{
                    row.status === "ACTIVE" ? "限制账号" : "恢复账号"
                  }}</ElButton
                ></template
              ></ElTableColumn
            ></ElTable
          >
          <ElTable v-else-if="tab === 'orders'" :data="filtered" stripe
            ><ElTableColumn label="商品 / 订单号" min-width="250"
              ><template #default="{ row }"
                ><strong>{{ row.snapshot.title }}</strong
                ><small class="block muted">{{ row.order_no }}</small></template
              ></ElTableColumn
            ><ElTableColumn prop="buyer_name" label="买家" /><ElTableColumn
              prop="seller_name"
              label="卖家"
            /><ElTableColumn label="成交价"
              ><template #default="{ row }"
                >¥{{ price(row.amount_cents) }}</template
              ></ElTableColumn
            ><ElTableColumn label="状态" min-width="120"
              ><template #default="{ row }">{{
                labels[row.status]
              }}</template></ElTableColumn
            ><ElTableColumn label="操作" min-width="170"
              ><template #default="{ row }"
                ><ElButton link @click="open(row, 'view')">记录</ElButton
                ><template v-if="row.status === 'DISPUTED'"
                  ><ElButton link type="danger" @click="open(row, 'close')"
                    >关闭</ElButton
                  ><ElButton link type="success" @click="open(row, 'complete')"
                    >核实完成</ElButton
                  ></template
                ></template
              ></ElTableColumn
            ></ElTable
          >
          <ElTable v-else-if="tab === 'reports'" :data="filtered" stripe
            ><ElTableColumn
              prop="title"
              label="举报商品"
              min-width="200"
            /><ElTableColumn prop="nickname" label="举报人" /><ElTableColumn
              prop="reason"
              label="举报原因"
              min-width="230"
            /><ElTableColumn label="状态"
              ><template #default="{ row }">{{
                row.status === "PENDING" ? "待处理" : "已处理"
              }}</template></ElTableColumn
            ><ElTableColumn label="操作"
              ><template #default="{ row }"
                ><ElButton
                  link
                  @click="
                    open(row, row.status === 'PENDING' ? 'resolve' : 'view')
                  "
                  >{{ row.status === "PENDING" ? "处理" : "详情" }}</ElButton
                ></template
              ></ElTableColumn
            ></ElTable
          >
          <ElTable v-else :data="filtered" stripe
            ><ElTableColumn prop="nickname" label="操作人" /><ElTableColumn
              prop="action"
              label="操作"
              min-width="180"
            /><ElTableColumn prop="target_id" label="对象ID" /><ElTableColumn
              prop="reason"
              label="原因"
              min-width="240"
            /><ElTableColumn label="时间" min-width="150"
              ><template #default="{ row }">{{
                date(row.created_at)
              }}</template></ElTableColumn
            ></ElTable
          >
        </div>
        <div class="admin-bottom-note">
          <ShieldCheck
            :size="15"
          />管理员操作均记录日志。用户信息仅用于账号与交易管理。
        </div>
      </main>
    </section>
    <ElDialog
      v-model="dialog"
      :title="
        operation === 'roster'
          ? '录入授权学生名册'
          : operation === 'view'
            ? '查看详情'
            : '确认管理操作'
      "
      width="min(600px, 94vw)"
      ><template v-if="operation === 'roster'"
        ><p class="muted">
          仅录入学校授权的在校学生。学生可凭学号和本人手机号接收验证码注册。
        </p>
        <form v-if="!generated" @submit.prevent="submit">
          <label
            >学号<input
              v-model="studentNo"
              required
              pattern="[0-9]{6,20}" /></label
          ><label
            >备注昵称<input
              v-model="nickname"
              required
              minlength="2"
              maxlength="30" /></label
          ><label
            >在校有效期<input v-model="valid" type="date" required /></label
          ><button class="btn primary" :disabled="busy">录入学生名册</button>
        </form>
        <div v-else class="activation-result">
          <strong>已录入学号 {{ generated }}</strong>
          <p>学生现在可在注册页填写学号和手机号，获取验证码完成注册。</p>
        </div></template
      ><template v-else
        ><div v-if="detail?.images" class="admin-detail">
          <div class="thumbnails">
            <img
              v-for="im in detail.images"
              :src="imageUrl(im)"
              alt="审核商品图片"
            />
          </div>
          <h3>{{ detail.title }}</h3>
          <p>{{ detail.description }}</p>
        </div>
        <p v-if="detail?.reason">{{ detail.reason }}</p>
        <p v-if="detail?.resolution">处理结果：{{ detail.resolution }}</p>
        <div v-if="detail?.events" class="timeline">
          <p>面交约定：{{ detail.meeting }}</p>
          <div v-for="e in detail.events">
            <i /><span>{{ e.detail }}</span
            ><small>{{ date(e.created_at) }}</small>
          </div>
        </div>
        <form v-if="operation !== 'view'" @submit.prevent="submit">
          <p v-if="operation === 'close'" class="form-tip">
            关闭争议订单后，商品保持下架，不会自动重新出售。
          </p>
          <label
            >操作原因 / 处理依据<textarea
              v-model="reason"
              required
              minlength="5"
              maxlength="500"
              placeholder="填写具体原因，结果将通知相关用户"
            /></label
          ><button class="btn primary" :disabled="busy">确认并记录日志</button>
        </form></template
      ></ElDialog
    >
  </div>
</template>
