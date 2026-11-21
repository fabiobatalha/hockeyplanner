export const passwordRequirements = 'Use 12–128 characters, including at least one uppercase letter and one special character.'

export function checkNewPassword(input) {
  const length = [...input.value].length
  const valid = length >= 12 && length <= 128 && /\p{Lu}/u.test(input.value) && /[\p{P}\p{S}]/u.test(input.value)
  input.setCustomValidity(valid ? '' : passwordRequirements)
  return input.reportValidity()
}

export function addPasswordVisibility(input, label = 'password') {
  const wrapper = document.createElement('div')
  wrapper.className = 'password-field'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'password-visibility'
  if (input.id) toggle.setAttribute('aria-controls', input.id)
  input.before(wrapper)
  wrapper.append(input, toggle)

  function setVisibility(visible) {
    input.type = visible ? 'text' : 'password'
    toggle.textContent = visible ? 'Hide' : 'Show'
    toggle.setAttribute('aria-label', toggle.textContent + ' ' + label)
  }

  toggle.addEventListener('click', () => setVisibility(input.type === 'password'))
  setVisibility(false)
  return () => setVisibility(false)
}
