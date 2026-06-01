import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SshKeyConfig } from '../shared/types'
import { getSshKeyFilePath } from './ssh-key-store'

export function resolveSshKeyPath(keyId: string | undefined, sshKeys: SshKeyConfig[] | undefined): string | undefined {
  if (!keyId?.trim()) return undefined
  const id = keyId.trim()
  const known = sshKeys?.some((item) => item.id === id)
  if (!known) return undefined
  const path = getSshKeyFilePath(id)
  return existsSync(path) ? path : undefined
}

export function injectSshIdentity(command: string, keyPath: string): string {
  const trimmed = command.trim()
  if (!/^\s*ssh(\s|$)/i.test(trimmed)) return command

  const withoutIdentity = trimmed
    .replace(/(?:^|\s)-i\s+(?:"[^"]+"|'[^']+'|\S+)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  return withoutIdentity.replace(/^(\s*ssh)\b/i, `$1 -i "${keyPath}"`)
}

export function resolveCommandWithSshKey(
  command: string,
  sshKeyId: string | undefined,
  sshKeys: SshKeyConfig[] | undefined
): string {
  const keyPath = resolveSshKeyPath(sshKeyId, sshKeys)
  if (!keyPath) return command

  return command
    .split('|||')
    .map((segment) => injectSshIdentity(segment.trim(), keyPath))
    .join(' ||| ')
}

export function resolveCommandConfigCommand(
  command: string,
  sshKeyId: string | undefined,
  sshKeys: SshKeyConfig[] | undefined
): string {
  return resolveCommandWithSshKey(command, sshKeyId, sshKeys)
}
