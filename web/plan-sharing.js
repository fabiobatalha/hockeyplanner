import { createPlanLink, disablePlanLink, readPlanLink, readPlanRecipients, revokePlanShare, sharePracticePlan } from './library.js'

export function setupPlanSharing() {
  const dialog = document.getElementById('share-plan')
  const heading = document.getElementById('share-plan-title')
  const form = document.getElementById('share-plan-form')
  const username = document.getElementById('share-username')
  const list = document.getElementById('share-recipients')
  const status = document.getElementById('share-plan-status')
  const create = document.getElementById('create-plan-link')
  const linkControls = document.getElementById('plan-link-controls')
  const linkUrl = document.getElementById('plan-link-url')
  const copy = document.getElementById('copy-plan-link')
  const disable = document.getElementById('disable-plan-link')
  let activePlan

  function showLink(token) {
    create.hidden = Boolean(token)
    linkControls.hidden = !token
    const url = new URL(location.href)
    url.hash = token ? 'share/' + token : ''
    linkUrl.value = token ? url.href : ''
  }

  async function changeLink(button, action, message) {
    const plan = activePlan
    if (!plan || button.disabled) return
    button.disabled = true
    try {
      const result = await action(plan.id)
      if (activePlan === plan) {
        showLink(result?.token)
        status.textContent = message
      }
    } catch (error) {
      if (activePlan === plan) status.textContent = error.message
    } finally {
      if (activePlan === plan) button.disabled = false
    }
  }

  create.addEventListener('click', () => changeLink(create, createPlanLink, 'Share link created.'))
  disable.addEventListener('click', () => changeLink(disable, disablePlanLink, 'Share link disabled.'))
  copy.addEventListener('click', async () => {
    const url = linkUrl.value
    try {
      await navigator.clipboard.writeText(url)
      status.textContent = 'Link copied.'
    } catch {
      linkUrl.focus()
      linkUrl.select()
      status.textContent = 'Copy the selected link to share it.'
    }
  })

  async function refresh(plan) {
    const { recipients } = await readPlanRecipients(plan.id)
    if (activePlan !== plan) return
    list.replaceChildren()
    if (!recipients.length) {
      const row = document.createElement('li')
      row.textContent = 'No users have been granted access yet.'
      list.append(row)
    }
    for (const recipient of recipients) {
      const row = document.createElement('li')
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = 'Remove access'
      remove.setAttribute('aria-label', 'Remove access for ' + recipient.username)
      remove.addEventListener('click', async () => {
        remove.disabled = true
        try {
          await revokePlanShare(plan.id, recipient.id)
          await refresh(plan)
          if (activePlan === plan) status.textContent = 'Access removed for ' + recipient.username + '.'
        } catch (error) {
          if (activePlan === plan) status.textContent = error.message
          remove.disabled = false
        }
      })
      row.append(recipient.username, remove)
      list.append(row)
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    const plan = activePlan
    const submit = form.querySelector('button')
    if (!plan || submit.disabled) return
    submit.disabled = true
    try {
      await sharePracticePlan(plan.id, username.value.trim())
      await refresh(plan)
      if (activePlan === plan) {
        form.reset()
        status.textContent = 'Read-only access granted.'
      }
    } catch (error) {
      if (activePlan === plan) status.textContent = error.message
    } finally {
      if (activePlan === plan) submit.disabled = false
    }
  })

  dialog.addEventListener('close', () => { activePlan = null })

  return async function open(plan) {
    activePlan = { id: plan.id }
    const requested = activePlan
    heading.textContent = 'Share ' + plan.name
    form.reset()
    form.querySelector('button').disabled = false
    list.replaceChildren()
    status.textContent = ''
    showLink(null)
    create.disabled = true
    disable.disabled = false
    dialog.showModal()
    try {
      const [, link] = await Promise.all([refresh(requested), readPlanLink(plan.id)])
      if (activePlan === requested) showLink(link.token)
    } catch (error) {
      if (activePlan === requested) status.textContent = error.message
    } finally {
      if (activePlan === requested) create.disabled = false
    }
  }
}
