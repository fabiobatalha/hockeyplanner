import { addPasswordVisibility, checkNewPassword, passwordRequirements } from './password-policy.js'

const get = id => document.getElementById(id)
const form = get('auth-form')
const username = get('username')
const password = get('password')
const hideAuthPassword = addPasswordVisibility(password)
const registrationEmail = get('registration-email')
const submit = get('auth-submit')
const modeButton = get('auth-switch')
const feedback = get('auth-status')
let registering = false

async function accountRequest(path, method = 'GET', body) {
  const options = { method, cache: 'no-store' }
  if (body) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  const response = await fetch('./api/' + path, options)
  if (response.status === 204) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'The account request failed.')
  return data
}

modeButton.addEventListener('click', () => {
  registering = !registering
  hideAuthPassword()
  get('auth-heading').textContent = registering ? 'Create an account' : 'Sign in'
  submit.textContent = registering ? 'Create account' : 'Sign in'
  modeButton.textContent = registering ? 'Back to sign in' : 'Create an account'
  get('username-label').textContent = registering ? 'Username' : 'Username or email'
  username.maxLength = registering ? 32 : 320
  get('registration-email-label').hidden = registrationEmail.hidden = !registering
  registrationEmail.required = registering
  registrationEmail.disabled = !registering
  password.autocomplete = registering ? 'new-password' : 'current-password'
  password.setCustomValidity('')
  if (registering) password.setAttribute('aria-describedby', 'registration-help')
  else password.removeAttribute('aria-describedby')
  get('registration-help').hidden = !registering
  feedback.textContent = ''
  username.focus()
})

password.addEventListener('input', () => password.setCustomValidity(''))

form.addEventListener('submit', async event => {
  event.preventDefault()
  if (submit.disabled || (registering && !checkNewPassword(password))) return
  submit.disabled = modeButton.disabled = true
  feedback.textContent = ''
  try {
    const identifier = username.value.trim()
    const details = registering
      ? { username: identifier, email: registrationEmail.value.trim(), password: password.value }
      : { identifier, password: password.value }
    await accountRequest(registering ? 'register' : 'login', 'POST', details)
    location.reload()
  } catch (error) {
    feedback.textContent = error.message
    submit.disabled = modeButton.disabled = false
  }
})

addEventListener('pageshow', event => {
  if (event.persisted) location.reload()
})

function setupPasswordChange(dialog) {
  const form = get('change-password-form')
  const current = get('change-current-password')
  const next = get('change-new-password')
  const status = get('change-password-status')
  const save = form.querySelector('button[type=submit]')
  const hideCurrent = addPasswordVisibility(current, 'current password')
  const hideNew = addPasswordVisibility(next, 'new password')
  function resetPasswords() {
    form.reset()
    next.setCustomValidity('')
    hideCurrent()
    hideNew()
  }
  get('profile-password-section').hidden = false
  get('change-password-help').textContent = passwordRequirements
  next.addEventListener('input', () => next.setCustomValidity(''))
  dialog.addEventListener('close', () => {
    resetPasswords()
    status.textContent = ''
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (save.disabled || !checkNewPassword(next)) return
    save.disabled = true
    status.textContent = ''
    try {
      await accountRequest('account/password', 'PUT', {
        current_password: current.value, new_password: next.value,
      })
      resetPasswords()
      status.textContent = 'Password changed. Other sessions have been signed out.'
    } catch (error) {
      status.textContent = error.message
    } finally {
      save.disabled = false
    }
  })
}

function setupProfile(user) {
  const dialog = get('account-profile')
  const profileForm = get('profile-email-form')
  const email = get('profile-email')
  const currentPassword = get('profile-password')
  const status = get('profile-status')
  const save = profileForm.querySelector('button')
  let address = user.email
  const needsEmail = !address
  if (!needsEmail) setupPasswordChange(dialog)
  const profileSignOut = get('profile-sign-out')
  get('profile-close').hidden = needsEmail
  profileSignOut.hidden = !needsEmail
  get('profile-email-required').hidden = !needsEmail
  profileSignOut.addEventListener('click', () => signOut(profileSignOut, status))
  dialog.addEventListener('cancel', event => {
    if (needsEmail) event.preventDefault()
  })
  function openProfile() {
    email.value = address ?? ''
    currentPassword.value = ''
    status.textContent = ''
    dialog.showModal()
  }
  get('account-name').addEventListener('click', openProfile)
  if (needsEmail) openProfile()
  dialog.addEventListener('close', () => { currentPassword.value = '' })
  profileForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (save.disabled) return
    save.disabled = true
    status.textContent = ''
    try {
      const result = await accountRequest('account/email', 'PUT', {
        email: email.value.trim(), password: currentPassword.value,
      })
      address = email.value = result.email
      currentPassword.value = ''
      if (needsEmail) location.reload()
      status.textContent = 'Email saved. You can now use it to sign in.'
    } catch (error) {
      status.textContent = error.message
    } finally {
      save.disabled = false
    }
  })
}

async function signOut(button, status) {
  button.disabled = true
  try {
    await accountRequest('logout', 'POST')
    get('planner').hidden = true
    get('account-nav').hidden = true
    location.reload()
  } catch {
    status.textContent = 'Could not sign out. Try again.'
    button.disabled = false
  }
}

const { user } = await accountRequest('account')
if (user) {
  get('account-entry').hidden = true
  get('account-name').textContent = user.username
  setupProfile(user)
  get('account-nav').hidden = !user.email
  get('planner').dataset.accountRole = user.role
  get('planner').dataset.accountId = user.id
  get('admin-link').hidden = user.role !== 'poweruser'
  get('planner').hidden = !user.email

  const signOutButton = get('sign-out')
  signOutButton.addEventListener('click', () => signOut(signOutButton, get('sign-out-status')))

  if (user.email) {
    try {
      await import('./app.js')
      if (get('status').textContent === 'Loading the editor…') get('status').textContent = ''
    } catch (error) {
      console.error('Failed to start Hockey Planner', error)
      get('planner').hidden = true
      get('account-entry').hidden = false
      document.getElementById('auth-heading').textContent = 'Planner unavailable'
      feedback.textContent = 'The planner could not load. Try reloading the page.'
    }
  }
} else {
  form.hidden = false
  feedback.textContent = ''
}
