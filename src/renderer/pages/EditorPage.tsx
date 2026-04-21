import { useState } from 'react'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from '../components/Panel'
import { YamlEditor } from '../components/YamlEditor'
import { VisualConfigEditor } from '../components/VisualConfigEditor'

export function EditorPage(props: {
  editorRaw: string
  editorError: string
  setEditorRaw: (text: string) => void
  saveEditor: () => Promise<{ ok: boolean; error?: string }>
  reloadEditor: () => Promise<void>
  locateLine?: number
  onLocated?: () => void
}) {
  const { editorRaw, editorError, setEditorRaw, saveEditor, reloadEditor, locateLine, onLocated } = props
  const [isVisualMode, setIsVisualMode] = useState(true)

  return (
    <div data-testid="editor-page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Panel style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 8,
            flexShrink: 0,
            alignItems: 'center',
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: 'var(--panel)',
            borderBottom: '1px solid var(--border-subtle)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>编辑配置文件</div>
            <button 
              data-testid="editor-mode-toggle"
              style={{ ...buttonStyle('muted'), padding: '4px 10px', fontSize: 10 }} 
              onClick={() => setIsVisualMode(!isVisualMode)}
            >
              {isVisualMode ? '切换到源码编辑' : '切换到可视化编辑'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button data-testid="editor-save" style={buttonStyle('primary')} onClick={saveEditor}>
              保存配置 (⌘S)
            </button>
            <button data-testid="editor-reload" style={buttonStyle('muted')} onClick={reloadEditor}>
              重载配置文件
            </button>
          </div>
        </div>
        
        {isVisualMode ? (
          <VisualConfigEditor value={editorRaw} onChange={setEditorRaw} />
        ) : (
          <YamlEditor value={editorRaw} onChange={setEditorRaw} onSaveShortcut={() => void saveEditor()} locateLine={locateLine} onLocated={onLocated} />
        )}

        <div data-testid="editor-status" style={{ marginTop: 8, color: editorError ? 'var(--err)' : 'var(--muted)', fontSize: 12, flexShrink: 0 }}>
          {editorError ? `保存失败：${editorError}` : '配置状态：有效'}
        </div>
      </Panel>
    </div>
  )
}
