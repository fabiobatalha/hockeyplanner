import { drawItem, drawRink } from './drawing.js'

const canvas = document.getElementById('welcome-rink')
const context = canvas.getContext('2d')
drawRink(context)

const drill = JSON.parse(document.getElementById('welcome-sample').textContent)
for (const item of drill.items) drawItem(context, item)
