import { gettext } from './i18n.js'
import { showActionMessage } from './action-message.js'
import { importLegacyLibrary } from './library.js'
import { showPlanLimit } from './plan-limit.js'

export async function prepareLibrary() {
  try {
    await importLegacyLibrary()
  } catch (error) {
    if (!showPlanLimit(error)) showActionMessage(gettext('Could not import drills and plans from this browser.') + ' ' + error.message)
  }
}
