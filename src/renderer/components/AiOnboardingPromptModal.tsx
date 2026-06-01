import { useEffect, useState } from 'react'
import { AI_ONBOARDING_STEPS, buildAiOnboardingPrompt } from '../lib/ai-onboarding-prompt'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from './Panel'

export function AiOnboardingPromptModal(props: {
  existingCommandNames: string[]
  onClose: () => void
  onCopyError: (message: string) => void
}) {
  const { existingCommandNames, onClose, onCopyError } = props
  const [configPath, setConfigPath] = useState<string>('')
  const [loadingPath, setLoadingPath] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingPath(true)
    void window.api
      .configGetPath()
      .then((path) => {
        if (!cancelled) setConfigPath(path)
      })
      .catch((error) => {
        if (!cancelled) onCopyError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoadingPath(false)
      })
    return () => {
      cancelled = true
    }
  }, [onCopyError])

  const prompt =
    configPath.length > 0
      ? buildAiOnboardingPrompt({ configPath, existingCommandNames })
      : ''

  const handleCopy = async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      onCopyError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div
      data-testid="ai-prompt-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.52)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20
      }}
      onClick={onClose}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <Panel style={{ width: 'min(760px, 96vw)', maxHeight: '86vh', overflow: 'auto', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>AI 添加命令</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>复制提示词，AI 会自动写入 ShellManage 配置</div>
            </div>
            <button data-testid="ai-prompt-close" style={buttonStyle('muted')} onClick={onClose}>
              关闭
            </button>
          </div>

          <ol style={{ margin: '0 0 12px 18px', padding: 0, display: 'grid', gap: 6 }}>
            {AI_ONBOARDING_STEPS.map((step, index) => (
              <li key={step} style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                <span style={{ color: 'var(--text)', fontWeight: 600, marginRight: 6 }}>{index + 1}.</span>
                {step}
              </li>
            ))}
          </ol>

          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
            配置文件路径：
            <code
              data-testid="ai-prompt-config-path"
              style={{ marginLeft: 6, fontSize: 12, color: 'var(--text)' }}
            >
              {loadingPath ? '加载中…' : configPath || '未知'}
            </code>
          </div>

          <pre
            data-testid="ai-prompt-preview"
            style={{
              margin: '0 0 12px',
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'color-mix(in srgb, var(--panel-soft) 70%, transparent)',
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 'min(360px, 42vh)',
              overflow: 'auto',
              color: 'var(--text-dim)'
            }}
          >
            {loadingPath ? '正在加载提示词…' : prompt || '无法生成提示词，请稍后重试。'}
          </pre>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button data-testid="ai-prompt-copy" style={buttonStyle('primary')} disabled={!prompt || loadingPath} onClick={() => void handleCopy()}>
              {copied ? '已复制' : '复制提示词'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
