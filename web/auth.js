import { showActionMessage, showActionMessageAfterReload, restoreActionMessage } from './action-message.js'
import { setupPlanInvite } from './plan-invite.js'
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
const forgotButton = get('forgot-password')
const forgotForm = get('forgot-password-form')
const resetEmail = get('reset-email')
let registering = false

async function accountRequest(path, method = 'GET', body) {
  const options = { method, cache: 'no-store' }
  if (body) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  const response = await fetch('./api/' + path, options)
  if (response.status === 204 || response.status === 202) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'The account request failed.')
  return data
}

modeButton.addEventListener('click', () => {
  registering = !registering
  forgotButton.hidden = registering
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

forgotButton.addEventListener('click', () => {
  form.hidden = true
  forgotForm.hidden = false
  get('auth-heading').textContent = 'Forgot your password?'
  feedback.textContent = ''
  resetEmail.value = username.value.includes('@') ? username.value.trim() : ''
  resetEmail.focus()
})

get('back-to-sign-in').addEventListener('click', () => {
  forgotForm.hidden = true
  form.hidden = false
  get('auth-heading').textContent = 'Sign in'
  feedback.textContent = ''
  forgotButton.focus()
})

forgotForm.addEventListener('submit', async event => {
  event.preventDefault()
  const send = forgotForm.querySelector('button[type=submit]')
  if (send.disabled) return
  const back = get('back-to-sign-in')
  send.disabled = back.disabled = true
  feedback.textContent = ''
  try {
    await accountRequest('forgot-password', 'POST', { email: resetEmail.value.trim() })
    showActionMessage('If an account uses that email address, you’ll receive a password reset link.')
  } catch (error) {
    showActionMessage(error.message)
  } finally {
    send.disabled = back.disabled = false
  }
})

password.addEventListener('input', () => password.setCustomValidity(''))

form.addEventListener('submit', async event => {
  event.preventDefault()
  if (submit.disabled || (registering && !checkNewPassword(password))) return
  submit.disabled = modeButton.disabled = true
  feedback.textContent = ''
  try {
    const identifier = username.value.trim()
    const invitation = location.hash.replace(/\/present$/, '')
    const details = registering
      ? { username: identifier, email: registrationEmail.value.trim(), password: password.value,
          return_to: /^#share\/[A-Za-z0-9_-]{43}$/.test(invitation) ? invitation : '' }
      : { identifier, password: password.value }
    await accountRequest(registering ? 'register' : 'login', 'POST', details)
    if (registering) {
      password.value = ''
      hideAuthPassword()
      showActionMessage('Check your email for the confirmation link and six-digit code. You have 30 minutes to confirm your account.')
      submit.disabled = modeButton.disabled = false
      return
    }
    if (!location.hash.startsWith('#share/')) history.replaceState(null, '', '#editor')
    location.reload()
  } catch (error) {
    showActionMessage(error.message)
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
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (save.disabled || !checkNewPassword(next)) return
    save.disabled = true
    try {
      await accountRequest('account/password', 'PUT', {
        current_password: current.value, new_password: next.value,
      })
      resetPasswords()
      showActionMessage('Password changed. Other sessions have been signed out.')
    } catch (error) {
      showActionMessage(error.message)
    } finally {
      save.disabled = false
    }
  })
}

function setupSubscription(user, dialog) {
  const section = get('profile-subscription')
  const downgrade = get('profile-downgrade')
  function refresh() {
    section.hidden = !user.email || user.tier === 'pending'
    const full = user.tier === 'full'
    get('profile-account-tier').textContent = full
      ? 'Full Access · Unlimited drills and practice plans'
      : 'Free · Up to 10 drills and 3 practice plans'
    downgrade.hidden = !full
  }

  get('profile-compare-plans').addEventListener('click', () => {
    dialog.close()
    location.hash = 'membership'
  })
  downgrade.addEventListener('click', async () => {
    if (downgrade.disabled || !confirm('Switch to Free? You will keep all existing drills and plans. Free accounts can save up to 10 drills and 3 practice plans.')) return
    downgrade.disabled = true
    try {
      await accountRequest('account/tier', 'PUT', { tier: 'free', confirm_downgrade: true })
      user.tier = 'free'
      refresh()
      renderMembership(user)
      get('profile-compare-plans').focus()
      showActionMessage('Your subscription was switched to Free. Your saved drills and plans were kept.')
    } catch (error) {
      showActionMessage(error.message)
    } finally {
      downgrade.disabled = false
    }
  })
  refresh()
}

function setupAccountDeletion(user) {
  const dialog = get('self-delete-dialog')
  const form = get('self-delete-form')
  const password = get('self-delete-password')
  const submit = get('self-delete-confirm')
  const cancel = get('self-delete-cancel')
  const status = get('self-delete-status')
  get('self-delete-admin-warning').hidden = user.role !== 'poweruser'
  function open() {
    form.reset()
    status.textContent = ''
    dialog.showModal()
  }
  get('profile-delete-account').addEventListener('click', open)
  get('membership-delete-account').addEventListener('click', open)
  cancel.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => form.reset())
  dialog.addEventListener('cancel', event => {
    if (submit.disabled) event.preventDefault()
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (submit.disabled) return
    submit.disabled = cancel.disabled = true
    status.textContent = 'Deleting your account…'
    try {
      await accountRequest('account', 'DELETE', { password: password.value })
      form.reset()
      history.replaceState(null, '', '#editor')
      showActionMessageAfterReload('Your account was permanently deleted.')
    } catch (error) {
      status.textContent = ''
      showActionMessage(error.message)
      submit.disabled = cancel.disabled = false
    }
  })
}

function setupProfile(user) {
  const dialog = get('account-profile')
  const profileForm = get('profile-email-form')
  const email = get('profile-email')
  const currentPassword = get('profile-password')
  const save = profileForm.querySelector('button')
  setupSubscription(user, dialog)
  const address = user.email
  const needsEmail = !address
  if (!needsEmail) setupPasswordChange(dialog)
  const profileSignOut = get('profile-sign-out')
  get('profile-close').hidden = needsEmail
  profileSignOut.hidden = !needsEmail
  get('profile-email-required').hidden = !needsEmail
  profileSignOut.addEventListener('click', () => signOut(profileSignOut))
  dialog.addEventListener('cancel', event => {
    if (needsEmail) event.preventDefault()
  })
  function openProfile() {
    email.value = address ?? ''
    currentPassword.value = ''
    dialog.showModal()
  }
  get('account-name').addEventListener('click', openProfile)
  if (needsEmail) openProfile()
  dialog.addEventListener('close', () => { currentPassword.value = '' })
  profileForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (save.disabled) return
    save.disabled = true
    try {
      await accountRequest('account/email', 'PUT', {
        email: email.value.trim(), password: currentPassword.value,
      })
      email.value = address ?? ''
      currentPassword.value = ''
      showActionMessage('Check your new address for a confirmation link and code. You have 30 minutes to confirm.')
    } catch (error) {
      showActionMessage(error.message)
    } finally {
      save.disabled = false
    }
  })
}

async function signOut(button) {
  button.disabled = true
  try {
    await accountRequest('logout', 'POST')
    get('planner').hidden = true
    get('account-nav').hidden = true
    location.reload()
  } catch {
    showActionMessage('Could not sign out. Try again.')
    button.disabled = false
  }
}

function renderMembership(user) {
  const pending = user.tier === 'pending'
  get('membership-title').textContent = pending ? 'Choose your plan' : 'Compare plans'
  get('upgrade-plan').hidden = user.tier !== 'free' || user.role === 'poweruser'
  get('current-free-plan').hidden = user.tier !== 'free'
  get('current-full-plan').hidden = user.tier !== 'full'
  get('choose-full-plan').hidden = user.tier === 'full'
  get('choose-free-plan').hidden = !pending
  get('membership-account-actions').hidden = !pending
}

function setupMembership(user) {
  const pending = user.tier === 'pending'
  const chooseFree = get('choose-free-plan')
  const logout = get('membership-sign-out')
  renderMembership(user)
  logout.addEventListener('click', () => signOut(logout))
  chooseFree.addEventListener('click', async () => {
    if (chooseFree.disabled) return
    chooseFree.disabled = true
    try {
      await accountRequest('account/tier', 'PUT', { tier: 'free' })
      showActionMessageAfterReload('Free plan selected.')
    } catch (error) {
      showActionMessage(error.message)
      chooseFree.disabled = false
    }
  })
  if (pending && user.email) {
    get('editor-page').hidden = true
    get('membership-page').hidden = false
    get('membership-title').focus()
  }
}

function setupEmailConfirmation(token) {
  get('account-entry').hidden = true
  get('email-confirmation-page').hidden = false
  const confirmationForm = get('email-confirmation-form')
  const code = get('email-confirmation-code')
  const confirm = confirmationForm.querySelector('button')
  code.focus()

  confirmationForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (confirm.disabled) return
    confirm.disabled = true
    try {
      const result = await accountRequest('confirm-email', 'POST', { token, code: code.value })
      confirmationForm.reset()
      confirmationForm.hidden = true
      if (result.registered) {
        history.replaceState(null, '', result.return_to || '#editor')
        showActionMessageAfterReload('Email confirmed. Your account is ready.')
      } else {
        showActionMessage('Email confirmed. You can now sign in with your new address.')
      }
    } catch (error) {
      showActionMessage(error.message)
      confirm.disabled = false
    }
  })
}

function setupPasswordReset(token) {
  get('account-entry').hidden = true
  get('password-reset-page').hidden = false
  const resetForm = get('password-reset-form')
  const next = get('reset-new-password')
  const reset = resetForm.querySelector('button[type=submit]')
  const hidePassword = addPasswordVisibility(next, 'new password')
  next.addEventListener('input', () => next.setCustomValidity(''))
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    resetForm.hidden = true
    showActionMessage('This password reset link is invalid. Return to sign in to request a new link.')
    return
  }
  next.focus()

  resetForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (reset.disabled || !checkNewPassword(next)) return
    reset.disabled = true
    try {
      await accountRequest('reset-password', 'POST', { token, new_password: next.value })
      resetForm.reset()
      hidePassword()
      resetForm.hidden = true
      showActionMessage('Password reset. Sign in with your new password.')
    } catch (error) {
      showActionMessage(error.message)
    } finally {
      reset.disabled = false
    }
  })
}

const emailPage = '#confirm-email/'
const resetPage = '#reset-password/'
const specialPage = hash => [emailPage, resetPage].find(prefix => hash.startsWith(prefix))
const openedPage = specialPage(location.hash) ? location.hash : null
addEventListener('hashchange', () => {
  if (openedPage !== (specialPage(location.hash) ? location.hash : null)) location.reload()
})
if (openedPage?.startsWith(emailPage)) {
  setupEmailConfirmation(openedPage.slice(emailPage.length))
} else if (openedPage?.startsWith(resetPage)) {
  setupPasswordReset(openedPage.slice(resetPage.length))
} else {
  const { user } = await accountRequest('account')
  if (user) {
    get('account-entry').hidden = true
    const accountName = get('account-name')
    get('account-name-label').textContent = user.username
    accountName.dataset.initial = user.username.charAt(0).toUpperCase()
    accountName.setAttribute('aria-label', 'Account profile for ' + user.username)
    setupAccountDeletion(user)
    setupProfile(user)
    get('account-nav').hidden = !user.email || user.tier === 'pending'
    get('planner').dataset.accountRole = user.role
    get('planner').dataset.accountId = user.id
    get('admin-link').hidden = user.role !== 'poweruser'
    get('planner').hidden = !user.email
    setupMembership(user)

    const signOutButton = get('sign-out')
    signOutButton.addEventListener('click', () => signOut(signOutButton))

    if (user.email && user.tier !== 'pending') {
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
    const backToShared = get('back-to-shared-plan')
    const showPreview = setupPlanInvite({
      signedIn: false,
      accept() {
        get('planner').hidden = true
        get('account-entry').hidden = false
        username.focus()
      },
    })

    function showGuestPage() {
      const invite = location.hash.startsWith('#share/')
      get('account-entry').hidden = invite
      get('planner').hidden = !invite
      get('editor-page').hidden = true
      get('plan-invite-page').hidden = !invite
      backToShared.hidden = !invite
      if (invite) showPreview(location.hash)
    }

    backToShared.addEventListener('click', showGuestPage)
    addEventListener('hashchange', showGuestPage)
    form.hidden = false
    feedback.textContent = ''
    showGuestPage()
  }
}

restoreActionMessage()
