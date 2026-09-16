import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'

let permissionChecked = false

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return true
  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      granted = (await requestPermission()) === 'granted'
    }
    permissionChecked = true
    return granted
  } catch {
    return false
  }
}

export async function notify(title: string, body?: string): Promise<void> {
  if (!(await ensurePermission())) return
  try {
    sendNotification({ title, body })
  } catch {
    // Notifications are best-effort; never break the caller.
  }
}