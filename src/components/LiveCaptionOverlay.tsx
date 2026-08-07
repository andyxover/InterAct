type Props = {
  fontBold?: boolean
  fontSize?: number
  text: string
  status?: 'idle' | 'starting' | 'live' | 'error'
}

export function LiveCaptionOverlay({ fontBold = true, fontSize = 48, text, status = 'live' }: Props) {
  if (!text && status !== 'starting') return null
  return (
    <div className="live-caption-overlay" aria-live="polite">
      <p style={{ fontSize: `${fontSize}px`, fontWeight: fontBold ? 800 : 400 }}>{text || '正在連接麥克風...'}</p>
    </div>
  )
}
