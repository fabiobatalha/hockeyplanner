import { restoreActionMessage, showActionMessage } from './action-message.js'
import { request } from './http.js'
import { appUrl } from './urls.js'

// Email links sent before the route migration remain valid until their token expires.
const mailedLink = /^#((?:confirm-email|reset-password)\/[A-Za-z0-9_-]{43})$/.exec(location.hash)
if (mailedLink) location.replace(appUrl(mailedLink[1]))

addEventListener('pageshow', event => {
  if (event.persisted) location.reload()
})

const signOut = document.getElementById('sign-out')
signOut?.addEventListener('click', async () => {
  signOut.disabled = true
  try {
    await request('logout', 'POST')
    location.replace(appUrl('login'))
  } catch {
    signOut.disabled = false
    showActionMessage('Could not sign out. Try again.')
  }
})
restoreActionMessage()
