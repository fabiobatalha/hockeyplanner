import { addPasswordVisibility, checkNewPassword, passwordRequirements } from './password-policy.js'
import { readAccounts, updateAccount } from './library.js'

export function setupAdmin(currentUserId) {
  const list = document.getElementById('admin-users')
  const status = document.getElementById('admin-status')
  let version = 0

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
    email.textContent = user.email ?? 'No email on file'
    card.append(heading, email)

    if (user.id === currentUserId) {
      const description = document.createElement('p')
      description.textContent = 'Poweruser · Your account'
      card.append(description)
      return card
    }

    const form = document.createElement('form')
    form.setAttribute('aria-label', 'Manage ' + user.username)
    const role = select([['user', 'User'], ['poweruser', 'Poweruser']], user.role)
    const access = select([['enabled', 'Active'], ['disabled', 'Disabled']], user.enabled ? 'enabled' : 'disabled')
    const password = document.createElement('input')
    password.type = 'password'
    password.autocomplete = 'new-password'
    password.maxLength = 128
    password.placeholder = 'Leave blank to keep current password'
    password.addEventListener('input', () => password.setCustomValidity(''))
    field(form, 'Role', role, 'admin-role-' + user.id)
    field(form, 'Access', access, 'admin-access-' + user.id)
    field(form, 'New password (optional)', password, 'admin-password-' + user.id)
    const hidePassword = addPasswordVisibility(password, 'new password for ' + user.username)
    const help = document.createElement('p')
    help.id = 'admin-password-help-' + user.id
    help.className = 'admin-password-help'
    help.textContent = passwordRequirements
    password.setAttribute('aria-describedby', help.id)
    const save = document.createElement('button')
    save.type = 'submit'
    save.className = 'primary'
    save.textContent = 'Save changes'
    form.append(save)

    form.addEventListener('submit', async event => {
      event.preventDefault()
      if (save.disabled || (password.value && !checkNewPassword(password))) return
      const changes = { role: role.value, enabled: access.value === 'enabled' }
      if (password.value) changes.password = password.value
      for (const control of form.elements) control.disabled = true
      status.textContent = 'Saving changes…'
      try {
        const { user: updated } = await updateAccount(user.id, changes)
        role.value = updated.role
        access.value = updated.enabled ? 'enabled' : 'disabled'
        password.value = ''
        hidePassword()
        status.textContent = 'Changes saved for ' + updated.username + '.'
      } catch (error) {
        status.textContent = error.message
      } finally {
        for (const control of form.elements) control.disabled = false
      }
    })
    card.append(form, help)
    return card
  }

  return async function refreshAdmin() {
    const requested = ++version
    status.textContent = 'Loading accounts…'
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
}
