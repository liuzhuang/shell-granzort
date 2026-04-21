import type { DetectedProject } from '../../shared/types'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from './Panel'

export function ImportProjectsModal(props: {
  rootPath: string
  projects: DetectedProject[]
  selectedKeys: Record<string, boolean>
  onToggle: (key: string) => void
  onClose: () => void
  onConfirm: () => void
  confirming: boolean
}) {
  const { rootPath, projects, selectedKeys, onToggle, onClose, onConfirm, confirming } = props
  const selectedCount = projects.filter((project) => selectedKeys[projectKey(project)] !== false).length

  return (
    <div
      data-testid="import-projects-modal"
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
      <Panel style={{ width: 'min(980px, 96vw)', maxHeight: '86vh', overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>导入目录识别结果</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>根目录：{rootPath}</div>
          </div>
          <button data-testid="import-projects-close" style={buttonStyle('muted')} onClick={onClose}>
            取消
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
          共识别 {projects.length} 项，已勾选 {selectedCount} 项
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {projects.map((project) => {
            const key = projectKey(project)
            const checked = selectedKeys[key] !== false
            return (
              <div
                data-testid={`import-project-row-${key}`}
                key={key}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 14,
                  padding: 10,
                  background: checked ? 'var(--panel-soft)' : 'var(--panel)'
                }}
              >
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <input
                    data-testid={`import-project-checkbox-${key}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(key)}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                      <strong>{project.name}</strong>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{project.type}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>置信度 {Math.round(project.confidence * 100)}%</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>{project.rootPath}</div>
                    <code
                      style={{
                        display: 'block',
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        background: 'var(--bg)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        padding: '6px 8px',
                        marginBottom: 6
                      }}
                    >
                      {project.command}
                    </code>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>依据：{project.evidence.join('；')}</div>
                  </div>
                </label>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button data-testid="import-projects-cancel" style={buttonStyle('muted')} onClick={onClose}>
            取消
          </button>
          <button data-testid="import-projects-confirm" style={buttonStyle('primary')} onClick={onConfirm} disabled={confirming}>
            {confirming ? '导入中...' : '确认导入'}
          </button>
        </div>
      </Panel>
      </div>
    </div>
  )
}

export function projectKey(project: Pick<DetectedProject, 'type' | 'name' | 'rootPath'>): string {
  return `${project.type}-${project.name}-${project.rootPath}`.replace(/[^\w.-]+/g, '_')
}
