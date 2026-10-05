<script setup>
import { reactive, ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "../store";
import { api, imageUrl } from "../api";
import {
  ImagePlus,
  X,
  ArrowLeft,
  ArrowUpRight,
  ShieldCheck,
  Grip,
  Check,
} from "lucide-vue-next";
import { showToast } from "vant";
const store = useStore(),
  route = useRoute(),
  router = useRouter(),
  busy = ref(false),
  uploading = ref(false),
  fileInput = ref(null);
const form = reactive({
  title: "",
  description: "",
  categoryId: 1,
  locationId:
    store.meta.locations.find((place) => place.id >= 100)?.id ??
    store.meta.locations[0]?.id ??
    1,
  condition: "几乎全新",
  price: "",
  negotiable: true,
  images: [],
  version: undefined,
});
onMounted(async () => {
  if (route.params.id)
    try {
      const p = await api("get", "/products/" + route.params.id);
      Object.assign(form, {
        title: p.title,
        description: p.description,
        categoryId: p.category_id,
        locationId: p.location_id,
        condition: p.condition_code,
        price: p.price_cents / 100,
        negotiable: p.negotiable,
        images: p.images,
        version: p.version,
      });
    } catch {
      router.push("/me");
    }
});
async function upload(e) {
  uploading.value = true;
  try {
    for (const f of Array.from(e.target.files).slice(
      0,
      9 - form.images.length,
    )) {
      const data = new FormData();
      data.append("file", f);
      const a = await api("post", "/uploads", data);
      form.images.push(a.id);
    }
  } catch {
  } finally {
    uploading.value = false;
    e.target.value = "";
  }
}
async function submit() {
  if (!form.images.length) return showToast("至少上传一张商品图片");
  busy.value = true;
  try {
    const data = { ...form, priceCents: Math.round(Number(form.price) * 100) };
    delete data.price;
    const p = await api(
      route.params.id ? "patch" : "post",
      route.params.id ? "/products/" + route.params.id : "/products",
      data,
    );
    showToast("提交成功，审核通过后上架");
    router.push("/me");
  } catch {
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="publish-page">
    <router-link to="/me" class="back-link"
      ><ArrowLeft :size="17" /> 我的闲置</router-link
    >
    <div class="section-heading">
      <div>
        <span class="small-label">PASS ON THE GOOD</span>
        <h1>
          {{ route.params.id ? "编辑你的好物" : "让闲置，开启新故事"
          }}<span class="heading-dot">.</span>
        </h1>
        <p class="muted">拍张照片，写点介绍，让需要它的人发现它。</p>
      </div>
    </div>
    <div class="publish-layout">
      <form class="panel publish-form" @submit.prevent="submit">
        <h3><span class="step-number">01</span>给好物拍个照</h3>
        <div class="upload-grid">
          <div v-for="(im, i) in form.images" class="upload-image">
            <img :src="imageUrl(im)" alt="商品图片" /><button
              type="button"
              aria-label="删除图片"
              @click="form.images.splice(i, 1)"
            >
              <X :size="15" /></button
            ><span v-if="i === 0">封面</span>
          </div>
          <button
            v-if="form.images.length < 9"
            type="button"
            class="upload-box"
            :disabled="uploading"
            @click="fileInput.click()"
          >
            <ImagePlus :size="30" /><strong>{{
              uploading ? "正在上传…" : "上传图片"
            }}</strong
            ><small>{{ form.images.length }} / 9</small>
          </button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          @change="upload"
        />
        <p class="form-tip">
          支持 JPG、PNG、WebP，单张不超过5MB。第一张为封面。
        </p>
        <h3><span class="step-number">02</span>介绍一下它</h3>
        <label
          >商品标题<input
            v-model="form.title"
            placeholder="品牌、品类、亮点，让买家一眼看到"
            required
            minlength="2"
            maxlength="60" /></label
        ><label
          >详细描述<textarea
            v-model="form.description"
            rows="5"
            placeholder="用了多久？有没有瑕疵？为什么转让？真实描述会让交易更顺利。"
            required
            minlength="10"
            maxlength="3000"
          />
        </label>
        <div class="form-row">
          <label
            >商品分类<select v-model="form.categoryId">
              <option v-for="c in store.meta.categories" :value="c.id">
                {{ c.name }}
              </option>
            </select></label
          ><label
            >商品成色<select v-model="form.condition">
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
          >
        </div>
        <h3><span class="step-number">03</span>价格与交易</h3>
        <div class="form-row">
          <label
            >转让价格（元）<input
              v-model="form.price"
              type="number"
              min="0.01"
              max="100000"
              step="0.01"
              placeholder="0.00"
              required /></label
          ><label
            >所在区域<select v-model="form.locationId">
              <option v-for="l in store.meta.locations" :value="l.id">
                {{ l.name }}
              </option>
            </select></label
          >
        </div>
        <label class="checkbox-label"
          ><input
            v-model="form.negotiable"
            type="checkbox"
          />接受合理砍价，和买家商量着来</label
        >
        <div class="form-bottom">
          <span class="muted">提交后由管理员审核上架</span
          ><button class="btn primary" :disabled="busy || uploading">
            {{ busy ? "正在提交…" : "提交审核" }}<ArrowUpRight :size="18" />
          </button>
        </div>
      </form>
      <aside class="publish-tips">
        <span class="tip-icon">✦</span>
        <h3>好好介绍，<br />更快遇见新主人。</h3>
        <p><Check :size="16" />自然光下拍摄，展示商品全貌</p>
        <p><Check :size="16" />如实描述使用痕迹和功能瑕疵</p>
        <p><Check :size="16" />价格合理，也可以留点商量空间</p>
        <hr />
        <ShieldCheck :size="23" /><strong>同城交易小提醒</strong>
        <p>优先选择公共区域面交，当面验货，确认后付款。</p>
      </aside>
    </div>
  </div>
</template>
