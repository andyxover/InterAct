import { GripHorizontal, Minus, X } from 'lucide-react'

export function DesktopWindowChrome() {
  if (!window.interactDesktop) return null

  function requestClose() {
    if (window.confirm('確定要關閉 InterAct？')) window.interactDesktop?.close()
  }

  return (
    <header className="desktop-window-chrome">
      <div className="desktop-drag-handle" title="拖曳視窗">
        <GripHorizontal size={16} />
        <span>InterAct</span>
      </div>
      <div className="desktop-window-actions">
        <button aria-label="最小化" title="最小化" type="button" onClick={() => window.interactDesktop?.minimize()}>
          <Minus size={16} />
        </button>
        <button aria-label="關閉" title="關閉" type="button" onClick={requestClose}>
          <X size={16} />
        </button>
      </div>
    </header>
  )
}
