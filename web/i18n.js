const messages = JSON.parse(document.getElementById('browser-translations')?.textContent ?? '{}')
export const locale = document.documentElement.lang || 'en'
const plural = new Intl.PluralRules(locale)

function interpolate(message, values) {
  return message.replace(/%\((\w+)\)[sd]/g, (match, name) => values[name] ?? match)
}

export function gettext(message, values = {}) {
  return interpolate(Object.hasOwn(messages, message) ? messages[message] : message, values)
}

export function ngettext(singular, multiple, count, values = {}) {
  const forms = Object.hasOwn(messages, singular) ? messages[singular] : null
  const form = plural.select(count) === 'one' ? 0 : 1
  const translation = Array.isArray(forms) ? forms[form] : undefined
  return interpolate(translation || (count === 1 ? singular : multiple), { count, ...values })
}
