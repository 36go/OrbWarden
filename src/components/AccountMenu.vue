<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ChevronDown, LogOut, Trash2, ArrowLeftRight, UserPlus } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import AddAccountDialog from '@/components/auth/AddAccountDialog.vue'

const { t } = useI18n()
const authStore = useAuthStore()
const emit = defineEmits<{ logout: [] }>()

const user = computed(() => authStore.user)
const open = ref(false)
const addAccountOpen = ref(false)
const switchingId = ref<string | null>(null)
const containerRef = ref<HTMLElement | null>(null)

const avatarUrl = computed(() => {
  if (!user.value?.avatar) return null
  return `https://cdn.discordapp.com/avatars/${user.value.id}/${user.value.avatar}.png?size=128`
})

const switchableAccounts = computed(() => {
  if (!user.value) return []
  return authStore.savedAccounts.filter(saved => saved.user.id !== user.value!.id)
})

function avatarFor(saved: { user: { id: string; username: string; avatar?: string | null } }) {
  if (!saved.user.avatar) return null
  return `https://cdn.discordapp.com/avatars/${saved.user.id}/${saved.user.avatar}.png?size=128`
}

function handleClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

function handleLogout() {
  open.value = false
  emit('logout')
}

async function handleSwitch(userId: string) {
  if (switchingId.value) return
  switchingId.value = userId
  try {
    await authStore.switchToSavedAccount(userId)
  } finally {
    switchingId.value = null
    open.value = false
  }
}

function handleRemove(userId: string) {
  authStore.removeSavedAccount(userId)
}

function handleAddAccount() {
  open.value = false
  addAccountOpen.value = true
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', handleClickOutside))
</script>

<template>
  <div v-if="user" ref="containerRef" class="relative">
    <!-- Trigger button — pure HTML, no Radix wrapper -->
    <button
      class="h-10 px-2 rounded-lg inline-flex items-center gap-2 hover:bg-muted/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="open = !open"
    >
      <Avatar class="w-8 h-8 shrink-0">
        <AvatarImage v-if="avatarUrl" :src="avatarUrl" :alt="user.username" />
        <AvatarFallback>{{ user.username[0].toUpperCase() }}</AvatarFallback>
      </Avatar>

      <span class="hidden md:inline-flex flex-col items-start min-w-0 leading-tight">
        <span class="text-sm font-medium max-w-[120px] truncate">
          {{ user.global_name || user.username }}
        </span>
        <span class="text-xs text-muted-foreground max-w-[120px] truncate">
          @{{ user.username }}
        </span>
      </span>

      <ChevronDown
        class="w-4 h-4 text-muted-foreground shrink-0 hidden md:block transition-transform"
        :class="open && 'rotate-180'"
      />
    </button>

    <!-- Dropdown content — positioned absolutely, no Radix portal -->
    <Transition
      enter-active-class="transition ease-out duration-150"
      enter-from-class="opacity-0 -translate-y-1 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 -translate-y-1 scale-95"
    >
      <div
        v-if="open"
        class="absolute right-0 top-full mt-2 z-50 w-56 rounded-lg border bg-popover text-popover-foreground shadow-md overflow-hidden"
      >
        <!-- User info header -->
        <div class="px-3 py-3">
          <div class="flex items-center gap-3">
            <Avatar class="w-10 h-10 shrink-0">
              <AvatarImage v-if="avatarUrl" :src="avatarUrl" :alt="user.username" />
              <AvatarFallback>{{ user.username[0].toUpperCase() }}</AvatarFallback>
            </Avatar>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ user.global_name || user.username }}</p>
              <p class="text-xs text-muted-foreground truncate">@{{ user.username }}</p>
            </div>
          </div>
        </div>

        <div class="h-px bg-border mx-2" />

        <!-- Switch account -->
        <div v-if="switchableAccounts.length > 0" class="max-h-48 overflow-y-auto py-1">
          <p class="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {{ t('account.switch_account') }}
          </p>
          <div
            v-for="saved in switchableAccounts"
            :key="saved.user.id"
            class="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/60 transition-colors"
          >
            <button
              class="flex flex-1 min-w-0 items-center gap-2 text-left"
              :title="t('account.switch_to', { name: saved.user.global_name || saved.user.username })"
              @click="handleSwitch(saved.user.id)"
            >
              <Avatar class="w-7 h-7 shrink-0">
                <AvatarImage v-if="avatarFor(saved)" :src="avatarFor(saved)!" :alt="saved.user.username" />
                <AvatarFallback>{{ saved.user.username[0].toUpperCase() }}</AvatarFallback>
              </Avatar>
              <span class="min-w-0 flex-1 leading-tight">
                <span class="block text-sm font-medium truncate">{{ saved.user.global_name || saved.user.username }}</span>
                <span class="block text-xs text-muted-foreground truncate">@{{ saved.user.username }}</span>
              </span>
              <ArrowLeftRight v-if="switchingId === saved.user.id" class="w-3.5 h-3.5 text-primary animate-pulse" />
              <ArrowLeftRight v-else class="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              class="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
              :title="t('account.remove')"
              @click="handleRemove(saved.user.id)"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div class="h-px bg-border mx-2 my-1" />

        <!-- Add account -->
        <button
          class="w-full px-3 py-2 text-left text-sm hover:bg-muted/60 transition-colors inline-flex items-center gap-2"
          @click="handleAddAccount"
        >
          <UserPlus class="w-4 h-4" />
          {{ t('account.add_account') }}
        </button>

        <div class="h-px bg-border mx-2 my-1" />

        <!-- Logout -->
        <button
          class="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors inline-flex items-center gap-2"
          @click="handleLogout"
        >
          <LogOut class="w-4 h-4" />
          {{ t('general.logout') }}
        </button>
      </div>
    </Transition>

    <AddAccountDialog v-model:open="addAccountOpen" />
  </div>
</template>
