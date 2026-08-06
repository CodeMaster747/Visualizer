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
// Two reasons it has to be in this order. A redirect back from Entra carries an
// authorization code in the URL that MSAL must consume before the router
// rewrites the location, and the route guard reads the account synchronously --
// so rendering first would bounce an already-signed-in user to /login for one
// frame before yanking them back. Without a tenant configured this resolves
// immediately and changes nothing.
//
// It never rejects: a broken identity provider leaves the user signed out,
// which the guard handles, rather than leaving a blank page.
hydrate().then(({ returnTo }) => {
  // A deep link that survived the trip through the sign-in screen. Replaced,
  // not pushed, so Back does not lead into the middle of an auth redirect.
  if (returnTo && returnTo !== window.location.pathname) {
    window.history.replaceState(null, '', returnTo)
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
