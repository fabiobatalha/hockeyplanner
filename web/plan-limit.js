import { openTimedDialog } from './action-message.js'

const get = id => document.getElementById(id)
const dialog = get('plan-limit-dialog')

get('compare-plan-limits').addEventListener('click', () => dialog.close())

export function showPlanLimit(error) {
  if (error.code !== 'plan_limit' || !error.capacity) return false

  const { collection, limit, used, requested } = error.capacity
  const drill = collection === 'drills'
  const singular = drill ? 'drill' : 'practice plan'
  const plural = drill ? 'drills' : 'practice plans'
  const location = drill ? 'Drill Library' : 'Practice Plans under My plans'
  const required = used + requested - limit
  get('plan-limit-title').textContent = used >= limit
    ? (drill ? 'Drill limit reached' : 'Practice plan limit reached')
    : 'Not enough room for ' + plural
  get('plan-limit-count').textContent = used + ' of ' + limit + ' ' + plural + ' saved'
  const meter = get('plan-limit-meter')
  meter.max = limit
  meter.value = Math.min(used, limit)
  const guidance = required === 1 ? 'one saved ' + singular : required + ' saved ' + plural
  get('plan-limit-guidance').textContent = requested > limit
    ? 'This action would add ' + requested + ' ' + plural + '. Try adding fewer at once.'
    : 'Delete ' + guidance + ' from ' + location + ' to make room, then try again.'
  openTimedDialog(dialog)
  return true
}

