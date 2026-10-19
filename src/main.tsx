import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// No StrictMode on purpose: its double render in development would make the observed render log confusing.
createRoot(document.getElementById('root')!).render(<App />)
