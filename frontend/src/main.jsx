import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
// IBM Plex Sans (Latin) – weights 400, 500, 600
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
// IBM Plex Sans Arabic – weights 400, 500, 600
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
// IBM Plex Mono – weights 400, 500
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
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
