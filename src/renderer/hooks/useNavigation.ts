import { useState } from 'react'

export type AppPage =
  | 'home'
  | 'log'
  | 'multiLog'
  | 'query'
  | 'editor'
  | 'ssh-keys'
  | 'collaboration'
  | 'terminal'
  | 'dashboard'
  | 'monitoring'
  | 'analytics'

export function useNavigation() {
  const [page, setPage] = useState<AppPage>('home')
  const [selectedCommand, setSelectedCommand] = useState('')

  return {
    page,
    setPage,
    selectedCommand,
    setSelectedCommand
  }
}
