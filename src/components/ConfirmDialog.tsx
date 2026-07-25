import { AlertTriangle, LoaderCircle, X } from 'lucide-react'

type Props = {
  busy?: boolean
  confirmLabel: string
  description: string
  open: boolean
  title: string
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({ busy = false, confirmLabel, description, open, title, onCancel, onConfirm }: Props) {
  if (!open) return null

  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation">
      <section aria-labelledby="confirm-dialog-title" aria-modal="true" className="modal confirm-dialog" role="dialog">
        <div className="confirm-dialog-heading">
          <span><AlertTriangle size={22} /></span>
          <div>
            <h2 id="confirm-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button aria-label="取消" className="icon-button ghost-button" disabled={busy} type="button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="confirm-dialog-actions">
          <button className="ghost-button" disabled={busy} type="button" onClick={onCancel}>取消</button>
          <button className="danger-button" disabled={busy} type="button" onClick={onConfirm}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <AlertTriangle size={18} />}
            {busy ? '處理中...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
