import { showActionMessage } from './action-message.js'
import { presentPlan } from './plan-viewer.js'
import { activityThumbnail } from './drawing.js'
import { exportActivity, exportTrainingPlan } from './export.js'
import { previewPlanLink } from './library.js'
import { renderMarkdown } from './markdown.js'

const get = id => document.getElementById(id)

function renderPlan(owner, plan) {
  get('plan-preview-name').textContent = plan.name
  get('plan-preview-owner').textContent = 'Shared by ' + owner
  const drills = get('plan-preview-drills')
  drills.replaceChildren()
  for (const drill of plan.activities) {
    const row = document.createElement('li')
    const details = document.createElement('div')
    const title = document.createElement('h3')
    title.textContent = drill.title
    details.append(title)
    if (drill.description?.trim()) {
      const description = document.createElement('div')
      description.className = 'formatted-description'
      renderMarkdown(drill.description, description)
      details.append(description)
    }
    const content = document.createElement('div')
    content.className = 'plan-preview-drill'
    content.append(activityThumbnail(drill), details)
    row.append(content)
    drills.append(row)
  }
}

export function setupPlanInvite({ signedIn, accept }) {
  const preview = get('plan-invite-preview')
  const status = get('plan-invite-status')
  const acceptButton = get('accept-plan-link')
  const printButton = get('print-plan-link')
  const fullscreenButton = get('fullscreen-plan-link')
  let version = 0
  let displayed

  acceptButton.textContent = signedIn ? 'Accept shared plan' : 'Sign in to accept'
  get('plan-invite-guidance').textContent = signedIn
    ? 'Accept to add this read-only plan to Shared with me.'
    : 'Sign in to save this read-only plan under Shared with me.'

  acceptButton.addEventListener('click', async () => {
    const invitation = displayed?.invitation
    if (!invitation || location.hash !== invitation) return
    acceptButton.disabled = true
    status.textContent = ''
    try {
      await accept(invitation, displayed.token)
    } catch (error) {
      if (location.hash === invitation) showActionMessage(error.message)
    } finally {
      if (location.hash === invitation) acceptButton.disabled = false
    }
  })

  fullscreenButton.addEventListener('click', () => {
    if (!displayed || location.hash !== displayed.invitation) return
    presentPlan(displayed.plan.name, displayed.plan.activities, { startIndex: displayed.startIndex })
  })

  printButton.addEventListener('click', async () => {
    if (!displayed || location.hash !== displayed.invitation) return
    const { plan, invitation, token, standalone } = displayed
    printButton.disabled = true
    status.textContent = 'Generating the plan PDF…'
    try {
      if (standalone) await exportActivity(plan.activities[0], 'pdf', token)
      else await exportTrainingPlan(plan.name, plan.activities, token)
      if (location.hash === invitation) showActionMessage('Plan PDF ready.')
    } catch {
      if (location.hash === invitation) showActionMessage('Could not generate the plan PDF.')
    } finally {
      if (displayed?.invitation === invitation) {
        status.textContent = ''
        printButton.disabled = false
      }
    }
  })

  return async function showPreview(invitation) {
    const request = ++version
    const [, token, present, drillId] = /^#share\/([A-Za-z0-9_-]{43})(?:(\/present)|\/drill\/([^/]+))?$/.exec(invitation) ?? []
    displayed = null
    preview.hidden = true
    acceptButton.hidden = get('plan-invite-guidance').hidden = Boolean(drillId)
    get('plan-invite-title').textContent = drillId ? 'Shared Drill' : 'Shared Practice Plan'
    acceptButton.disabled = printButton.disabled = fullscreenButton.disabled = true
    status.textContent = 'Loading preview…'
    try {
      if (!token) throw new Error('This share link is invalid.')
      const { owner, plan, start_index: startIndex = 0, standalone = false } = await previewPlanLink(token, drillId)
      if (request !== version || location.hash !== invitation) return
      get('plan-invite-title').textContent = standalone ? 'Shared Drill' : 'Shared Practice Plan'
      acceptButton.hidden = get('plan-invite-guidance').hidden = standalone
      renderPlan(owner, plan)
      displayed = { invitation, plan, token, startIndex, standalone }
      preview.hidden = false
      acceptButton.disabled = printButton.disabled = fullscreenButton.disabled = false
      status.textContent = ''
      if (present || drillId) presentPlan(plan.name, plan.activities, { startIndex, auto: true })
    } catch (error) {
      if (request === version && location.hash === invitation) status.textContent = error.message
    }
  }
}
