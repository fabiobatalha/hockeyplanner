import { appUrl } from './urls.js'
import { prepareLibrary } from './library-onboarding.js'
import { confirmAction, showActionMessage } from './action-message.js'
import { presentPlan } from './plan-viewer.js'
import { showPlanLimit } from './plan-limit.js'
import { setupPlanSharing } from './plan-sharing.js'
import { copySharedPlan, deleteRecord, readLibrary, readPlanLink, readReceivedPlanLink, readSharedPlans, removeReceivedShare, saveRecord } from './library.js'
import { newRecordId } from './record-id.js'
import { exportTrainingPlan } from './export.js'
import { activityThumbnail } from './drawing.js'
import { drillSearch } from './markdown.js'

function setupPlans({ getActivities, refreshLibrary }) {
  const form = document.getElementById('plan-form')
  const name = document.getElementById('plan-name')
  const list = document.getElementById('plans-list')
  const choices = document.getElementById('plan-activities')
  const builder = document.getElementById('plan-builder')
  const catalog = document.getElementById('plan-catalog')
  const catalogSearch = document.getElementById('plan-catalog-search')
  const dropZone = document.getElementById('plan-drop-zone')
  const planColumns = document.getElementById('plan-columns')
  let sharedDrills = []
  let draggedKey = null
  let reorderingKey = null
  const feedback = document.getElementById('plan-status')
  const sharedList = document.getElementById('shared-plans-list')
  const sharedStatus = document.getElementById('shared-plans-status')
  const openSharing = setupPlanSharing()
  let sharedVersion = 0
  let plans = []
  let editingId = null
  let saving = false
  let selection = new Map()

  function button(text, action) {
    const control = document.createElement('button')
    control.type = 'button'
    control.textContent = text
    control.addEventListener('click', action)
    return control
  }

  function planCard(plan, expanded) {
    const card = document.createElement('details')
    card.className = 'card plan-entry'
    card.open = expanded
    const summary = document.createElement('summary')
    const heading = document.createElement('h3')
    heading.textContent = plan.name
    const details = document.createElement('div')
    details.append(heading)
    const timestamp = typeof plan.updated_at === 'string'
      ? plan.updated_at.replace(/(\.\d{3})\d+/, '$1') : ''
    const updated = new Date(timestamp)
    if (!Number.isNaN(updated.valueOf())) {
      const date = document.createElement('time')
      date.className = 'plan-updated'
      date.dateTime = timestamp
      date.textContent = 'Updated ' + updated.toLocaleDateString(undefined, { dateStyle: 'medium' })
      details.append(date)
    } else {
      const missingDate = document.createElement('span')
      missingDate.className = 'plan-updated'
      missingDate.textContent = 'Update date not recorded'
      details.append(missingDate)
    }
    summary.append(details)
    card.append(summary)
    return card
  }

  function currentActivity(entry) {
    return getActivities().find(activity => activity.id === entry.id)
  }

  function planActivities(plan, shared) {
    return shared ? plan.activities : plan.activities.map(saved => currentActivity(saved) ?? saved)
  }

  function exerciseList(plan, readOnly = false) {
    const exercises = document.createElement('ol')
    exercises.setAttribute('role', 'list')
    for (const saved of plan.activities) {
      const row = document.createElement('li')
      const activity = readOnly ? saved : currentActivity(saved) ?? saved
      const open = document.createElement(readOnly ? 'div' : 'a')
      open.className = 'plan-drill'
      if (!readOnly) {
        open.href = appUrl('editor/plan/' + plan.id + '/' + saved.id)
        open.classList.add('button-link')
      }
      const thumbnail = activityThumbnail(activity)
      thumbnail.removeAttribute('aria-label')
      thumbnail.setAttribute('aria-hidden', 'true')
      const title = document.createElement('span')
      title.textContent = activity.title
      open.replaceChildren(thumbnail, title)
      row.append(open)
      exercises.append(row)
    }
    return exercises
  }

  function printButton(plan, ownerId) {
    const shared = ownerId !== undefined
    const print = button('Print PDF', async () => {
      print.disabled = true
      try {
        const { token } = shared ? await readReceivedPlanLink(ownerId, plan.id) : await readPlanLink(plan.id)
        await exportTrainingPlan(plan.name, planActivities(plan, shared), token)
      } catch {
        showActionMessage('Could not generate the PDF.')
      } finally {
        print.disabled = false
      }
    })
    print.setAttribute('aria-label', 'Print PDF for ' + plan.name)
    return print
  }

  function showList() {
    document.getElementById('plan-count').textContent = plans.length
    builder.hidden = true
    draggedKey = null
    reorderingKey = null
    dropZone.classList.remove('drag-over')
    planColumns.hidden = false
    list.replaceChildren()
    feedback.textContent = ''
    if (!plans.length) list.textContent = 'No saved practice plans.'

    for (const [index, plan] of plans.entries()) {
      const entry = planCard(plan, index === 0)
      const exercises = exerciseList(plan)
      const actions = document.createElement('div')
      actions.className = 'actions'
      const view = button('View Fullscreen', () => presentPlan(plan.name, planActivities(plan, false)))
      view.className = 'primary'
      const remove = button('Delete Plan', async () => {
        if (saving || !await confirmAction('Delete the plan “' + plan.name + '”?', 'Delete plan', true)) return
        saving = true
        try {
          await deleteRecord('plans', plan.id)
          plans = plans.filter(item => item.id !== plan.id)
          showList()
          showActionMessage('Plan deleted.')
        } catch {
          showActionMessage('Could not delete the plan on the application server.')
        } finally {
          saving = false
        }
      })
      remove.className = 'danger-outline'
      actions.append(view, button('Edit Plan', () => edit(plan)), printButton(plan), button('Share', () => openSharing(plan)), remove)
      entry.append(exercises, actions)
      list.append(entry)
    }
  }

  function sharedKey({ ownerId, drillId }) {
    return 'shared:' + ownerId + ':' + drillId
  }

  function availableDrills() {
    const entries = new Map(getActivities().map(drill => [drill.id, { drill, source: 'My drill' }]))
    for (const { drill, sharedSource } of sharedDrills) {
      entries.set(sharedKey(sharedSource), { drill, sharedSource, source: 'Shared by ' + sharedSource.owner })
    }
    return entries
  }

  function addDrill(key) {
    if (saving || selection.has(key)) return
    const entry = availableDrills().get(key)
    if (!entry) return
    const { drill, sharedSource } = entry
    selection.set(key, sharedSource ? { ...drill, id: newRecordId(), sharedSource } : drill)
    renderBuilder()
  }

  function reorderDrill(key, index) {
    if (saving || !selection.has(key)) return
    const entries = [...selection]
    const current = entries.findIndex(([id]) => id === key)
    if (current === index || index < 0 || index >= entries.length) return
    const [entry] = entries.splice(current, 1)
    entries.splice(index, 0, entry)
    selection = new Map(entries)
    renderBuilder()
  }

  function renderBuilder() {
    choices.replaceChildren()
    for (const [index, [key, drill]] of [...selection].entries()) {
      const row = document.createElement('li')
      row.draggable = !saving
      row.addEventListener('dragstart', event => {
        reorderingKey = key
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', drill.title)
      })
      row.addEventListener('dragend', () => {
        reorderingKey = null
        for (const target of choices.children) target.classList.remove('insert-before', 'insert-after')
      })
      const placement = event => {
        const box = row.getBoundingClientRect()
        return event.clientY >= box.top + box.height / 2
      }
      row.addEventListener('dragover', event => {
        if (!reorderingKey || reorderingKey === key || saving) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const after = placement(event)
        row.classList.toggle('insert-before', !after)
        row.classList.toggle('insert-after', after)
      })
      function clearPlacement() {
        row.classList.remove('insert-before', 'insert-after')
      }
      row.addEventListener('dragleave', event => {
        if (!row.contains(event.relatedTarget)) clearPlacement()
      })
      row.addEventListener('drop', event => {
        if (!reorderingKey || saving) return
        event.preventDefault()
        clearPlacement()
        const dragged = reorderingKey
        reorderingKey = null
        if (dragged === key) return
        const target = index + (placement(event) ? 1 : 0)
        const source = [...selection.keys()].indexOf(dragged)
        reorderDrill(dragged, target - (source < target ? 1 : 0))
      })

      const label = document.createElement('span')
      label.textContent = drill.sharedSource && !currentActivity(drill) ? drill.title + ' · Shared by ' + drill.sharedSource.owner : drill.title
      const controls = document.createElement('div')
      controls.className = 'actions'
      const up = button('↑', () => reorderDrill(key, index - 1))
      up.disabled = saving || index === 0
      up.setAttribute('aria-label', 'Move ' + drill.title + ' up')
      const down = button('↓', () => reorderDrill(key, index + 1))
      down.disabled = saving || index === selection.size - 1
      down.setAttribute('aria-label', 'Move ' + drill.title + ' down')
      const remove = button('Remove', () => {
        if (saving) return
        selection.delete(key)
        renderBuilder()
      })
      controls.append(up, down, remove)
      const content = document.createElement('div')
      content.className = 'selected-drill'
      content.append(label, controls)
      row.append(content)
      choices.append(row)
    }

    renderCatalog()
  }

  function renderCatalog() {
    catalog.replaceChildren()
    const query = catalogSearch.value.trim()
    const matches = drillSearch(query)
    const entries = [...availableDrills()]
      .filter(([, { drill, source }]) => matches(drill, source))
      .sort(([a], [b]) => Number(selection.has(a)) - Number(selection.has(b)))

    if (!entries.length) catalog.textContent = query ? 'No drills match your search.' : 'No drills available.'
    for (const [key, { drill, source }] of entries) {
      const row = document.createElement('article')
      row.className = 'catalog-drill'
      const added = selection.has(key)
      row.draggable = !added && !saving
      row.addEventListener('dragstart', event => {
        draggedKey = key
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData('text/plain', drill.title)
      })
      row.addEventListener('dragend', () => {
        draggedKey = null
        dropZone.classList.remove('drag-over')
      })
      const details = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = drill.title
      const label = document.createElement('p')
      label.textContent = source
      details.append(title, label)
      const add = button(added ? 'Added' : 'Add', () => addDrill(key))
      add.disabled = added || saving
      add.setAttribute('aria-label', (added ? 'Added ' : 'Add ') + drill.title + ' · ' + source)
      row.append(activityThumbnail(drill), details, add)
      catalog.append(row)
    }
  }

  catalogSearch.addEventListener('input', renderCatalog)

  dropZone.addEventListener('dragover', event => {
    if (!draggedKey || saving) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    dropZone.classList.add('drag-over')
  })
  dropZone.addEventListener('dragleave', event => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('drag-over')
  })
  dropZone.addEventListener('drop', event => {
    if (!draggedKey || saving) return
    event.preventDefault()
    dropZone.classList.remove('drag-over')
    const key = draggedKey
    draggedKey = null
    addDrill(key)
  })

  function edit(plan) {
    if (saving) return
    editingId = plan?.id ?? null
    name.value = plan?.name ?? ''
    catalogSearch.value = ''
    name.setCustomValidity('')
    selection = new Map((plan?.activities ?? []).map(entry => {
      const current = currentActivity(entry)
      const key = !current && entry.sharedSource ? sharedKey(entry.sharedSource) : entry.id
      return [key, current ?? entry]
    }))
    feedback.textContent = ''
    planColumns.hidden = true
    builder.hidden = false
    renderBuilder()
    name.focus()
  }

  name.addEventListener('input', () => name.setCustomValidity(''))
  let newPlanId
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (saving) return
    const trimmed = name.value.trim()
    if (!trimmed) {
      name.setCustomValidity('Enter a name for the plan.')
      name.reportValidity()
      return
    }
    if (!selection.size) {
      showActionMessage('Select at least one drill.')
      return
    }
    const plan = {
      id: editingId ?? (newPlanId ??= newRecordId()),
      name: trimmed,
      activities: [...selection.values()],
    }
    saving = true
    const controls = form.querySelectorAll('input, button')
    for (const control of controls) control.disabled = true
    try {
      const saved = await saveRecord('plans', plan)
      plans = [saved, ...plans.filter(item => item.id !== plan.id)]
      newPlanId = null
      showList()
      showActionMessage('Plan saved.')
    } catch (error) {
      if (!showPlanLimit(error)) showActionMessage(error.message || 'Could not save the plan. Try again.')
    } finally {
      saving = false
      for (const control of controls) control.disabled = false
      if (!builder.hidden) renderBuilder()
    }
  })

  document.getElementById('new-plan').addEventListener('click', () => {
    if (saving) return
    newPlanId = null
    edit()
  })
  document.getElementById('cancel-plan').addEventListener('click', () => showList())

  async function refreshShared() {
    const version = ++sharedVersion
    try {
      const { plans: shared } = await readSharedPlans()
      if (version !== sharedVersion) return
      sharedDrills = shared.flatMap(({ owner, owner_id: ownerId, plan }) =>
        plan.activities.map(drill => ({ drill, sharedSource: { owner, ownerId, drillId: drill.id } })))
      if (!builder.hidden) renderBuilder()
      sharedStatus.textContent = ''
      sharedList.replaceChildren()
      if (!shared.length) sharedList.textContent = 'No practice plans have been shared with you.'
      for (const [index, { owner, owner_id: ownerId, plan }] of shared.entries()) {
        const card = planCard(plan, index === 0)
        const byline = document.createElement('p')
        byline.className = 'shared-plan-owner'
        byline.textContent = 'Shared by ' + owner + ' · Read-only'
        const actions = document.createElement('div')
        actions.className = 'actions'
        const copyId = newRecordId()
        const copy = button('Copy to My Account', async () => {
          copy.disabled = remove.disabled = true
          try {
            await copySharedPlan(ownerId, plan.id, copyId)
            await refreshLibrary()
            showActionMessage('Plan and drills copied to your account.')
            copy.textContent = 'Copied to My Account'
          } catch (error) {
            if (!showPlanLimit(error)) showActionMessage(error.message)
            copy.disabled = false
          } finally {
            remove.disabled = false
          }
        })
        copy.className = 'primary'
        const remove = button('Remove from Shared with me', async () => {
          if (!await confirmAction('Remove “' + plan.name + '” from Shared with me? Any copies in your account will be kept.', 'Remove plan', true)) return
          const copyWasDisabled = copy.disabled
          remove.disabled = copy.disabled = true
          try {
            await removeReceivedShare(ownerId, plan.id)
            await refreshShared()
            showActionMessage('Plan removed from Shared with me.')
          } catch (error) {
            showActionMessage(error.message)
            remove.disabled = false
            copy.disabled = copyWasDisabled
          }
        })
        actions.append(button('View Fullscreen', () => presentPlan(plan.name, plan.activities)), printButton(plan, ownerId), copy, remove)
        card.querySelector('summary > div').append(byline)
        card.append(exerciseList(plan, true), actions)
        sharedList.append(card)
      }
    } catch (error) {
      if (version === sharedVersion) {
        sharedDrills = []
        if (!builder.hidden) renderBuilder()
        sharedList.replaceChildren()
        sharedStatus.textContent = error.message
      }
    }
  }

  function refresh(records) {
    if (saving) return
    plans = records
    if (builder.hidden) showList()
    else renderBuilder()
  }

  return { refresh, refreshShared }
}

let activities = []
const { refresh, refreshShared } = setupPlans({ getActivities: () => activities, refreshLibrary })

async function refreshLibrary() {
  try {
    const data = await readLibrary()
    activities = data.drills
    document.getElementById('activity-count').textContent = activities.length
    refresh(data.plans)
  } catch (error) {
    document.getElementById('plan-status').textContent = 'Could not load the practice plans.'
    throw error
  }
}

await prepareLibrary()
await Promise.allSettled([refreshLibrary(), refreshShared()])
