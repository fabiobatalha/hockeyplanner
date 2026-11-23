import qrcode from './vendor/qrcode-generator-2.0.4.mjs'

export const signupUrl = 'https://hockeyplanner.ca/register'

export function makeQr(url) {
  const code = qrcode(0, 'M')
  code.addData(url)
  code.make()
  return code
}

export function drawQr(ctx, code, center, top, size) {
  const modules = code.getModuleCount()
  const cell = Math.floor(size / (modules + 8) * 2) / 2
  const extent = (modules + 8) * cell
  const left = Math.round((center - extent / 2) * 2) / 2
  ctx.fillStyle = 'white'
  ctx.fillRect(left, top, extent, extent)
  ctx.fillStyle = 'black'
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (code.isDark(row, col)) ctx.fillRect(left + (col + 4) * cell, top + (row + 4) * cell, cell, cell)
    }
  }
}
