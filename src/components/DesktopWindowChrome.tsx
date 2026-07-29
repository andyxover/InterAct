import { ArrowLeft, GripHorizontal, Minus, X } from 'lucide-react'

interface DesktopWindowChromeProps {
  confirmClose?: boolean
  onBack?: () => void | Promise<void>
}

export function DesktopWindowChrome({ confirmClose = true, onBack }: DesktopWindowChromeProps) {
  if (!window.interactDesktop) return null

  function requestClose() {
    if (onBack) {
      void onBack()
      return
    }
    if (!confirmClose || window.confirm('確定要關閉 InterAct？')) window.interactDesktop?.close()
  }

  return (
    <header className="desktop-window-chrome">
      <div className="desktop-drag-handle" title="拖曳視窗">
        <GripHorizontal size={16} />
        <span>InterAct</span>
      </div>
      <div className="desktop-window-actions">
        {onBack && (
          <button aria-label="返回場次管理" title="返回場次管理" type="button" onClick={() => void onBack()}>
            <ArrowLeft size={16} />
          </button>
        )}
        <button aria-label="最小化" title="最小化" type="button" onClick={() => window.interactDesktop?.minimize()}>
          <Minus size={16} />
        </button>
        <button aria-label={onBack ? '關閉報告' : '關閉'} title={onBack ? '關閉報告' : '關閉'} type="button" onClick={requestClose}>
          <X size={16} />
        </button>
      </div>
    </header>
  )
}
