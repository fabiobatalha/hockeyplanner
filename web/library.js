import { request as apiRequest } from './http.js'

async function request(...args) {
  try {
    return await apiRequest(...args)
  } catch (error) {
    if (error.status === 401) location.reload()
    throw error
  }
}

export function readLibrary() {
  return request('library')
}

function platformDrillPath(source) {
  return 'platform-drills/' + source.ownerId + '/' + encodeURIComponent(source.drillId)
}

export function platformDrillLink(source) {
  return request(platformDrillPath(source) + '/link')
}

export function copyPlatformDrill(source, id) {
  return request(platformDrillPath(source) + '/copy', 'POST', { id })
}

export function flagPlatformDrill(id, enabled) {
  return request('drills/' + encodeURIComponent(id) + '/platform', enabled ? 'PUT' : 'DELETE')
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

export function deleteAccount(id) {
  return request('admin/users/' + encodeURIComponent(id), 'DELETE')
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

export function readReceivedPlanLink(ownerId, planId) {
  return request(sharedPlanPath(ownerId, planId) + '/link')
}

export function createPlanLink(planId) {
  return request('plans/' + encodeURIComponent(planId) + '/link', 'PUT')
}

export function disablePlanLink(planId) {
  return request('plans/' + encodeURIComponent(planId) + '/link', 'DELETE')
}

export function drillShareLink(drillId, method = 'GET') {
  return request('drills/' + encodeURIComponent(drillId) + '/link', method)
}

export function claimPlanLink(token) {
  return request('shared-plans/claim', 'POST', { token })
}
