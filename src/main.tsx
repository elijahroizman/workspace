import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { getEditor, useWorkspace } from './state/workspace'
import './styles/app.css'

document.documentElement.dataset.theme = useWorkspace.getState().theme

// Development helper: http://localhost:1420/?open=/dev-samples/Handbook.pdf opens files without a dialog.
// Also available in test builds (VITE_TEST_HOOKS=1 npm run build) for automated UI checks.
if (import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS) {
  const paths = new URLSearchParams(location.search).getAll('open')
  if (paths.length) setTimeout(() => void useWorkspace.getState().openPaths(paths), 300)
  Object.assign(window, { __workspace: { useWorkspace, getEditor } })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
