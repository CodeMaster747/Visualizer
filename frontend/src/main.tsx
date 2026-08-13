import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

// Self-hosted: the production image is served by Caddy behind a CSP-friendly
// single origin, and a font that only arrives if fonts.googleapis.com is
// reachable is a font that sometimes does not arrive.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'

import './index.css'
import App from './App.tsx'
import { hydrate } from './store/account.ts'

// Resolve who is signed in before the first render, not after.
//
// The route guard reads the account synchronously, so rendering first would
// bounce an already-signed-in user to /login for one frame before yanking them
// back. This is a sessionStorage read and a base64 decode -- no network, no
// promise, nothing that can fail in a way that leaves a blank page.
hydrate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
