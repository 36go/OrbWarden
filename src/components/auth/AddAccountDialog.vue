<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { UserPlus } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import LoginPanel from './LoginPanel.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()
const authStore = useAuthStore()
const toast = useToastStore()

const openedAccountId = ref<string | null>(null)

watch(
  () => props.open,
  open => {
    if (open) openedAccountId.value = authStore.user?.id ?? null
  },
)

// Any successful login inside the panel swaps the active account (the newly
// added one becomes current). Close the dialog and confirm once the id changed.
watch(
  () => authStore.user?.id,
  (currentId) => {
    if (!props.open || !currentId) return
    if (currentId === openedAccountId.value) return
    const name = authStore.user?.global_name || authStore.user?.username || currentId
    toast.success({ title: t('account.added_account', { name }) })
    emit('update:open', false)
  },
)

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      class="flex max-h-[92vh] max-w-2xl flex-col gap-0 overflow-hidden border-border/70 bg-background/95 p-0 shadow-[0_24px_80px_-32px_hsl(var(--primary)/0.45)] backdrop-blur-xl"
    >
      <div class="flex shrink-0 items-start gap-3.5 border-b border-border/60 px-6 py-4 sm:px-8 sm:py-5">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_hsl(var(--primary))]">
          <UserPlus class="h-5 w-5" :stroke-width="1.8" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <DialogTitle class="text-lg font-semibold tracking-[-0.01em]">
            {{ t('account.add_account') }}
          </DialogTitle>
          <DialogDescription class="mt-1 text-sm leading-5 text-muted-foreground">
            {{ t('account.add_account_desc') }}
          </DialogDescription>
        </div>
      </div>

      <div class="min-h-0 overflow-y-auto">
        <LoginPanel embedded />
      </div>
    </DialogContent>
  </Dialog>
</template>