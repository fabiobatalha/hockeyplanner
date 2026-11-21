async function request(path, method = 'GET', record) {
  const options = { method, cache: 'no-store' }
  if (record !== undefined) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(record)
  }
  const response = await fetch('./api/' + path, options)
  if (response.status === 401) location.reload()
  if (!response.ok) {
    const details = await response.json().catch(() => null)
    throw new Error(details?.error || 'Request failed (' + response.status + ').')
  }
  if (response.status !== 204) return response.json()
}

export function readLibrary() {
  return request('library')
}

export function saveRecord(collection, record) {
  return request(collection + '/' + encodeURIComponent(record.id), 'PUT', record)
}

export function deleteRecord(collection, id) {
  return request(collection + '/' + encodeURIComponent(id), 'DELETE')
}

export async function importLegacyLibrary() {
  const migrationKey = 'gelo-tatico.server-import.v1'
  try {
    if (localStorage.getItem(migrationKey) === 'done') return
  } catch {
    return
  }
  const entries = {
    drills: 'gelo-tatico.activities.v1',
    plans: 'gelo-tatico.plans.v1',
  }
  const legacy = {}
  let hasRecords = false
  for (const [collection, key] of Object.entries(entries)) {
    legacy[collection] = []
    try {
      const records = JSON.parse(localStorage.getItem(key) || 'null')
      if (!Array.isArray(records)) continue
      legacy[collection] = records
      hasRecords ||= records.length > 0
    } catch {
      // Older browser data may be unavailable on this device.
    }
  }
  if (!hasRecords) return
  await request('library/import', 'POST', legacy)
  try {
    localStorage.setItem(migrationKey, 'done')
  } catch {
    // The server import is safe to retry if browser storage is read-only.
  }
}

export function readAccounts() {
  return request('admin/users')
}

export function updateAccount(id, changes) {
  return request('admin/users/' + encodeURIComponent(id), 'PUT', changes)
}

export function readPlanRecipients(planId) {
  return request('plans/' + encodeURIComponent(planId) + '/shares')
}

export function sharePracticePlan(planId, username) {
  return request('plans/' + encodeURIComponent(planId) + '/shares', 'POST', { username })
}

export function revokePlanShare(planId, recipientId) {
  return request('plans/' + encodeURIComponent(planId) + '/shares/' + encodeURIComponent(recipientId), 'DELETE')
}

export function readSharedPlans() {
  return request('shared-plans')
}

function sharedPlanPath(ownerId, planId) {
  return 'shared-plans/' + encodeURIComponent(ownerId) + '/' + encodeURIComponent(planId)
}

export function copySharedPlan(ownerId, planId, id) {
  return request(sharedPlanPath(ownerId, planId) + '/copy', 'POST', { id })
}

export function removeReceivedShare(ownerId, planId) {
  return request(sharedPlanPath(ownerId, planId), 'DELETE')
}

export function readPlanLink(planId) {
  return request('plans/' + encodeURIComponent(planId) + '/link')
}

export function createPlanLink(planId) {
  return request('plans/' + encodeURIComponent(planId) + '/link', 'PUT')
}

export function disablePlanLink(planId) {
  return request('plans/' + encodeURIComponent(planId) + '/link', 'DELETE')
}

export function claimPlanLink(token) {
  return request('shared-plans/claim', 'POST', { token })
}

export function previewPlanLink(token) {
  return request('shared-plans/preview', 'POST', { token })
}
