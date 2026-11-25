import { appUrl } from './urls.js'
import { gettext } from './i18n.js'

export async function request(path, method = 'GET', body) {
  const options = { method, cache: 'no-store' }
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  const response = await fetch(appUrl('api/' + path), options)
  if (!response.ok) {
    const details = await response.json().catch(() => null)
    const error = new Error(details?.error || gettext('Request failed (%(status)d).', { status: response.status }))
    error.status = response.status
    error.code = details?.code
    error.capacity = details?.capacity
    throw error
  }
  if (response.status !== 204 && response.status !== 202) return response.json()
}
