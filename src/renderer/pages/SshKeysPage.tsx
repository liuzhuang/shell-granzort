import { useState } from 'react'
import type { SshKeyConfig } from '../../shared/types'
import { Panel } from '../components/Panel'
import { buttonStyle, inputStyle } from '../lib/uiStyles'

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--muted)',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.02em'
}

export function SshKeysPage(props: {
  sshKeys: SshKeyConfig[]
  onConfigChanged: () => Promise<void>
}) {
  const { sshKeys, onConfigChanged } = props
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyContent, setNewKeyContent] = useState('')
  const [keyImportError, setKeyImportError] = useState<string | null>(null)
  const [keyImporting, setKeyImporting] = useState(false)

  const handleImportSshKey = async () => {
    setKeyImportError(null)
    setKeyImporting(true)
    try {
      await window.api.sshKeyImport({
        label: newKeyLabel.trim(),
        content: newKeyContent
      })
      setNewKeyLabel('')
      setNewKeyContent('')
      await onConfigChanged()
    } catch (error) {
      setKeyImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setKeyImporting(false)
    }
  }

  const handleDeleteSshKey = async (id: string) => {
    setKeyImportError(null)
    try {
      await window.api.sshKeyDelete(id)
      await onConfigChanged()
    } catch (error) {
      setKeyImportError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div data-testid="ssh-keys-page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Panel style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)', overflow: 'auto' }}>
        <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 16, flexShrink: 0 }}>SSH 密钥</div>

        <section>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            粘贴私钥文本保存到本机，配置文件只存密钥 ID，便于团队共享命令而无需统一密钥路径。
          </p>

          <div
            style={{
              padding: 16,
              borderRadius: 'var(--radius-md)',
              background: 'var(--panel-soft)',
              border: '1px solid var(--border-default)',
              marginBottom: 16
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>密钥名称</label>
              <input
                style={inputStyle}
                placeholder="例如：生产环境 root"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                data-testid="ssh-key-label-input"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>私钥内容（粘贴 PEM 文本）</label>
              <textarea
                style={{
                  ...inputStyle,
                  minHeight: 140,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  resize: 'vertical'
                }}
                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                value={newKeyContent}
                onChange={(e) => setNewKeyContent(e.target.value)}
                data-testid="ssh-key-content-input"
              />
            </div>
            {keyImportError && (
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--err)' }}>{keyImportError}</p>
            )}
            <button
              type="button"
              style={{ ...buttonStyle('primary'), opacity: keyImporting ? 0.7 : 1 }}
              disabled={keyImporting || !newKeyLabel.trim() || !newKeyContent.trim()}
              onClick={() => void handleImportSshKey()}
              data-testid="ssh-key-import-button"
            >
              {keyImporting ? '保存中…' : '保存密钥到本机'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sshKeys.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 24 }}>尚未导入任何 SSH 密钥</p>
            ) : (
              sshKeys.map((key) => (
                <div
                  key={key.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--panel-soft)',
                    border: '1px solid var(--border-default)'
                  }}
                  data-testid={`ssh-key-row-${key.id}`}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{key.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      ID: <code>{key.id}</code>
                      {key.createdAt ? ` · ${new Date(key.createdAt).toLocaleString()}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{ ...buttonStyle('danger'), padding: '4px 10px', flexShrink: 0 }}
                    onClick={() => void handleDeleteSshKey(key.id)}
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </Panel>
    </div>
  )
}
