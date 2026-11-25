import { gettext } from './i18n.js'
import {
  CrepeBuilder, editorViewCtx, linkTooltip, listItem, placeholder, replaceAll, table, topBar, uploadConfig,
} from './vendor/milkdown-7.23.0.mjs'

export async function setupDescriptionEditor(visual, source, mode) {
  const editor = new CrepeBuilder({ root: visual })
    .addFeature(placeholder, { text: source.placeholder, mode: 'doc' })
    .addFeature(listItem)
    .addFeature(linkTooltip, { inputPlaceholder: gettext('Paste link...') })
    .addFeature(table)
    .addFeature(topBar, {
      headingOptions: [
        { label: gettext('Paragraph'), level: null },
        ...[1, 2, 3, 4, 5, 6].map(level => ({ label: gettext('Heading %(level)d', { level }), level })),
      ],
    })

  editor.editor.config(ctx => {
    ctx.update(uploadConfig.key, options => ({ ...options, uploader: async () => [] }))
  })

  try {
    await editor.create()
  } catch (error) {
    console.error(gettext('Could not start the visual Markdown editor.'), error)
    visual.hidden = mode.hidden = true
    source.hidden = false
    return {
      getValue: () => source.value,
      setValue: markdown => { source.value = markdown },
    }
  }

  const view = editor.editor.action(ctx => ctx.get(editorViewCtx))
  view.setProps({ attributes: { role: 'textbox', 'aria-labelledby': 'description-label', 'aria-multiline': 'true' } })
  let visualBaseline = editor.getMarkdown()

  function loadVisual() {
    editor.editor.action(replaceAll(source.value, true))
    visualBaseline = editor.getMarkdown()
  }

  function getValue() {
    if (!visual.hidden) {
      const markdown = editor.getMarkdown()
      if (markdown !== visualBaseline) return markdown
    }
    return source.value
  }

  mode.addEventListener('click', () => {
    if (visual.hidden) {
      loadVisual()
      source.hidden = true
      visual.hidden = false
      mode.textContent = gettext('Edit Markdown')
      view.focus()
    } else {
      source.value = getValue()
      visual.hidden = true
      source.hidden = false
      mode.textContent = gettext('Edit Visually')
      source.focus()
    }
  })
  mode.disabled = false

  return {
    getValue,
    setValue(markdown) {
      source.value = markdown
      if (!visual.hidden) loadVisual()
    },
  }
}
