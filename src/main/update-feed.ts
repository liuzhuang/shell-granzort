import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type PackagedMetadata = {
  shellManageUpdateYmlUrl?: string
}

function normalizeBaseUrl(value: string): string | null {
  const trimmed = (value || '').trim()
  if (!trimmed) return null
  return trimmed.replace(/\/$/, '')
}

function parseFeedBaseUrlFromYmlUrl(value: string): string | null {
  const raw = (value || '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!url.pathname.endsWith('.yml')) return null
    url.pathname = url.pathname.replace(/\/[^/]+\.yml$/, '') || '/'
    url.search = ''
    url.hash = ''
    return normalizeBaseUrl(url.toString())
  } catch {
    return null
  }
}

function readPackagedUpdateBaseUrl(): string | null {
  if (!app.isPackaged) return null
  try {
    const pkgPath = join(app.getAppPath(), 'package.json')
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackagedMetadata
    return parseFeedBaseUrlFromYmlUrl(parsed.shellManageUpdateYmlUrl || '')
  } catch {
    return null
  }
}

export function resolveAutoUpdateFeedBaseUrl(): string | null {
  const fromYmlEnv = parseFeedBaseUrlFromYmlUrl(process.env.SHELL_MANAGE_UPDATE_YML_URL || '')
  if (fromYmlEnv) return fromYmlEnv
  return readPackagedUpdateBaseUrl()
}
