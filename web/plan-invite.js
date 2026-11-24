import { navigateWithMessage, showActionMessage } from './action-message.js'
import { currentPresentedDrill, presentPlan } from './plan-viewer.js'
import { activityThumbnail } from './drawing.js'
import { exportActivity, exportTrainingPlan } from './export.js'
import { claimPlanLink } from './library.js'
import { renderMarkdown } from './markdown.js'
import { appUrl } from './urls.js'

const get = id => document.getElementById(id)
const preview = get('shared-preview')
const { plan, token, start_index: startIndex = 0 } = JSON.parse(preview.textContent)
const printDrill = preview.dataset.printDrill === 'true'
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

async function printPdf(button, drill) {
  button.disabled = true
  try {
    if (drill) await exportActivity(drill, 'pdf', token)
    else await exportTrainingPlan(plan.name, plan.activities, token)
  } catch {
    showActionMessage('Could not generate the PDF.')
  } finally {
    button.disabled = false
  }
}

print.addEventListener('click', () => printPdf(print, printDrill ? plan.activities[startIndex] : null))

const viewerPrint = get('print-viewer-drill')
viewerPrint?.addEventListener('click', () => {
  printPdf(viewerPrint, currentPresentedDrill())
})

presentPlan(plan.name, plan.activities, { startIndex, auto: true })
