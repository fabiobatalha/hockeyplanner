import { gettext, ngettext } from './i18n.js'
import { openTimedDialog } from './action-message.js'

const get = id => document.getElementById(id)
const dialog = get('plan-limit-dialog')

get('compare-plan-limits').addEventListener('click', () => dialog.close())

export function showPlanLimit(error) {
  if (error.code !== 'plan_limit' || !error.capacity) return false

  const { collection, limit, used, requested } = error.capacity
  const drill = collection === 'drills'
  const required = used + requested - limit
  get('plan-limit-title').textContent = used >= limit
    ? (drill ? gettext('Drill limit reached') : gettext('Practice plan limit reached'))
    : (drill ? gettext('Not enough room for these drills') : gettext('Not enough room for these practice plans'))
  get('plan-limit-count').textContent = drill
    ? gettext('%(used)d of %(limit)d drills saved', { used, limit })
    : gettext('%(used)d of %(limit)d practice plans saved', { used, limit })
  const meter = get('plan-limit-meter')
  meter.max = limit
  meter.value = Math.min(used, limit)
  const guidance = drill
    ? ngettext('Delete one saved drill from the Drill Library to make room, then try again.',
      'Delete %(count)d saved drills from the Drill Library to make room, then try again.', required)
    : ngettext('Delete one saved practice plan from My plans to make room, then try again.',
      'Delete %(count)d saved practice plans from My plans to make room, then try again.', required)
  get('plan-limit-guidance').textContent = requested > limit
    ? (drill ? gettext('This action would add too many drills. Try adding fewer at once.')
      : gettext('This action would add too many practice plans. Try adding fewer at once.'))
    : guidance
  openTimedDialog(dialog)
  return true
}
