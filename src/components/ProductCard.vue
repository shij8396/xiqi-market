<script setup>
import { ref } from "vue";
import { Heart, MapPin } from "lucide-vue-next";
import { api, price, imageUrl } from "../api";
import { showToast } from "vant";
import { useRouter } from "vue-router";
import { useStore } from "../store";
const router = useRouter(),
  store = useStore();
const props = defineProps({ product: Object });
const emit = defineEmits(["favorite-changed"]);
const saving = ref(false);
async function favorite() {
  if (!store.user) return router.push("/login");
  if (saving.value) return;
  saving.value = true;
  try {
    const next = !props.product.favorite;
    await api(next ? "put" : "delete", "/favorites/" + props.product.id);
    emit("favorite-changed", { id: props.product.id, favorite: next });
    showToast(next ? "已加入收藏" : "已取消收藏");
  } catch {
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <article class="product-card">
    <router-link :to="'/products/' + product.id" class="product-picture"
      ><img
        :src="imageUrl(product.images[0])"
        :alt="product.title"
        loading="lazy"
      /><span class="condition-tag">{{ product.condition_code }}</span
      ><span v-if="product.status !== 'ON_SALE'" class="sold-cover">{{
        {
          RESERVED: "交易中",
          SOLD: "已售出",
          REMOVED: "已下架",
          OFF_SHELF: "已下架",
          PENDING_REVIEW: "审核中",
          REJECTED: "已退回",
        }[product.status]
      }}</span></router-link
    ><button
      class="favorite-button"
      :class="{ selected: product.favorite }"
      aria-label="收藏商品"
      :aria-pressed="product.favorite"
      :aria-busy="saving"
      :disabled="saving"
      @click="favorite"
    >
      <Heart :size="18" :fill="product.favorite ? 'currentColor' : 'none'" />
    </button>
    <div class="product-content">
      <router-link :to="'/products/' + product.id" class="product-title">{{
        product.title
      }}</router-link>
      <div class="price-line">
        <span class="price"
          ><small>¥</small>{{ price(product.price_cents) }}</span
        ><span v-if="product.negotiable" class="negotiable">可小刀</span>
      </div>
      <div class="seller-line">
        <span class="mini-avatar">{{ product.seller_name.slice(0, 1) }}</span
        ><span>{{ product.seller_name }}</span
        ><span class="verified-dot">✓</span>
      </div>
      <div class="location-line">
        <MapPin :size="12" />{{
          product.location_name.replace("（演示地点）", "")
        }}
      </div>
    </div>
  </article>
</template>
