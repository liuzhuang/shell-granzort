import { useEffect, useMemo, useState } from 'react'
import yaml from 'js-yaml'
import type { AppConfig } from '../../shared/types'

const EMPTY_CONFIG: AppConfig = {
  commands: [],
  presets: [],
  settings: {
    llm: { provider: 'openai', endpoint: '', apiKey: '', model: '' },
    themePreset: 'system',
    logBufferLines: 5000
  }
}

export function useConfigState() {
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG)
  const [editorRaw, setEditorRaw] = useState('')
  const [editorError, setEditorError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState('全部')

  useEffect(() => {
    window.api.configRead().then((raw) => {
      setEditorRaw(raw)
      try {
        setConfig(yaml.load(raw) as AppConfig)
      } catch {
        // ignored, wait for config:loaded event
      }
    })
    window.api.onConfigLoaded((payload) => setConfig(payload))
  }, [])

  const tags = useMemo(() => {
    const set = new Set<string>()
    config.commands.forEach((cmd) => cmd.tags.forEach((tag) => set.add(tag)))
    return ['全部', ...Array.from(set)]
  }, [config.commands])

  const filteredCommands = useMemo(() => {
    return config.commands.filter((cmd) => {
      const tagMatched = activeTag === '全部' || cmd.tags.includes(activeTag)
      const keywordMatched = !keyword || cmd.name.includes(keyword) || cmd.command.includes(keyword)
      return tagMatched && keywordMatched
    })
  }, [activeTag, keyword, config.commands])

  async function saveEditor() {
    const validate = await window.api.configValidate(editorRaw)
    if (!validate.valid) {
      setEditorError(validate.error || '语法错误')
      return { ok: false, error: validate.error || '语法错误' }
    }
    await window.api.configSave(editorRaw)
    setEditorError('')
    return { ok: true }
  }

  return {
    config,
    editorRaw,
    setEditorRaw,
    editorError,
    setEditorError,
    saveEditor,
    keyword,
    setKeyword,
    activeTag,
    setActiveTag,
    tags,
    filteredCommands
  }
}
