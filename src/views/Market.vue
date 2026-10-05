<script setup>
import { ref, watch, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "../store";
import { api } from "../api";
import ProductCard from "../components/ProductCard.vue";
import {
  Search,
  ArrowUpRight,
  ShieldCheck,
  MapPin,
  Sparkles,
  Laptop,
  BookOpen,
  Coffee,
  Bike,
  Car,
  Shirt,
  Shapes,
  SlidersHorizontal,
  ArrowDown,
  Heart,
  ShoppingBag,
} from "lucide-vue-next";
const route = useRoute(),
  store = useStore(),
  products = ref([]),
  total = ref(0),
  page = ref(1),
  moreBusy = ref(false),
  busy = ref(true),
  q = ref(""),
  category = ref(""),
  sort = ref("new"),
  filter = ref(false),
  min = ref(""),
  max = ref(""),
  condition = ref(""),
  location = ref(""),
  error = ref(false);
const favorites = computed(() => route.path === "/favorites");
const icons = { Laptop, BookOpen, Coffee, Bike, Car, Shirt, Shapes };
let generation = 0;
function query(pageNumber, offset) {
  return new URLSearchParams({
    q: q.value,
    category: category.value,
    sort: sort.value,
    min: min.value,
    max: max.value,
    condition: condition.value,
    location: location.value,
    page: String(pageNumber),
    ...(offset === undefined ? {} : { offset: String(offset) }),
    ...(favorites.value ? { favorites: "true" } : {}),
  });
}
async function load() {
  const requestGeneration = ++generation;
  busy.value = true;
  error.value = false;
  try {
    const result = await api("get", "/products?" + query(1));
    if (requestGeneration !== generation) return;
    products.value = result.items;
    total.value = result.total;
    page.value = 1;
  } catch {
    if (requestGeneration === generation) error.value = true;
  } finally {
    if (requestGeneration === generation) busy.value = false;
  }
}
async function loadMore() {
  if (moreBusy.value || busy.value || products.value.length >= total.value)
    return;
  const requestGeneration = generation;
  moreBusy.value = true;
  try {
    const result = await api(
      "get",
      "/products?" + query(page.value + 1, products.value.length),
    );
    if (requestGeneration !== generation) return;
    products.value.push(...result.items);
    total.value = result.total;
    page.value = result.page;
  } catch {
  } finally {
    moreBusy.value = false;
  }
}
function onFavoriteChanged({ id, favorite }) {
  if (favorites.value && !favorite) {
    products.value = products.value.filter((product) => product.id !== id);
    total.value = Math.max(0, total.value - 1);
    return;
  }
  const product = products.value.find((item) => item.id === id);
  if (product) product.favorite = favorite;
}
watch(() => route.path, load);
watch([category, sort], load);
onMounted(load);
</script>
<template>
  <section v-if="!favorites" class="hero">
    <div class="hero-copy">
      <span class="hero-kicker"><span /> 西安同城好物交换站</span>
      <h1>
        闲置不闲着，<br />好物<span class="underline">接着用。</span
        ><span class="hero-spark">✳</span>
      </h1>
      <p>
        淘点喜欢的，出点用不到的。<br
          class="mobile-only"
        />和同城的人，让闲置生活变得更有意思。
      </p>
      <router-link to="/publish" class="hero-cta"
        >给闲置一个新去处 <ArrowUpRight :size="18"
      /></router-link>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="floating-label">GOOD THINGS, SECOND STORIES.</div>
      <div class="hero-book">
        <span>KEEP<br />THE GOOD<br />GOING.</span><small>西 汽 闲 市</small>
      </div>
      <div class="hero-disc">
        <div />
        <span>CITY FINDS</span>
      </div>
      <div class="hero-bubble">同城的，<br />当面挑！<span>✦</span></div>
      <span class="art-plus">✳</span><span class="art-line">↗</span>
    </div>
  </section>
  <div v-if="!favorites" class="trust-row">
    <span
      ><ShieldCheck :size="17" />手机验证
      <small>账号有验证，交易有提醒</small></span
    ><span
      ><MapPin :size="17" />同城面交 <small>当面看看，喜欢再带走</small></span
    ><span
      ><Sparkles :size="17" />闲置循环 <small>省一点，也绿一点</small></span
    >
  </div>
  <section class="market-section">
    <div class="section-heading">
      <div>
        <span class="small-label">{{
          favorites ? "SAVED FOR LATER" : "FIND YOUR NEXT FAVORITE"
        }}</span>
        <h2>
          {{ favorites ? "心动收藏夹" : "逛逛同城好物"
          }}<span class="heading-dot">.</span>
        </h2>
      </div>
      <form class="search-box" @submit.prevent="load">
        <Search :size="19" /><input
          v-model="q"
          aria-label="搜索商品"
          placeholder="搜一搜，发现你的心动闲置"
        /><button>搜索</button>
      </form>
    </div>
    <div class="category-row">
      <button :class="{ active: category === '' }" @click="category = ''">
        全部好物</button
      ><button
        v-for="c in store.meta.categories"
        :key="c.id"
        :class="{ active: String(category) === String(c.id) }"
        @click="category = String(c.id)"
      >
        <component :is="icons[c.icon]" :size="17" />{{ c.name }}
      </button>
    </div>
    <div class="result-toolbar">
      <span
        ><span class="live-dot" />
        {{ favorites ? "留住每一次心动" : "新鲜闲置，刚刚上架" }}
        <small>共 {{ total }} 件好物</small></span
      >
      <div>
        <select v-model="sort" aria-label="排序">
          <option value="new">最新发布</option>
          <option value="price">价格从低到高</option>
          <option value="price_desc">价格从高到低</option></select
        ><button
          class="filter-btn"
          :class="{ active: filter }"
          @click="filter = !filter"
        >
          <SlidersHorizontal :size="15" />筛选
        </button>
      </div>
    </div>
    <form v-if="filter" class="filter-panel" @submit.prevent="load">
      <label
        >最低价<input
          v-model="min"
          type="number"
          min="0"
          placeholder="¥ 0" /></label
      ><label
        >最高价<input
          v-model="max"
          type="number"
          min="0"
          placeholder="不限" /></label
      ><label
        >成色<select v-model="condition">
          <option value="">全部成色</option>
          <option
            v-for="c in [
              '全新',
              '几乎全新',
              '轻微使用痕迹',
              '明显使用痕迹',
              '功能有瑕疵',
            ]"
          >
            {{ c }}
          </option>
        </select></label
      ><label
        >地点<select v-model="location">
          <option value="">全部地点</option>
          <option v-for="l in store.meta.locations" :value="l.id">
            {{ l.name }}
          </option>
        </select></label
      ><button class="btn primary">应用筛选</button>
    </form>
    <div v-if="busy" class="product-grid">
      <div v-for="i in 8" class="skeleton-card" />
    </div>
    <div v-else-if="products.length" class="product-grid">
      <ProductCard
        v-for="p in products"
        :key="p.id"
        :product="p"
        @favorite-changed="onFavoriteChanged"
      />
    </div>
    <div v-else class="empty-state">
      <ShoppingBag :size="46" />
      <h3>{{ error ? "暂时没能加载好物" : "这里还没有好物" }}</h3>
      <p>
        {{ error ? "检查网络后再试一次" : "换个关键词，或先逛逛其他好物吧" }}
      </p>
      <button
        class="btn subtle"
        @click="
          q = '';
          category = '';
          load();
        "
      >
        {{ error ? "重新加载" : "查看全部" }}
      </button>
    </div>
    <div v-if="products.length && products.length < total" class="load-more">
      <button class="btn subtle" :disabled="moreBusy" @click="loadMore">
        {{ moreBusy ? "加载中…" : "加载更多好物" }}
      </button>
    </div>
    <div v-if="products.length && products.length >= total" class="list-ending">
      <span />好物慢慢淘，快乐不打烊<span />
    </div>
  </section>
</template>
