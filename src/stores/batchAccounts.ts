import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Quest } from '@/api/tauri'
import { useAuthStore } from './auth'
import { useQuestsStore } from './quests'
import { useToastStore } from './toast'
import { useI18n } from 'vue-i18n'
import { getQuestKind } from '@/utils/questTasks'
import { getSimulationExecutables } from '@/utils/executables'
import { notify } from '@/utils/notify'

export interface BatchAccountResult {
  userId: string
  name: string
  queued: number
  status: 'success' | 'failed' | 'paused' | 'skipped' | 'cancelled'
  error?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isExpired(quest: Quest): boolean {
  if (!quest.config.expires_at) return false
  return new Date(quest.config.expires_at) < new Date()
}

function isRunable(quest: Quest): boolean {
  if (!quest.user_status?.enrolled_at) return false
  if (quest.user_status?.completed_at) return false
  if (isExpired(quest)) return false
  return true
}

export const useBatchStore = defineStore('batch', () => {
  const { t } = useI18n()
  const isRunning = ref(false)
  const cancelRequested = ref(false)
  const results = ref<BatchAccountResult[]>([])
  const totalAccounts = ref(0)
  const currentIndex = ref(0)
  const currentAccountId = ref<string | null>(null)
  const currentAccountName = ref('')
  const currentQueued = ref(0)

  const progress = computed(() => {
    if (totalAccounts.value === 0) return 0
    return Math.round((currentIndex.value / totalAccounts.value) * 100)
  })

  async function waitForQueueDrain(): Promise<'success' | 'paused' | 'cancelled'> {
    const questsStore = useQuestsStore()
    while (true) {
      if (cancelRequested.value) return 'cancelled'
      if (questsStore.queuePauseReason) return 'paused'
      if (!questsStore.isQueueRunning && questsStore.questQueue.length === 0) return 'success'
      await sleep(500)
    }
  }

  function labelForStatus(status: BatchAccountResult['status']): string {
    return t(`batch.status_${status}`)
  }

  async function runAccount(userId: string): Promise<void> {
    const authStore = useAuthStore()
    const questsStore = useQuestsStore()

    // Clear whatever the previous account left behind before switching.
    questsStore.clearQueue()

    const loginOk = await authStore.switchToSavedAccount(userId)
    if (!loginOk) {
      throw new Error(t('batch.login_failed'))
    }

    // The login may have triggered a background queue/switch; reset cleanly.
    questsStore.clearQueue()

    await questsStore.fetchQuests(false, true)

    // Enroll in any quests this account has not joined yet.
    const unenrolled = questsStore.quests.filter(
      q => !q.user_status?.enrolled_at && !isExpired(q) && !!q.user_status,
    )
    if (unenrolled.length > 0) {
      await questsStore.acceptAllQuests(unenrolled.map(q => q.id))
    }

    // Build the run queue.
    await questsStore.initPlatformCapabilities()
    const capabilities = questsStore.platformCapabilities
    const gamesList = await questsStore.getDetectableGames()
    const toQueue: Array<{ quest: Quest; exeName?: string }> = []

    for (const quest of questsStore.quests) {
      if (!isRunable(quest)) continue
      const kind = getQuestKind(quest)
      if (kind === 'activity') continue

      if (kind === 'stream' && questsStore.gameQuestMode === 'simulate') {
        const appId = quest.config.application?.id
        const game = gamesList.find(g => g.id === appId)
        if (!game) continue
        const executables = getSimulationExecutables(
          game.executables,
          capabilities?.os ?? '',
          capabilities?.executableOsPriority ?? [],
        )
        if (executables.length === 0) continue
        toQueue.push({ quest, exeName: executables[0].name })
      } else {
        toQueue.push({ quest })
      }
    }

    if (toQueue.length === 0) {
      currentQueued.value = 0
      return
    }

    toQueue.forEach(({ quest, exeName }) => {
      questsStore.addToQueue(quest, exeName)
    })
    currentQueued.value = toQueue.length
    questsStore.startQueue()

    const outcome = await waitForQueueDrain()
    if (outcome === 'paused') {
      questsStore.clearQueue()
    }
  }

  async function startBatch(accountIds?: string[]) {
    if (isRunning.value) return
    const authStore = useAuthStore()
    const questsStore = useQuestsStore()
    const toast = useToastStore()

    cancelRequested.value = false
    results.value = []
    currentIndex.value = 0

    const accounts = authStore.savedAccounts.filter(
      saved => !accountIds || accountIds.length === 0 || accountIds.includes(saved.user.id),
    )
    if (accounts.length === 0) {
      toast.info({ title: t('batch.no_accounts') })
      return
    }
    totalAccounts.value = accounts.length
    isRunning.value = true

    let successCount = 0
    let failedCount = 0
    let skippedCount = 0
    let pausedCount = 0

    try {
      for (const saved of accounts) {
        const name = saved.user.global_name || saved.user.username
        if (cancelRequested.value) {
          results.value.push({ userId: saved.user.id, name, queued: 0, status: 'cancelled' })
          continue
        }
        currentAccountId.value = saved.user.id
        currentAccountName.value = name
        currentQueued.value = 0
        currentIndex.value += 1

        try {
          await runAccount(saved.user.id)
          const queued = currentQueued.value
          if (queued === 0) {
            results.value.push({ userId: saved.user.id, name, queued: 0, status: 'skipped' })
            skippedCount++
            toast.info({ title: `${name} · ${labelForStatus('skipped')}` })
          } else {
            results.value.push({ userId: saved.user.id, name, queued, status: 'success' })
            successCount++
            toast.success({ title: `${name} · ${labelForStatus('success')} (${queued})` })
          }
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          const status = questsStore.queuePauseReason !== null ? 'paused' : 'failed'
          if (status === 'paused') pausedCount++
          else failedCount++
          results.value.push({ userId: saved.user.id, name, queued: currentQueued.value, status, error: reason })
          toast.error({ title: `${name} · ${labelForStatus(status)}` })
        }

        const last = results.value[results.value.length - 1]
        const statusText = labelForStatus(last.status)
        notify(t('batch.notify_account_done', { name, status: statusText }))
      }
    } finally {
      if (cancelRequested.value) questsStore.clearQueue()
      isRunning.value = false
      currentAccountId.value = null
      currentAccountName.value = ''
      currentQueued.value = 0
      cancelRequested.value = false
    }

    const doneKey =
      pausedCount > 0
        ? 'batch.finished_paused'
        : failedCount > 0
          ? 'batch.finished_partial'
          : 'batch.finished'
    const success = successCount
    const failed = failedCount
    const skipped = skippedCount
    const paused = pausedCount
    toast.success({
      title: t(doneKey, { success, failed, skipped, paused }),
    })
    notify(t('batch.notify_done', { success, failed, skipped }))
  }

  function cancelBatch() {
    if (!isRunning.value) return
    cancelRequested.value = true
  }

  return {
    isRunning,
    results,
    totalAccounts,
    currentIndex,
    currentAccountId,
    currentAccountName,
    currentQueued,
    progress,
    startBatch,
    cancelBatch,
  }
})