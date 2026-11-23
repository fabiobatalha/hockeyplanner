const dialog = document.getElementById('action-message')
const body = document.getElementById('action-message-body')
const countdown = document.getElementById('action-message-countdown')
const messageDuration = 10000
const timers = new WeakMap()

export function openTimedDialog(target) {
  if (!target.open) target.showModal()
  clearTimeout(timers.get(target))
  timers.set(target, setTimeout(() => target.close(), messageDuration))
}

function stopCountdown() {
  for (const animation of countdown.getAnimations()) animation.cancel()
}

dialog.addEventListener('close', () => {
  if (!dialog.open) stopCountdown()
})

export function showActionMessage(message) {
  if (!message) return
  body.textContent = message
  openTimedDialog(dialog)
  stopCountdown()
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    countdown.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: messageDuration, fill: 'forwards',
    })
  }
}

const messageKey = 'hockeyplanner.action-message'

export function navigateWithMessage(url, message) {
  try {
    sessionStorage.setItem(messageKey, message)
  } catch {
    // Navigation still works when browser storage is unavailable.
  }
  location.replace(url)
}

export function restoreActionMessage() {
  let message
  try {
    message = sessionStorage.getItem(messageKey)
    sessionStorage.removeItem(messageKey)
  } catch {
    return
  }
  showActionMessage(message)
}
