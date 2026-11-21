import { setupPlanSharing } from './plan-sharing.js'
import { copySharedPlan, deleteRecord, readSharedPlans, removeReceivedShare, saveRecord } from './library.js'
import { newRecordId } from './record-id.js'
import { exportTrainingPlan } from './export.js'
import { activityThumbnail, drawItem, drawRink, rinkHeight, rinkWidth } from './drawing.js'
import { drillSearch, markdownText } from './markdown.js'

export function setupPlans({ getActivities, openActivity, refreshLibrary }) {
  const viewer = document.getElementById('plan-viewer')
  const presentation = document.getElementById('plan-presentation')
  const viewerTitle = document.getElementById('plan-viewer-title')
  const viewerActivities = document.getElementById('plan-viewer-activities')
  const previous = document.getElementById('plan-viewer-prev')
  const next = document.getElementById('plan-viewer-next')
  const position = document.getElementById('plan-viewer-position')
  let displayedActivities = []
  let activityIndex = 0
  let presentationWasFullscreen = false

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === presentation) presentationWasFullscreen = true
    else if (presentationWasFullscreen) {
      presentationWasFullscreen = false
      if (viewer.open) viewer.close()
    }
  })
  viewer.addEventListener('close', () => {
    if (document.fullscreenElement === presentation) document.exitFullscreen().catch(() => {})
    viewerActivities.replaceChildren()
    displayedActivities = []
  })

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

  function currentActivity(entry) {
    return getActivities().find(activity => activity.id === entry.id)
  }

  function showActivity(index) {
    const activity = displayedActivities[index]
    if (!activity) return
    activityIndex = index
    const section = document.createElement('article')
    section.className = 'plan-viewer-activity'
    const title = document.createElement('h3')
    title.textContent = activity.title

    const diagram = document.createElement('canvas')
    diagram.width = rinkWidth(activity.layout)
    diagram.height = rinkHeight(activity.layout)
    diagram.style.setProperty('--diagram-ratio', diagram.width / diagram.height)
    diagram.setAttribute('aria-label', 'Rink diagram for ' + activity.title)
    const context = diagram.getContext('2d')
    drawRink(context)
    for (const item of activity.items) drawItem(context, item)
    section.append(title, diagram)

    const description = markdownText(activity.description ?? '').trim()
    if (description) {
      const text = document.createElement('p')
      text.className = 'plan-viewer-description'
      text.textContent = description
      section.append(text)
    }
    viewerActivities.replaceChildren(section)
    viewerActivities.scrollTop = 0
    position.textContent = (index + 1) + ' of ' + displayedActivities.length
    const focusedControl = document.activeElement
    previous.disabled = index === 0
    next.disabled = index === displayedActivities.length - 1
    if ((focusedControl === previous && previous.disabled) || (focusedControl === next && next.disabled)) {
      viewerActivities.focus({ preventScroll: true })
    }
  }

  previous.addEventListener('click', () => showActivity(activityIndex - 1))
  next.addEventListener('click', () => showActivity(activityIndex + 1))
  presentation.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    showActivity(activityIndex + (event.key === 'ArrowRight' ? 1 : -1))
  })

  function planActivities(plan, shared) {
    return shared ? plan.activities : plan.activities.map(saved => currentActivity(saved) ?? saved)
  }

  async function present(plan, shared = false) {
    viewerTitle.textContent = plan.name
    displayedActivities = planActivities(plan, shared)
    showActivity(0)
    viewer.showModal()
    viewerActivities.focus({ preventScroll: true })
    if (document.fullscreenEnabled && presentation.requestFullscreen) {
      try {
        await presentation.requestFullscreen()
      } catch {
        // The open dialog still fills the browser viewport.
      }
    }
  }

  function exerciseList(plan, readOnly = false) {
    const exercises = document.createElement('ol')
    for (const saved of plan.activities) {
      const row = document.createElement('li')
      const activity = readOnly ? saved : currentActivity(saved) ?? saved
      const open = readOnly ? document.createElement('div') : button(activity.title, () => {
        const current = currentActivity(saved)
        openActivity(current ?? { ...saved, id: null })
      })
      open.className = 'plan-drill'
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

  function printButton(plan, shared = false) {
    const status = shared ? sharedStatus : feedback
    const print = button('Print PDF', async () => {
      print.disabled = true
      status.textContent = 'Generating the plan PDF…'
      try {
        await exportTrainingPlan(plan.name, planActivities(plan, shared))
        status.textContent = 'Plan PDF ready.'
      } catch {
        status.textContent = 'Could not generate the plan PDF.'
      } finally {
        print.disabled = false
      }
    })
    print.setAttribute('aria-label', 'Print PDF for ' + plan.name)
    return print
  }

  function showList(message = '') {
    builder.hidden = true
    draggedKey = null
    reorderingKey = null
    dropZone.classList.remove('drag-over')
    planColumns.hidden = false
    list.replaceChildren()
    feedback.textContent = message
    if (!plans.length) list.textContent = 'No saved practice plans.'

    for (const plan of plans) {
      const entry = document.createElement('article')
      entry.className = 'card plan-entry'
      const heading = document.createElement('h3')
      heading.textContent = plan.name
      const exercises = exerciseList(plan)
      const actions = document.createElement('div')
      actions.className = 'actions'
      const view = button('View Fullscreen', () => present(plan))
      view.className = 'primary'
      actions.append(view, button('Edit Plan', () => edit(plan)), button('Delete Plan', async () => {
        if (saving || !confirm('Delete the plan “' + plan.name + '”?')) return
        saving = true
        try {
          await deleteRecord('plans', plan.id)
          plans = plans.filter(item => item.id !== plan.id)
          showList('Plan deleted.')
        } catch {
          feedback.textContent = 'Could not delete the plan on the application server.'
        } finally {
          saving = false
        }
      }))
      actions.append(printButton(plan), button('Share', () => openSharing(plan)))
      entry.append(heading, exercises, actions)
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
    feedback.textContent = drill.title + ' added to the plan.'
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
    feedback.textContent = entry[1].title + ' moved to position ' + (index + 1) + '.'
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
        feedback.textContent = drill.title + ' removed from the plan.'
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
      feedback.textContent = 'Select at least one drill.'
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
      await saveRecord('plans', plan)
      plans = [plan, ...plans.filter(item => item.id !== plan.id)]
      newPlanId = null
      showList('Plan saved.')
    } catch {
      feedback.textContent = 'Could not save the plan on the application server. Try again.'
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

  async function refreshShared(message = '') {
    const version = ++sharedVersion
    try {
      const { plans: shared } = await readSharedPlans()
      if (version !== sharedVersion) return
      sharedDrills = shared.flatMap(({ owner, owner_id: ownerId, plan }) =>
        plan.activities.map(drill => ({ drill, sharedSource: { owner, ownerId, drillId: drill.id } })))
      if (!builder.hidden) renderBuilder()
      sharedStatus.textContent = message
      sharedList.replaceChildren()
      if (!shared.length) sharedList.textContent = 'No practice plans have been shared with you.'
      for (const { owner, owner_id: ownerId, plan } of shared) {
        const card = document.createElement('article')
        card.className = 'card plan-entry'
        const heading = document.createElement('h3')
        heading.textContent = plan.name
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
            sharedStatus.textContent = 'Plan and drills copied to your account.'
            copy.textContent = 'Copied to My Account'
          } catch (error) {
            sharedStatus.textContent = error.message
            copy.disabled = false
          } finally {
            remove.disabled = false
          }
        })
        copy.className = 'primary'
        const remove = button('Remove from Shared with me', async () => {
          if (!confirm('Remove “' + plan.name + '” from Shared with me? Any copies in your account will be kept.')) return
          const copyWasDisabled = copy.disabled
          remove.disabled = copy.disabled = true
          try {
            await removeReceivedShare(ownerId, plan.id)
            await refreshShared('Plan removed from Shared with me.')
          } catch (error) {
            sharedStatus.textContent = error.message
            remove.disabled = false
            copy.disabled = copyWasDisabled
          }
        })
        actions.append(button('View Fullscreen', () => present(plan, true)), printButton(plan, true), copy, remove)
        card.append(heading, byline, exerciseList(plan, true), actions)
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
