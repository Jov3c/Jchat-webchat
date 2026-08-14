<template>
  <Teleport to="body">
    <Transition name="card">
      <div v-if="state.open" class="card-overlay" @click="closeUserCard" @contextmenu.prevent="closeUserCard">
        <div class="user-card" :style="{ left: state.x + 'px', top: state.y + 'px' }" @click.stop>
          <div v-if="state.loading" class="card-loading">加载中…</div>
          <template v-else-if="state.user">
            <div class="card-head">
              <Avatar :src="state.user.avatar" :name="state.user.nickname || state.user.username" :presence="state.user.effective_status" :size="48" />
              <div class="card-id">
                <div class="card-name">{{ state.user.nickname || state.user.username }}</div>
                <div class="card-username">@{{ state.user.username }}</div>
              </div>
            </div>
            <div v-if="state.user.bio" class="card-bio">{{ state.user.bio }}</div>
            <div class="card-meta">
              <span v-if="state.user.gender">性别：{{ genderLabel(state.user.gender) }}</span>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import Avatar from './Avatar.vue';
import { closeUserCard, useUserCard } from '../stores/userCard.js';

const state = useUserCard();

function genderLabel(g) { return g === 'male' ? '男' : g === 'female' ? '女' : '其他'; }
</script>

<style scoped>
.card-overlay { position: fixed; inset: 0; z-index: 95; }
.user-card {
  position: fixed; width: 280px; padding: 16px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
}
.card-loading { color: var(--muted); font-size: 13px; }
.card-head { display: flex; align-items: center; gap: 12px; }
.card-id { min-width: 0; }
.card-name { font-weight: 600; font-size: 15px; }
.card-username { color: var(--muted); font-size: 13px; }
.card-bio { margin-top: 10px; font-size: 13px; line-height: 1.6; color: var(--text); white-space: pre-wrap; overflow-wrap: break-word; }
.card-meta { margin-top: 10px; font-size: 12px; color: var(--faint); }

.card-enter-active, .card-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.card-enter-from, .card-leave-to { opacity: 0; transform: translateY(4px); }
</style>
