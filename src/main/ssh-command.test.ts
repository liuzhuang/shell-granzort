import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { injectSshIdentity, resolveCommandWithSshKey } from './ssh-command'
import type { SshKeyConfig } from '../shared/types'

test('injectSshIdentity adds -i for ssh commands', () => {
  const result = injectSshIdentity('ssh root@1.2.3.4', '/tmp/prod.pem')
  assert.equal(result, 'ssh -i "/tmp/prod.pem" root@1.2.3.4')
})

test('injectSshIdentity replaces existing -i path', () => {
  const result = injectSshIdentity('ssh -i /Users/alice/old.pem root@1.2.3.4', '/tmp/prod.pem')
  assert.equal(result, 'ssh -i "/tmp/prod.pem" root@1.2.3.4')
})

test('resolveCommandWithSshKey resolves configured key file', () => {
  const home = join(tmpdir(), `shell-manage-ssh-test-${Date.now()}`)
  process.env.SHELL_MANAGE_HOME = home
  const keysDir = join(home, '.shell-manage', 'keys')
  mkdirSync(keysDir, { recursive: true })
  writeFileSync(join(keysDir, 'prod.pem'), '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n')

  const keys: SshKeyConfig[] = [{ id: 'prod', label: '生产' }]
  const result = resolveCommandWithSshKey('ssh root@1.2.3.4', 'prod', keys)
  assert.match(result, /^ssh -i "/)
  assert.match(result, /prod\.pem" root@1\.2\.3\.4$/)

  delete process.env.SHELL_MANAGE_HOME
})

test('resolveCommandWithSshKey leaves non-ssh commands unchanged', () => {
  assert.equal(resolveCommandWithSshKey('npm run dev', 'prod', [{ id: 'prod', label: '生产' }]), 'npm run dev')
})
