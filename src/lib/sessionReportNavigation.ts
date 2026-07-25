import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export function useSessionReportBack() {
  const navigate = useNavigate()

  return useCallback(async () => {
    const handledByDesktop = await window.interactDesktop?.returnFromSessionReport()
    if (handledByDesktop) return

    navigate('/presenter/new', {
      replace: true,
      state: { openSessionManager: true },
    })
  }, [navigate])
}
