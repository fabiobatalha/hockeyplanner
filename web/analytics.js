const { measurementId } = document.getElementById('google-analytics').dataset
const pageLocation = location.origin + location.pathname

window.dataLayer = window.dataLayer || []
function gtag() {
  window.dataLayer.push(arguments)
}
gtag('js', new Date())
gtag('config', measurementId, {
  send_page_view: false,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
  ignore_referrer: true,
  page_referrer: '',
  page_location: pageLocation,
})
gtag('event', 'page_view', {
  page_location: pageLocation,
  page_title: document.title,
  page_referrer: '',
})

const tag = document.createElement('script')
tag.async = true
tag.referrerPolicy = 'no-referrer'
tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId)
document.head.append(tag)
