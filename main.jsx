import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import i18n from './src/i18n'
import { LanguageProvider } from './src/i18n/LanguageProvider'
import './index.css'
import App from './App.jsx'

// Silences benign AbortError warnings caused by request cancellation
// (React Query / fetch AbortController). Real errors still log normally.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (reason && (reason.name === 'AbortError' || reason.code === 20)) {
    event.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </I18nextProvider>
  </React.StrictMode>
)
