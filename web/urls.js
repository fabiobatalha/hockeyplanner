const root = new URL(document.body.dataset.root, location.origin)

export function appUrl(path = '') {
  return new URL(path.replace(/^\//, ''), root)
}

export function publicUrl(path = '') {
  return new URL(path.replace(/^\//, ''), document.body.dataset.publicRoot)
}
