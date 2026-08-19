import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DesktopWindowChrome } from './components/DesktopWindowChrome'
import { ErrorBoundary } from './ErrorBoundary'
import { HomePage } from './routes/HomePage'
import { JoinPage } from './routes/JoinPage'
import { ParticipantPage } from './routes/ParticipantPage'
import { PresenterNewPage } from './routes/PresenterNewPage'
import { useSessionReportBack } from './lib/sessionReportNavigation'

// These are only ever reached from inside the desktop app (never a cold
// first paint for the web participant deployment or the app's own initial
// /presenter/new screen), so they're code-split out of the eager entry chunk
// instead of loading upfront on every startup.
const DesktopOverlayPage = lazy(() => import('./routes/DesktopOverlayPage').then((m) => ({ default: m.DesktopOverlayPage })))
const CustomQuizReviewPage = lazy(() => import('./routes/CustomQuizReviewPage').then((m) => ({ default: m.CustomQuizReviewPage })))
const PresenterPage = lazy(() => import('./routes/PresenterPage').then((m) => ({ default: m.PresenterPage })))
const SessionReportPage = lazy(() => import('./routes/SessionReportPage').then((m) => ({ default: m.SessionReportPage })))
const WordCloudPage = lazy(() => import('./routes/WordCloudPage').then((m) => ({ default: m.WordCloudPage })))

function AppRoutes() {
  const location = useLocation()
  const returnFromSessionReport = useSessionReportBack()
  const isDesktop = Boolean(window.interactDesktop)
  const isDesktopOverlay = location.pathname.startsWith('/desktop-overlay/')
  const isCustomQuizReview = location.pathname.startsWith('/custom-quiz-review/')
  const isDesktopPresenter = isDesktop && location.pathname.startsWith('/presenter/') && location.pathname !== '/presenter/new'
  const isSessionReport = location.pathname.startsWith('/session-report/')
  const isWordCloud = location.pathname.startsWith('/word-cloud/')

  useEffect(() => {
    // Warm PresenterPage's chunk while the instructor is filling in the "new
    // session" form, so clicking 建立場次 doesn't hit a cold fetch for it.
    if (isDesktop && location.pathname === '/presenter/new') void import('./routes/PresenterPage')
  }, [isDesktop, location.pathname])

  return (
    <div className={isDesktop ? 'desktop-shell' : undefined}>
      {!isDesktopOverlay && !isDesktopPresenter && !isCustomQuizReview && (
        <DesktopWindowChrome
          confirmClose={!isWordCloud}
          onBack={isSessionReport ? returnFromSessionReport : undefined}
        />
      )}
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/presenter/new" element={isDesktop ? <PresenterNewPage /> : <Navigate to="/" replace />} />
          <Route path="/presenter/:sessionId" element={isDesktop ? <PresenterPage /> : <Navigate to="/" replace />} />
          <Route path="/desktop-overlay/:sessionId" element={isDesktop ? <DesktopOverlayPage /> : <Navigate to="/" replace />} />
          <Route path="/custom-quiz-review/:sessionId/:questionId" element={isDesktop ? <CustomQuizReviewPage /> : <Navigate to="/" replace />} />
          <Route path="/session-report/:sessionId" element={isDesktop ? <SessionReportPage /> : <Navigate to="/" replace />} />
          <Route path="/word-cloud/:sessionId" element={isDesktop ? <WordCloudPage /> : <Navigate to="/" replace />} />
          <Route path="/join/:sessionId" element={<JoinPage />} />
          <Route path="/participant/:sessionId" element={<ParticipantPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </div>
  )
}

export function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </HashRouter>
  )
}

export default App
