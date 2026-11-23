import { navigateWithMessage, showActionMessage } from './action-message.js'
import { presentPlan } from './plan-viewer.js'
import { activityThumbnail } from './drawing.js'
import { exportActivity, exportTrainingPlan } from './export.js'
import { claimPlanLink } from './library.js'
import { renderMarkdown } from './markdown.js'
import { appUrl } from './urls.js'

const get = id => document.getElementById(id)
const { plan, token, present, start_index: startIndex = 0, standalone } = JSON.parse(get('shared-preview').textContent)
const status = get('plan-invite-status')
const accept = get('accept-plan-link')
const print = get('print-plan-link')

document.querySelectorAll('.plan-preview-drill').forEach((row, index) => {
  const drill = plan.activities[index]
  row.prepend(activityThumbnail(drill))
  const description = row.querySelector('.formatted-description')
  if (description) renderMarkdown(drill.description, description)
})

accept?.addEventListener('click', async () => {
  accept.disabled = true
  try {
    await claimPlanLink(token)
    navigateWithMessage(appUrl('plans'), 'Shared plan added to Shared with me.')
  } catch (error) {
    showActionMessage(error.message)
    accept.disabled = false
  }
})

get('fullscreen-plan-link').addEventListener('click', () => presentPlan(plan.name, plan.activities, { startIndex }))

print.addEventListener('click', async () => {
  print.disabled = true
  status.textContent = 'Generating the PDF…'
  try {
    if (standalone) await exportActivity(plan.activities[0], 'pdf', token)
    else await exportTrainingPlan(plan.name, plan.activities, token)
    showActionMessage('PDF ready.')
  } catch {
    showActionMessage('Could not generate the PDF.')
  } finally {
    status.textContent = ''
    print.disabled = false
  }
})

if (present) presentPlan(plan.name, plan.activities, { startIndex, auto: true })
