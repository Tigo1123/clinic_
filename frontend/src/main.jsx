import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/ui/ui.css'
import './i18n.js'
import AppRouter from './app/router/AppRouter.jsx'
import AppErrorBoundary from './components/feedback/AppErrorBoundary.jsx'
import { loadClinicTimeZone } from './utils/clinicTime.js'

loadClinicTimeZone().finally(() => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary><AppRouter /></AppErrorBoundary>
  </StrictMode>,
))
