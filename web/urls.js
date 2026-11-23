const root = new URL(document.body.dataset.root, location.origin)

export function appUrl(path = '') {
  return new URL(path.replace(/^\//, ''), root)
}
