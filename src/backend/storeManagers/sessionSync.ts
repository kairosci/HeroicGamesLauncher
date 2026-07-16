import { session } from 'electron'
import { existsSync, readFileSync } from 'graceful-fs'
import { legendaryUserInfo } from './legendary/constants'
import { gogdlAuthConfig } from './gog/constants'
import { nileUserData } from './nile/constants'
import { tokenPath } from './zoom/constants'
import { logInfo, logError, logWarning, LogPrefix } from 'backend/logger'

export type StoreName = 'epic' | 'gog' | 'amazon' | 'zoom'

interface CookieSpec {
  url: string
  name: string
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'no_restriction' | 'lax' | 'strict'
}

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function readTextSafe(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, 'utf-8').trim()
    return content || null
  } catch {
    return null
  }
}

async function injectCookies(
  partition: string,
  cookies: CookieSpec[]
): Promise<void> {
  const ses = session.fromPartition(`persist:${partition}`)
  for (const cookie of cookies) {
    try {
      await ses.cookies.set(cookie as Electron.CookieDetails)
    } catch (error) {
      logError(
        [`Failed to set cookie "${cookie.name}" on "${partition}":`, error],
        LogPrefix.SessionSync
      )
    }
  }
}

function buildEpicCookies(accessToken: string): CookieSpec[] {
  return [
    {
      url: 'https://www.epicgames.com',
      name: 'EPICGames_EGS',
      value: accessToken,
      domain: '.epicgames.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction'
    }
  ]
}

function buildGOGCookies(accessToken: string): CookieSpec[] {
  return [
    {
      url: 'https://www.gog.com',
      name: 'gog_auth',
      value: accessToken,
      domain: '.gog.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction'
    }
  ]
}

function buildAmazonCookies(accessToken: string): CookieSpec[] {
  return [
    {
      url: 'https://gaming.amazon.com',
      name: 'session-id',
      value: accessToken,
      domain: '.amazon.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction'
    },
    {
      url: 'https://gaming.amazon.com',
      name: 'session-token',
      value: accessToken,
      domain: '.amazon.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction'
    }
  ]
}

function buildZoomCookies(token: string): CookieSpec[] {
  return [
    {
      url: 'https://www.zoom-platform.com',
      name: 'li_token',
      value: token,
      domain: '.zoom-platform.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'no_restriction'
    }
  ]
}

async function syncEpicSession(): Promise<boolean> {
  const data = readJsonSafe(legendaryUserInfo)
  const accessToken = data?.access_token as string | undefined
  if (!accessToken) {
    logWarning('No Epic access token in user.json, skipping', {
      prefix: LogPrefix.SessionSync
    })
    return false
  }

  await injectCookies('epic', buildEpicCookies(accessToken))
  logInfo('Epic session cookies synced', LogPrefix.SessionSync)
  return true
}

async function syncGOGSession(): Promise<boolean> {
  const data = readJsonSafe(gogdlAuthConfig)
  const accessToken = data?.access_token as string | undefined
  if (!accessToken) {
    logWarning('No GOG access token in auth.json, skipping', {
      prefix: LogPrefix.SessionSync
    })
    return false
  }

  await injectCookies('gog', buildGOGCookies(accessToken))
  logInfo('GOG session cookies synced', LogPrefix.SessionSync)
  return true
}

async function syncAmazonSession(): Promise<boolean> {
  const data = readJsonSafe(nileUserData)
  const name = data?.name as string | undefined
  if (!name) {
    logWarning('No Amazon user in current_user.json, skipping', {
      prefix: LogPrefix.SessionSync
    })
    return false
  }

  const nileConfigPath = nileUserData.replace('/current_user.json', '')
  const credentialsFile = `${nileConfigPath}/credentials.json`
  const creds = readJsonSafe(credentialsFile)
  const accessToken = creds?.access_token as string | undefined
  if (!accessToken) {
    logWarning(
      'No Amazon access_token in credentials.json, skipping',
      { prefix: LogPrefix.SessionSync }
    )
    return false
  }

  await injectCookies('amazon', buildAmazonCookies(accessToken))
  logInfo('Amazon session cookies synced', LogPrefix.SessionSync)
  return true
}

async function syncZoomSession(): Promise<boolean> {
  const token = readTextSafe(tokenPath)
  if (!token) {
    logWarning('No Zoom token found, skipping', {
      prefix: LogPrefix.SessionSync
    })
    return false
  }

  await injectCookies('zoom', buildZoomCookies(token))
  logInfo('Zoom session cookies synced', LogPrefix.SessionSync)
  return true
}

const syncMap: Record<StoreName, () => Promise<boolean>> = {
  epic: syncEpicSession,
  gog: syncGOGSession,
  amazon: syncAmazonSession,
  zoom: syncZoomSession
}

export async function syncStoreSession(store: StoreName): Promise<boolean> {
  logInfo(`Syncing session for store: ${store}`, LogPrefix.SessionSync)
  try {
    return await syncMap[store]()
  } catch (error) {
    logError(
      [`Failed to sync session for "${store}":`, error],
      LogPrefix.SessionSync
    )
    return false
  }
}

export async function syncAllStoreSessions(): Promise<
  Record<StoreName, boolean>
> {
  const [epic, gog, amazon, zoom] = await Promise.allSettled([
    syncEpicSession(),
    syncGOGSession(),
    syncAmazonSession(),
    syncZoomSession()
  ])

  return {
    epic: epic.status === 'fulfilled' ? epic.value : false,
    gog: gog.status === 'fulfilled' ? gog.value : false,
    amazon: amazon.status === 'fulfilled' ? amazon.value : false,
    zoom: zoom.status === 'fulfilled' ? zoom.value : false
  }
}

export async function clearStoreSession(store: StoreName): Promise<boolean> {
  try {
    const ses = session.fromPartition(`persist:${store}`)
    await ses.clearStorageData()
    await ses.clearCache()
    await ses.clearAuthCache()
    return true
  } catch (error) {
    logError(
      [`Failed to clear session for "${store}":`, error],
      LogPrefix.SessionSync
    )
    return false
  }
}
