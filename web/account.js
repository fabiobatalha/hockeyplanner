import { navigateWithMessage, showActionMessage } from './action-message.js'
import { request } from './http.js'
import { appUrl } from './urls.js'
import { addPasswordVisibility, checkNewPassword, passwordRequirements } from './password-policy.js'

const get = id => document.getElementById(id)

function setupPasswordChange() {
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
  get('change-password-help').textContent = passwordRequirements
  next.addEventListener('input', () => next.setCustomValidity(''))
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (save.disabled || !checkNewPassword(next)) return
    save.disabled = true
    try {
      await request('account/password', 'PUT', {
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

function setupAccountDeletion() {
  const dialog = get('self-delete-dialog')
  const form = get('self-delete-form')
  const password = get('self-delete-password')
  const submit = get('self-delete-confirm')
  const cancel = get('self-delete-cancel')
  const status = get('self-delete-status')
  function open() {
    form.reset()
    status.textContent = ''
    dialog.showModal()
  }
  get('profile-delete-account')?.addEventListener('click', open)
  get('membership-delete-account')?.addEventListener('click', open)
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
      await request('account', 'DELETE', { password: password.value })
      form.reset()
      navigateWithMessage(appUrl('login'), 'Your account was permanently deleted.')
    } catch (error) {
      status.textContent = ''
      showActionMessage(error.message)
      submit.disabled = cancel.disabled = false
    }
  })
}

function setupProfile() {
  const profileForm = get('profile-email-form')
  const email = get('profile-email')
  const password = get('profile-password')
  const save = profileForm.querySelector('button[type=submit]')
  if (!get('profile-password-section').hidden) setupPasswordChange()
  profileForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (save.disabled) return
    save.disabled = true
    try {
      await request('account/email', 'PUT', { email: email.value.trim(), password: password.value })
      profileForm.reset()
      showActionMessage('Check your new address for a confirmation link and code. You have 30 minutes to confirm.')
    } catch (error) {
      showActionMessage(error.message)
    } finally {
      save.disabled = false
    }
  })

  const downgrade = get('profile-downgrade')
  downgrade.addEventListener('click', async () => {
    if (downgrade.disabled || !confirm('Switch to Free? You will keep your existing drills and plans.')) return
    downgrade.disabled = true
    try {
      await request('account/tier', 'PUT', { tier: 'free', confirm_downgrade: true })
      navigateWithMessage(appUrl('account'), 'Your subscription was switched to Free. Your saved drills and plans were kept.')
    } catch (error) {
      downgrade.disabled = false
      showActionMessage(error.message)
    }
  })
}

function setupMembership() {
  const free = get('choose-free-plan')
  free.addEventListener('click', async () => {
    if (free.disabled) return
    free.disabled = true
    try {
      await request('account/tier', 'PUT', { tier: 'free' })
      navigateWithMessage(appUrl(free.dataset.next || 'editor'), 'Free plan selected.')
    } catch (error) {
      free.disabled = false
      showActionMessage(error.message)
    }
  })
}

setupAccountDeletion()
if (document.body.dataset.page === 'account') setupProfile()
else setupMembership()
