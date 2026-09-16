import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DiscordUser, ExtractedAccount, ProgramReward, AuthProgress, AuthProgressHandler } from '@/api/tauri'
import { autoDetectToken, setToken, autoLoginViaCdp, autoFetchSuperProperties, getProgramRewards, dpapiEncrypt, dpapiDecrypt } from '@/api/tauri'
import { useQuestsStore } from './quests'
import { useI18n } from 'vue-i18n'
import { useNow } from '@vueuse/core'
import { getNitroOrbsClaim } from '@/utils/nitroOrbsCountdown'

const SAVED_ACCOUNTS_KEY = 'dqh.savedAccounts'

export interface SavedAccount {
  token: string
  user: DiscordUser
  savedAt: number
  /** True when token is wrapped with the platform protector (DPAPI on Windows). */
  encrypted?: boolean
}

function loadSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function protectToken(tokenValue: string): Promise<{ token: string; encrypted: boolean }> {
  try {
    return { token: await dpapiEncrypt(tokenValue), encrypted: true }
  } catch {
    return { token: tokenValue, encrypted: false }
  }
}

async function restoreToken(saved: SavedAccount): Promise<string> {
  if (!saved.encrypted) return saved.token
  try {
    return await dpapiDecrypt(saved.token)
  } catch {
    return saved.token
  }
}

export const useAuthStore = defineStore('auth', () => {
  const { t } = useI18n()
  const user = ref<DiscordUser | null>(null)
  const token = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const detectedAccounts = ref<ExtractedAccount[]>([])
  const savedAccounts = ref<SavedAccount[]>(loadSavedAccounts())

  // One-time migration: wrap any legacy in-plaintext tokens with DPAPI. Runs in
  // the background so startup is never blocked, and is a no-op when encryption
  // is unavailable.
  async function upgradeSavedAccountsInBackground() {
    if (savedAccounts.value.some(saved => saved.encrypted)) return
    let changed = false
    for (const saved of savedAccounts.value) {
      if (saved.encrypted) continue
      const encryptedToken = await protectToken(saved.token)
      if (encryptedToken.encrypted) {
        saved.token = encryptedToken.token
        saved.encrypted = true
        changed = true
      }
    }
    if (changed) persistSavedAccounts()
  }
  upgradeSavedAccountsInBackground()

  function persistSavedAccounts() {
    try {
      localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(savedAccounts.value))
    } catch {
      // Ignore storage failures; the session still works in memory.
    }
  }

  function savedAccountForUser(userId: string): SavedAccount | null {
    return savedAccounts.value.find(saved => saved.user.id === userId) ?? null
  }

  async function saveAccount(userId: string, tokenValue: string, savedUser: DiscordUser) {
    const existing = savedAccountForUser(userId)
    const encryptedToken = await protectToken(tokenValue)
    const entry: SavedAccount = {
      token: encryptedToken.token,
      user: savedUser,
      savedAt: existing?.savedAt ?? Date.now(),
      encrypted: encryptedToken.encrypted,
    }
    const index = savedAccounts.value.findIndex(saved => saved.user.id === userId)
    if (index >= 0) {
      savedAccounts.value[index] = entry
    } else {
      savedAccounts.value.push(entry)
    }
    persistSavedAccounts()
  }

  function removeSavedAccount(userId: string) {
    savedAccounts.value = savedAccounts.value.filter(saved => saved.user.id !== userId)
    persistSavedAccounts()
  }

  async function switchToSavedAccount(userId: string, onProgress?: AuthProgressHandler): Promise<boolean> {
    const saved = savedAccountForUser(userId)
    if (!saved) return false
    return await loginWithToken(await restoreToken(saved), onProgress)
  }

  // Discord's Program Rewards endpoint owns the monthly Orbs schedule.
  const nitroProgramReward = ref<ProgramReward | null>(null)
  const programRewardLoading = ref(false)
  const programRewardError = ref<string | null>(null)
  const programRewardLoaded = ref(false)
  const currentTime = useNow({ interval: 60_000 })
  let programRewardRequestRevision = 0

  function resetProgramRewardState() {
    programRewardRequestRevision += 1
    nitroProgramReward.value = null
    programRewardLoading.value = false
    programRewardError.value = null
    programRewardLoaded.value = false
  }

  async function tryAutoDetect(
    onProgress?: AuthProgressHandler,
    commitMultipleAccounts?: (accounts: ExtractedAccount[]) => void | Promise<void>,
  ) {
    loading.value = true
    error.value = null
    detectedAccounts.value = []

    try {
      const accounts = await autoDetectToken(onProgress)

      if (accounts.length === 1) {
        // Only one account found, login automatically
        return await loginWithToken(accounts[0].token, onProgress)
      } else {
        // Multiple accounts, let UI handle selection
        if (commitMultipleAccounts) {
          await commitMultipleAccounts(accounts)
        } else {
          detectedAccounts.value = accounts
        }
      }
      return true
    } catch (e) {
      console.error('Auto detect failed:', e)
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      loading.value = false
    }
  }

  async function loginWithToken(tokenValue: string, onProgress?: AuthProgressHandler) {
    loading.value = true
    error.value = null
    resetProgramRewardState()
    try {
      user.value = await setToken(tokenValue, (progress) => {
        // The store still performs one final SuperProperties synchronization
        // after the backend command. Keep the visible operation running until
        // that existing step has settled.
        if (progress.phase !== 'complete') onProgress?.(progress)
      })
      token.value = tokenValue
      if (user.value) {
        await saveAccount(user.value.id, tokenValue, user.value)
      }

      // The backend already primed the request identity inside set_token
      // (CDP -> Remote JS -> defaults), so do not block the login spinner on a
      // second SuperProperties fetch round. Refresh it in the background the
      // same way the rest of the post-login data is loaded.
      const questsStore = useQuestsStore()
      autoFetchSuperProperties(questsStore.cdpPort).catch(e => {
        // SuperProperties refresh failure should not surface during login
        console.warn('Failed to refresh SuperProperties after login:', e)
      })

      bootstrapAfterLogin(questsStore, 'CDP init on login failed:')

      onProgress?.(completeAuthProgress())

      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Log in by capturing the currently running Discord client's session over CDP
   * (the primary login path on Linux). The raw token is never exposed to the
   * frontend: the backend captures, validates, and stores it, returning only the
   * DiscordUser. Requires Discord to be running with CDP enabled.
   */
  async function loginViaCdp(onProgress?: AuthProgressHandler) {
    loading.value = true
    error.value = null
    resetProgramRewardState()
    try {
      const questsStore = useQuestsStore()
      user.value = await autoLoginViaCdp(questsStore.cdpPort, onProgress)
      // Intentionally leave `token` null: CDP auto-login never surfaces the raw
      // token. Authenticated backend commands use the client in AppState.
      token.value = null

      // CDP is available by definition here (we just used it). Keep the login
      // method and quest execution method aligned so the first quest does not
      // fall back to a previously saved simulation preference.
      questsStore.cdpAvailable = true
      questsStore.gameQuestMode = 'cdp'

      // Refresh the connection state and the rest of the post-login data.
      bootstrapAfterLogin(questsStore, 'CDP init after CDP login failed:')

      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      loading.value = false
    }
  }

  function completeAuthProgress(): AuthProgress {
    return {
      phase: 'complete',
      current: null,
      total: null,
      valid_accounts: null,
    }
  }

  // Keep post-login refresh work non-blocking for both authentication paths.
  function bootstrapAfterLogin(questsStore: ReturnType<typeof useQuestsStore>, cdpWarning: string) {
    questsStore.initCdpMode().catch(err => {
      console.warn(cdpWarning, err)
    })
    questsStore.getDetectableGames().catch(err => {
      console.warn('Background game list fetch failed:', err)
    })
    questsStore.fetchOrbsBalance().catch(err => {
      console.warn('Background Orbs balance fetch failed:', err)
    })
    fetchNitroProgramReward().catch(err => {
      console.warn('Background Nitro program reward fetch failed:', err)
    })
  }

  async function logout() {
    // Invalidate account-scoped requests before awaiting quest shutdown.
    resetProgramRewardState()

    // Stop any in-progress quest before clearing state
    const questsStore = useQuestsStore()
    try {
      await questsStore.stop()
    } catch (e) {
      console.warn('Failed to stop quest during logout:', e)
    }

    user.value = null
    token.value = null
    error.value = null
    detectedAccounts.value = []

    // Reset quests store to clear all cached data from previous account
    questsStore.resetForLogout()
  }

  async function fetchNitroProgramReward(force = false) {
    if (programRewardLoading.value) return
    if (!force && programRewardLoaded.value) return
    // CDP auto-login is authenticated on the backend but exposes no frontend
    // token, so gate on the logged-in user rather than the raw token.
    if (!user.value) return
    const requestToken = token.value
    const requestRevision = ++programRewardRequestRevision
    programRewardLoading.value = true
    programRewardError.value = null
    try {
      const rewards = await getProgramRewards()
      if (requestRevision !== programRewardRequestRevision || token.value !== requestToken) return
      nitroProgramReward.value = rewards.find(reward => {
        const program = reward.reward_program
        // Discord's official ProgramReward enum is NITRO=0, XBOX=1.
        // Keep the string forms for keyed/legacy response normalization.
        return program === 0 || program === '0' || String(program).toUpperCase() === 'NITRO'
      }) ?? null
      programRewardLoaded.value = true
    } catch (e) {
      if (requestRevision !== programRewardRequestRevision || token.value !== requestToken) return
      programRewardError.value = e as string
      console.warn('Failed to fetch Nitro program reward:', e)
    } finally {
      if (requestRevision === programRewardRequestRevision && token.value === requestToken) {
        programRewardLoading.value = false
      }
    }
  }

  // Discord supplies the authoritative absolute timestamp, so no local or
  // UTC calendar arithmetic is needed here.
  const nextOrbsClaim = computed<
    { value: number; unit: 'days' | 'hours' | 'minutes' } | null
  >(() => {
    return getNitroOrbsClaim(nitroProgramReward.value?.next_reward_date, currentTime.value)
  })

  // Localized Nitro membership status label + color class (null for non-members).
  const nitroStatus = computed<{ label: string; class: string } | null>(() => {
    const pt = user.value?.premium_type
    if (!pt || pt === 0) return null
    if (pt === 1) return { label: t('user.nitro_classic'), class: 'text-sky-600 dark:text-sky-400' }
    if (pt === 2) return { label: t('user.nitro'), class: 'text-blue-600 dark:text-blue-400' }
    if (pt === 3) return { label: t('user.nitro_basic'), class: 'text-indigo-600 dark:text-indigo-400' }
    return null
  })

  return {
    user,
    token,
    loading,
    error,
    detectedAccounts,
    savedAccounts,
    savedAccountForUser,
    saveAccount,
    removeSavedAccount,
    switchToSavedAccount,
    nitroProgramReward,
    programRewardLoading,
    programRewardError,
    nextOrbsClaim,
    nitroStatus,
    tryAutoDetect,
    loginWithToken,
    loginViaCdp,
    logout,
    fetchNitroProgramReward
  }
})
