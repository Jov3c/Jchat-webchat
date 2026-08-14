<template>
  <Teleport to="body">
    <Transition name="cm">
      <div class="cm-overlay" @click.self="$emit('close')" @contextmenu.prevent="$emit('close')">
        <div class="cm-card">
          <div class="cm-head">
            <span class="cm-title"># {{ displayName }}</span>
            <span class="cm-role">{{ isOwner ? '创建者' : '成员' }}</span>
            <button class="cm-close" @click="$emit('close')" aria-label="关闭">×</button>
          </div>

          <div class="cm-section">
            <span class="cm-label">频道备注（仅自己可见）</span>
            <form class="cm-row" @submit.prevent="saveAlias">
              <input v-model="alias" placeholder="设置备注" />
              <button type="submit" class="cm-btn">保存</button>
            </form>
          </div>

          <template v-if="isOwner">
            <div class="cm-section">
              <span class="cm-label">邀请成员</span>
              <form class="cm-row" @submit.prevent="invite">
                <input v-model="inviteNames" placeholder="输入账号，逗号分隔" />
                <button type="submit" class="cm-btn">邀请</button>
              </form>
            </div>
            <div class="cm-section">
              <span class="cm-label">成员</span>
              <div v-if="!members.length" class="cm-empty">暂无成员</div>
              <div v-for="m in members" :key="m.id" class="cm-member">
                <span class="cm-name">{{ m.nickname || m.username }}</span>
                <button v-if="m.id !== meId" class="cm-del" @click="removeMember(m.id)">移除</button>
              </div>
            </div>
            <button class="cm-disband" @click="disband">解散频道</button>
          </template>

          <template v-else>
            <button class="cm-leave" @click="leave">退出频道</button>
          </template>

          <p v-if="error" class="cm-error">{{ error }}</p>
          <p v-if="msg" class="cm-ok">{{ msg }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { http } from '../api/http.js';
import { getUser } from '../stores/auth.js';
import { getChannel, setChannelAlias } from '../stores/channels.js';

const props = defineProps({ channel: String });
const emit = defineEmits(['close', 'changed']);

const meId = getUser()?.id;
const alias = ref('');
const inviteNames = ref('');
const members = ref([]);
const error = ref('');
const msg = ref('');

const chan = computed(() => getChannel(props.channel));
const isOwner = computed(() => !!chan.value?.isOwner);
const displayName = computed(() => chan.value?.alias || props.channel);

onMounted(() => {
  alias.value = chan.value?.alias || '';
  if (isOwner.value) loadMembers();
});

async function loadMembers() {
  try {
    const data = await http.get(`/api/channel/${encodeURIComponent(props.channel)}/members`);
    members.value = data.members || data || [];
  } catch { members.value = []; }
}

async function saveAlias() {
  error.value = '';
  msg.value = '';
  try {
    await http.put(`/api/channel/${encodeURIComponent(props.channel)}/alias`, { alias: alias.value.trim() });
    setChannelAlias(props.channel, alias.value.trim() || null);
    msg.value = '已保存';
    emit('changed');
  } catch (e) {
    error.value = e.message || '保存失败';
  }
}

async function invite() {
  error.value = '';
  msg.value = '';
  const names = inviteNames.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
  if (!names.length) { error.value = '请输入账号'; return; }
  try {
    await http.post(`/api/channel/${encodeURIComponent(props.channel)}/members`, { usernames: names });
    inviteNames.value = '';
    msg.value = '已邀请';
    await loadMembers();
    emit('changed');
  } catch (e) {
    error.value = e.message || '邀请失败';
  }
}

async function removeMember(id) {
  error.value = '';
  try {
    await http.del(`/api/channel/${encodeURIComponent(props.channel)}/members/${id}`);
    await loadMembers();
    emit('changed');
  } catch (e) {
    error.value = e.message || '移除失败';
  }
}

async function disband() {
  if (!confirm('确定要解散这个频道吗？解散后所有成员都将失去该频道。')) return;
  error.value = '';
  try {
    await http.del(`/api/channel/${encodeURIComponent(props.channel)}`);
    emit('changed');
    emit('close');
  } catch (e) {
    error.value = e.message || '解散失败';
  }
}

async function leave() {
  error.value = '';
  try {
    await http.post(`/api/channel/${encodeURIComponent(props.channel)}/leave`);
    emit('changed');
    emit('close');
  } catch (e) {
    error.value = e.message || '退出失败';
  }
}
</script>

<style scoped>
.cm-overlay { position: fixed; inset: 0; z-index: 96; background: rgba(20, 18, 14, 0.25); display: grid; place-items: center; }
.cm-card {
  width: 340px; max-height: 70vh; overflow-y: auto; padding: 18px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
}
.cm-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.cm-title { font-weight: 600; font-size: 15px; }
.cm-role { font-size: 11px; color: var(--accent-strong); background: var(--accent-soft); padding: 2px 8px; border-radius: 999px; }
.cm-close { margin-left: auto; border: 0; background: transparent; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
.cm-close:hover { color: var(--text); }
.cm-section { margin-bottom: 12px; }
.cm-label { display: block; font-size: 12px; font-weight: 600; color: var(--faint); margin-bottom: 6px; }
.cm-row { display: flex; gap: 8px; }
.cm-row input { flex: 1; padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 14px; }
.cm-btn { padding: 9px 14px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
.cm-btn:hover { background: var(--accent-strong); }
.cm-member { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.cm-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.cm-del { padding: 5px 10px; border: 1px solid var(--red); border-radius: 7px; background: transparent; color: var(--red); font-size: 12px; cursor: pointer; }
.cm-del:hover { background: var(--red); color: #fff; }
.cm-leave { width: 100%; padding: 9px; border: 1px solid var(--red); border-radius: 9px; background: transparent; color: var(--red); font-size: 13px; cursor: pointer; }
.cm-leave:hover { background: var(--red); color: #fff; }
.cm-disband { width: 100%; margin-top: 12px; padding: 9px; border: 1px solid var(--red); border-radius: 9px; background: transparent; color: var(--red); font-size: 13px; cursor: pointer; }
.cm-disband:hover { background: var(--red); color: #fff; }
.cm-empty { color: var(--muted); font-size: 13px; padding: 4px 0; }
.cm-error { color: var(--red); font-size: 12px; margin-top: 4px; }
.cm-ok { color: var(--green); font-size: 12px; margin-top: 4px; }

.cm-enter-active, .cm-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.cm-enter-from, .cm-leave-to { opacity: 0; transform: translateY(4px); }
</style>
