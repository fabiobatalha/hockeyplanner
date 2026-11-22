import { showActionMessage } from './action-message.js'
import { presentPlan } from './plan-viewer.js'
import { activityThumbnail } from './drawing.js'
import { exportTrainingPlan } from './export.js'
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
      await accept(invitation)
    } catch (error) {
      if (location.hash === invitation) showActionMessage(error.message)
    } finally {
      if (location.hash === invitation) acceptButton.disabled = false
    }
  })

  fullscreenButton.addEventListener('click', () => {
    if (!displayed || location.hash !== displayed.invitation) return
    presentPlan(displayed.plan.name, displayed.plan.activities)
  })

  printButton.addEventListener('click', async () => {
    if (!displayed || location.hash !== displayed.invitation) return
    const { plan, invitation } = displayed
    printButton.disabled = true
    status.textContent = 'Generating the plan PDF…'
    try {
      await exportTrainingPlan(plan.name, plan.activities)
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
    displayed = null
    preview.hidden = true
    acceptButton.disabled = printButton.disabled = fullscreenButton.disabled = true
    status.textContent = 'Loading plan preview…'
    try {
      const { owner, plan } = await previewPlanLink(invitation.slice('#share/'.length))
      if (request !== version || location.hash !== invitation) return
      renderPlan(owner, plan)
      displayed = { invitation, plan }
      preview.hidden = false
      acceptButton.disabled = printButton.disabled = fullscreenButton.disabled = false
      status.textContent = ''
    } catch (error) {
      if (request === version && location.hash === invitation) status.textContent = error.message
    }
  }
}
