import type { CaptionStatus } from '../lib/liveCaptions'
import { BellRing, Captions, CaptionsOff, Cloud, Dice5, DoorOpen, Eye, EyeOff, Headphones, MessageSquare, MonitorUp, RefreshCw, Send, Shapes, Sparkles, Square, Users } from 'lucide-react'
import type { InterpreterLanguage, InterpreterStatus, OutputDevice } from '../lib/liveInterpreter'
import type { Session } from '../types'

export type CaptionDisplay = 'zh' | 'en' | 'both'
export type CaptionSize = 'sm' | 'md' | 'lg'
export type CaptionStyle = 'dark' | 'light' | 'plain'

const CAPTION_DISPLAY_OPTIONS: Array<{ value: CaptionDisplay; label: string }> = [
  { value: 'zh', label: '中' },
  { value: 'en', label: '英' },
  { value: 'both', label: '中英' },
]

const CAPTION_SIZE_OPTIONS: Array<{ value: CaptionSize; label: string }> = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
]

const CAPTION_STYLE_OPTIONS: Array<{ value: CaptionStyle; label: string }> = [
  { value: 'dark', label: '深色底' },
  { value: 'light', label: '淺色底' },
  { value: 'plain', label: '無底色' },
]

type Props = {
  session: Session
  onlineCount: number
  busy: boolean
  buzzerActive: boolean
  captionsEnabled: boolean
  captionStatus: CaptionStatus
  interpreterEnabled: boolean
  interpreterStatus: InterpreterStatus
  interpreterLanguage: InterpreterLanguage
  onChangeInterpreterLanguage: (language: InterpreterLanguage) => void
  interpreterOutputId: string
  interpreterOutputs: OutputDevice[]
  onChangeInterpreterOutput: (deviceId: string) => void
  onRefreshInterpreterOutputs: () => void
  interpreterText: string
  onToggleInterpreter: () => void
  captionDisplay: CaptionDisplay
  onChangeCaptionDisplay: (display: CaptionDisplay) => void
  captionSize: CaptionSize
  onChangeCaptionSize: (size: CaptionSize) => void
  captionStyle: CaptionStyle
  onChangeCaptionStyle: (style: CaptionStyle) => void
  captionVocabulary: string
  onChangeCaptionVocabulary: (vocabulary: string) => void
  onToggleDanmaku: () => void
  onToggleAnonymous: () => void
  onToggleCaptions: () => void
  onCaptureScreen?: () => void
  onDrawLottery: () => void
  onStartBuzzer: () => void
  onOpenTextDispatch: () => void
  onOpenWordCloud: () => void
  onStopQuestion: () => void
  onGenerateExitTicket: () => void
  onEndClass: () => void
}

export function PresenterControlPanel({
  session,
  onlineCount,
  busy,
  buzzerActive,
  captionsEnabled,
  captionStatus,
  interpreterEnabled,
  interpreterStatus,
  interpreterLanguage,
  onChangeInterpreterLanguage,
  interpreterOutputId,
  interpreterOutputs,
  onChangeInterpreterOutput,
  onRefreshInterpreterOutputs,
  interpreterText,
  onToggleInterpreter,
  captionDisplay,
  onChangeCaptionDisplay,
  captionSize,
  onChangeCaptionSize,
  captionStyle,
  onChangeCaptionStyle,
  captionVocabulary,
  onChangeCaptionVocabulary,
  onToggleDanmaku,
  onToggleAnonymous,
  onToggleCaptions,
  onCaptureScreen,
  onDrawLottery,
  onStartBuzzer,
  onOpenTextDispatch,
  onOpenWordCloud,
  onStopQuestion,
  onGenerateExitTicket,
  onEndClass,
}: Props) {
  return (
    <section className="panel control-panel">
      <div className="metric-row">
        <div className="metric">
          <span className="metric-icon"><Users size={18} /></span>
          <span>{onlineCount} 人在線</span>
        </div>
        <div className="metric-actions">
          <button
            aria-label="開始搶答"
            className={`ghost-button metric-action energy-action buzzer-menu-button${buzzerActive ? ' active' : ''}`}
            disabled={busy || !onlineCount}
            title={onlineCount ? (buzzerActive ? '重新開始搶答' : '開始搶答') : '目前沒有在線學員'}
            type="button"
            onClick={onStartBuzzer}
          >
            <BellRing size={19} />
          </button>
          <button
            aria-label="抽籤"
            className="ghost-button metric-action energy-action"
            disabled={busy || !onlineCount}
            title={onlineCount ? '從在線學員中抽籤' : '目前沒有在線學員'}
            type="button"
            onClick={onDrawLottery}
          >
            <Dice5 size={19} />
          </button>
        </div>
      </div>

      <div className="control-section">
        <p className="control-section-label"><Eye size={15} />課堂設定</p>
        <div className="control-toggle-row">
          <button
            aria-pressed={session.danmaku_enabled}
            className={`control-toggle${session.danmaku_enabled ? ' is-active' : ''}`}
            type="button"
            onClick={onToggleDanmaku}
            disabled={busy}
          >
            {session.danmaku_enabled ? <Eye size={16} /> : <EyeOff size={16} />}
            <span>彈幕</span>
            <b>{session.danmaku_enabled ? '開啟' : '關閉'}</b>
          </button>
          <button
            aria-pressed={session.anonymous_enabled}
            className={`control-toggle${session.anonymous_enabled ? ' is-active' : ''}`}
            type="button"
            onClick={onToggleAnonymous}
            disabled={busy}
          >
            <MessageSquare size={16} />
            <span>匿名</span>
            <b>{session.anonymous_enabled ? '開啟' : '關閉'}</b>
          </button>
          <button
            aria-pressed={captionsEnabled}
            className={`control-toggle${captionsEnabled ? ' is-active' : ''}`}
            title="錄下講者聲音，AI 即時產生中英字幕給學員"
            type="button"
            onClick={onToggleCaptions}
            disabled={busy}
          >
            {captionsEnabled ? <Captions size={16} /> : <CaptionsOff size={16} />}
            <span>字幕</span>
            <b>{captionsEnabled ? '開啟' : '關閉'}</b>
          </button>
          <button
            aria-pressed={interpreterEnabled}
            className={`control-toggle${interpreterEnabled ? ' is-active' : ''}`}
            title="即時口譯：把講者的話同步翻成語音，從選定的輸出裝置（例如 SKAA 發射器）播出"
            type="button"
            onClick={onToggleInterpreter}
            disabled={busy}
          >
            <Headphones size={16} />
            <span>口譯</span>
            <b>{interpreterEnabled ? '開啟' : '關閉'}</b>
          </button>
        </div>
        {(interpreterEnabled || interpreterStatus.state === 'error') && (
          <p className={`caption-status caption-status-${interpreterStatus.state}`} role="status">
            <span className="caption-status-dot" aria-hidden="true" />
            {interpreterStatus.state === 'connecting' && '口譯連線中…'}
            {interpreterStatus.state === 'live' && `口譯直播中 → ${interpreterOutputs.find((d) => d.deviceId === interpreterOutputId)?.label ?? '系統預設輸出'}`}
            {interpreterStatus.state === 'reconnecting' && `口譯重新連線中（第 ${interpreterStatus.attempt} 次）…`}
            {interpreterStatus.state === 'silent' && '沒有收到麥克風聲音 — 請檢查麥克風是否靜音或選錯裝置'}
            {interpreterStatus.state === 'error' && `口譯發生問題：${interpreterStatus.message}`}
            {interpreterStatus.state === 'off' && '口譯已關閉'}
          </p>
        )}
        {interpreterEnabled && (
          <>
            <div className="caption-display-row" role="radiogroup" aria-label="口譯語言">
              <span className="caption-display-label">翻成</span>
              {([['en', '英文'], ['zh', '中文']] as Array<[InterpreterLanguage, string]>).map(([value, label]) => (
                <button
                  key={value}
                  aria-checked={interpreterLanguage === value}
                  className={`caption-display-option${interpreterLanguage === value ? ' is-active' : ''}`}
                  role="radio"
                  type="button"
                  onClick={() => onChangeInterpreterLanguage(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="caption-vocab-row">
              <span className="caption-display-label">輸出到</span>
              <select
                className="caption-vocab-input"
                value={interpreterOutputId}
                onChange={(event) => onChangeInterpreterOutput(event.target.value)}
              >
                <option value="">系統預設輸出</option>
                {interpreterOutputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                ))}
              </select>
              <button aria-label="重新整理輸出裝置" className="ghost-button caption-refresh" title="重新整理輸出裝置" type="button" onClick={onRefreshInterpreterOutputs}>
                <RefreshCw size={14} />
              </button>
            </label>
            <p className="caption-hint">
              把 SKAA 發射器接上電腦後，在「輸出到」選它，再把耳機發給需要的學生。
              不要選教室喇叭：麥克風會把口譯聲音收回去再翻一次。
            </p>
            {interpreterText && <p className="interp-text" aria-live="polite">{interpreterText}</p>}
          </>
        )}
        {(captionsEnabled || captionStatus.state === 'error') && (
          <p className={`caption-status caption-status-${captionStatus.state}`} role="status">
            <span className="caption-status-dot" aria-hidden="true" />
            {captionStatus.state === 'connecting' && '字幕連線中…'}
            {captionStatus.state === 'live' && '字幕直播中'}
            {captionStatus.state === 'reconnecting' && `字幕重新連線中（第 ${captionStatus.attempt} 次）…`}
            {captionStatus.state === 'silent' && '沒有收到麥克風聲音 — 請檢查麥克風是否靜音或選錯裝置'}
            {captionStatus.state === 'error' && `字幕發生問題：${captionStatus.message}`}
            {captionStatus.state === 'off' && '字幕已關閉'}
          </p>
        )}
        {captionsEnabled && (
          <>
            <div className="caption-display-row" role="radiogroup" aria-label="字幕顯示語言">
              <span className="caption-display-label">字幕語言</span>
              {CAPTION_DISPLAY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  aria-checked={captionDisplay === option.value}
                  className={`caption-display-option${captionDisplay === option.value ? ' is-active' : ''}`}
                  role="radio"
                  type="button"
                  onClick={() => onChangeCaptionDisplay(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="caption-display-row" role="radiogroup" aria-label="字幕大小">
              <span className="caption-display-label">字幕大小</span>
              {CAPTION_SIZE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  aria-checked={captionSize === option.value}
                  className={`caption-display-option${captionSize === option.value ? ' is-active' : ''}`}
                  role="radio"
                  type="button"
                  onClick={() => onChangeCaptionSize(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="caption-display-row" role="radiogroup" aria-label="字幕樣式">
              <span className="caption-display-label">字幕樣式</span>
              {CAPTION_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  aria-checked={captionStyle === option.value}
                  className={`caption-display-option${captionStyle === option.value ? ' is-active' : ''}`}
                  role="radio"
                  type="button"
                  onClick={() => onChangeCaptionStyle(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="caption-vocab-row">
              <span className="caption-display-label">課程關鍵詞</span>
              <input
                className="caption-vocab-input"
                maxLength={600}
                placeholder="今日專有名詞，逗號分隔；下次開啟字幕時生效"
                type="text"
                value={captionVocabulary}
                onChange={(event) => onChangeCaptionVocabulary(event.target.value)}
              />
            </label>
          </>
        )}
      </div>

      <div className="control-section">
        <p className="control-section-label"><Shapes size={15} />課堂活動</p>
        <div className="control-action-grid">
          {onCaptureScreen && (
            <button className="control-action share-action" type="button" onClick={onCaptureScreen} disabled={busy}>
              <span className="control-action-icon"><MonitorUp size={18} /></span>
              截圖派題
            </button>
          )}
          <button className="control-action share-action" type="button" onClick={onOpenTextDispatch} disabled={busy}>
            <span className="control-action-icon"><Send size={18} /></span>
            文字派送
          </button>
          <button className="control-action energy-control-action" type="button" onClick={onOpenWordCloud} disabled={busy}>
            <span className="control-action-icon"><Cloud size={18} /></span>
            彈幕文字雲
          </button>
        </div>
      </div>

      <div className="control-section">
        <p className="control-section-label"><Sparkles size={15} />課堂收尾</p>
        <div className="control-footer-actions">
          <button className="stop-question-button" type="button" onClick={onStopQuestion} disabled={busy || !session.current_question_id}>
            <Square size={16} />
            停止作答
          </button>
          <button className="exit-ticket-button" type="button" onClick={onGenerateExitTicket} disabled={busy || Boolean(session.exit_ticket_prompt)}>
            <Sparkles size={17} />
            {session.exit_ticket_prompt ? 'Exit Ticket 已派送' : 'AI 生成 Exit Ticket'}
          </button>
        </div>
      </div>

      <button className="end-class-button" type="button" onClick={onEndClass} disabled={busy}>
        <DoorOpen size={16} />
        下課並產生報告
      </button>
    </section>
  )
}
