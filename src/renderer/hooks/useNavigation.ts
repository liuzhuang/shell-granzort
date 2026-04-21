import { useState } from 'react'

export type AppPage = 'home' | 'log' | 'query' | 'editor' | 'terminal' | 'dashboard' | 'monitoring'

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
