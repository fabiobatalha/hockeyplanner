import { gettext } from './i18n.js'
import { showActionMessage } from './action-message.js'
import { addPasswordVisibility, checkNewPassword, passwordRequirements } from './password-policy.js'
import { deleteAccount, readAccounts, updateAccount } from './library.js'

function setupAdmin(currentUserId) {
  const list = document.getElementById('admin-users')
  const status = document.getElementById('admin-status')
  const dialog = document.getElementById('delete-account-dialog')
  const warning = document.getElementById('delete-account-warning')
  const deleteStatus = document.getElementById('delete-account-status')
  const remove = document.getElementById('confirm-account-delete')
  const cancel = document.getElementById('cancel-account-delete')
  let target
  let version = 0

  dialog.addEventListener('cancel', event => {
    if (remove.disabled) event.preventDefault()
  })
  remove.addEventListener('click', async () => {
    if (!target || remove.disabled) return
    const { id, username } = target
    remove.disabled = cancel.disabled = true
    deleteStatus.textContent = gettext('Deleting account…')
    try {
      await deleteAccount(id)
      dialog.close()
      showActionMessage(gettext('%(username)s and their content were deleted.', { username }))
      await refreshAdmin()
    } catch (error) {
      deleteStatus.textContent = ''
      showActionMessage(error.message)
    } finally {
      remove.disabled = cancel.disabled = false
    }
  })

  function field(form, text, input, id) {
    input.id = id
    const wrapper = document.createElement('div')
    wrapper.className = 'admin-field'
    const label = document.createElement('label')
    label.htmlFor = id
    label.textContent = text
    wrapper.append(label, input)
    form.append(wrapper)
  }

  function select(options, value) {
    const input = document.createElement('select')
    for (const [key, text] of options) input.add(new Option(text, key))
    input.value = value
    return input
  }

  function accountCard(user) {
    const card = document.createElement('article')
    card.className = 'card admin-account'
    const heading = document.createElement('h2')
    heading.textContent = user.username
    const email = document.createElement('p')
    email.className = 'admin-account-email'
    email.textContent = user.email ?? gettext('No email on file')
    card.append(heading, email)
    const plans = new Map([['free', gettext('Free')], ['full', gettext('Full Access')], ['pending', gettext('Plan not selected')]])

    if (user.id === currentUserId) {
      const description = document.createElement('p')
      description.textContent = gettext('Poweruser · Your account · %(plan)s', { plan: plans.get(user.tier) })
      card.append(description)
      return card
    }

    const form = document.createElement('form')
    form.setAttribute('aria-label', gettext('Manage %(username)s', { username: user.username }))
    const role = select([['user', gettext('User')], ['poweruser', gettext('Poweruser')]], user.role)
    const access = select([['enabled', gettext('Active')], ['disabled', gettext('Disabled')]], user.enabled ? 'enabled' : 'disabled')
    let savedTier = user.tier
    const tier = select([...plans].filter(([value]) => value !== 'pending' || savedTier === 'pending'), savedTier)
    function syncTier() {
      tier.disabled = role.value === 'poweruser'
      if (tier.disabled) tier.value = 'full'
    }
    role.addEventListener('change', () => {
      tier.value = savedTier
      syncTier()
    })
    syncTier()
    const password = document.createElement('input')
    password.type = 'password'
    password.autocomplete = 'new-password'
    password.maxLength = 128
    password.placeholder = gettext('Leave blank to keep current password')
    password.addEventListener('input', () => password.setCustomValidity(''))
    field(form, gettext('Role'), role, 'admin-role-' + user.id)
    field(form, gettext('Access'), access, 'admin-access-' + user.id)
    field(form, gettext('Subscription plan'), tier, 'admin-tier-' + user.id)
    field(form, gettext('New password (optional)'), password, 'admin-password-' + user.id)
    const hidePassword = addPasswordVisibility(password, gettext('new password for %(username)s', { username: user.username }))
    const help = document.createElement('p')
    help.id = 'admin-password-help-' + user.id
    help.className = 'admin-password-help'
    help.textContent = passwordRequirements
    password.setAttribute('aria-describedby', help.id)
    const save = document.createElement('button')
    save.type = 'submit'
    save.className = 'primary'
    save.textContent = gettext('Save changes')
    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'danger-outline'
    deleteButton.textContent = gettext('Delete account')
    deleteButton.setAttribute('aria-label', gettext('Delete account %(username)s', { username: user.username }))
    deleteButton.addEventListener('click', () => {
      target = user
      warning.textContent = gettext('Permanently delete %(username)s, their drills and practice plans? This also ends their sessions and removes their shares. This action cannot be undone.', { username: user.username })
      deleteStatus.textContent = ''
      dialog.showModal()
    })
    form.append(save, deleteButton)

    form.addEventListener('submit', async event => {
      event.preventDefault()
      if (save.disabled || (password.value && !checkNewPassword(password))) return
      const changes = { role: role.value, enabled: access.value === 'enabled' }
      if (tier.value !== savedTier && tier.value !== 'pending') changes.tier = tier.value
      if (password.value) changes.password = password.value
      for (const control of form.elements) control.disabled = true
      try {
        const { user: updated } = await updateAccount(user.id, changes)
        role.value = updated.role
        access.value = updated.enabled ? 'enabled' : 'disabled'
        savedTier = updated.tier
        if (savedTier === 'pending' && !tier.querySelector('[value="pending"]')) {
          tier.add(new Option(plans.get('pending'), 'pending'))
        }
        tier.value = savedTier
        if (savedTier !== 'pending') tier.querySelector('[value="pending"]')?.remove()
        password.value = ''
        hidePassword()
        showActionMessage(gettext('Changes saved for %(username)s.', { username: updated.username }))
      } catch (error) {
        showActionMessage(error.message)
      } finally {
        for (const control of form.elements) control.disabled = false
        syncTier()
      }
    })
    card.append(form, help)
    return card
  }

  async function refreshAdmin() {
    const requested = ++version
    status.textContent = gettext('Loading accounts…')
    list.replaceChildren()
    try {
      const { users } = await readAccounts()
      if (version !== requested) return
      list.replaceChildren(...users.map(accountCard))
      status.textContent = ''
    } catch (error) {
      if (version === requested) status.textContent = error.message
    }
  }

  return refreshAdmin
}

const refreshAdmin = setupAdmin(document.getElementById('admin-user-id').dataset.id)
await refreshAdmin()
