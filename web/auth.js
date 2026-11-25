import { gettext } from './i18n.js'
import { navigateWithMessage, showActionMessage } from './action-message.js'
import { request } from './http.js'
import { appUrl } from './urls.js'
import { addPasswordVisibility, checkNewPassword } from './password-policy.js'

const get = id => document.getElementById(id)
const registrationReturn = /^(?:\/share\/[A-Za-z0-9_-]{43}|\/editor\/demo-draft)$/

function handleForm(form, action) {
  const submit = form.querySelector('button[type=submit]')
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (submit.disabled) return
    submit.disabled = true
    try {
      await action()
    } catch (error) {
      showActionMessage(error.message)
    } finally {
      submit.disabled = false
    }
  })
  submit.disabled = false
}

function setupCredentials(registering) {
  const form = get('auth-form')
  const password = get('password')
  const hidePassword = addPasswordVisibility(password)
  password.addEventListener('input', () => password.setCustomValidity(''))
  handleForm(form, async () => {
    const identifier = get('username').value.trim()
    const next = form.dataset.next
    if (!registering) {
      await request('login', 'POST', { identifier, password: password.value })
      location.replace(appUrl(next || 'editor'))
      return
    }
    if (!checkNewPassword(password)) return
    const share = next.replace(/\/present$/, '')
    const returnTo = registrationReturn.test(share) ? share : ''
    await request('register', 'POST', {
      username: identifier, email: get('registration-email').value.trim(), password: password.value, return_to: returnTo,
    })
    password.value = ''
    hidePassword()
    showActionMessage(gettext('Check your email for the confirmation link and six-digit code. You have 30 minutes to confirm your account.'))
  })
}

function setupEmailConfirmation() {
  const form = get('email-confirmation-form')
  const code = get('email-confirmation-code')
  handleForm(form, async () => {
    const result = await request('confirm-email', 'POST', { token: form.dataset.token, code: code.value })
    form.reset()
    if (result.registered) {
      const returnTo = registrationReturn.test(result.return_to) ? result.return_to : ''
      const url = appUrl(result.tier === 'full' ? returnTo || 'editor' : 'membership')
      if (result.tier !== 'full' && returnTo) url.searchParams.set('next', returnTo)
      navigateWithMessage(url, gettext('Email confirmed. Your account is ready.'))
    } else {
      form.hidden = true
      showActionMessage(gettext('Email confirmed. You can now sign in with your new address.'))
    }
  })
}

function setupPasswordReset() {
  const form = get('password-reset-form')
  const password = get('reset-new-password')
  const hidePassword = addPasswordVisibility(password, gettext('new password'))
  password.addEventListener('input', () => password.setCustomValidity(''))
  handleForm(form, async () => {
    if (!checkNewPassword(password)) return
    await request('reset-password', 'POST', { token: form.dataset.token, new_password: password.value })
    form.reset()
    hidePassword()
    form.hidden = true
    showActionMessage(gettext('Password reset. Sign in with your new password.'))
  })
}

switch (document.body.dataset.page) {
  case 'login':
  case 'register':
    setupCredentials(document.body.dataset.page === 'register')
    break
  case 'forgot_password':
    handleForm(get('forgot-password-form'), async () => {
      await request('forgot-password', 'POST', { email: get('reset-email').value.trim() })
      showActionMessage(gettext('If an account uses that email address, you’ll receive a password reset link.'))
    })
    break
  case 'confirm_email':
    setupEmailConfirmation()
    break
  case 'reset_password':
    setupPasswordReset()
    break
}
