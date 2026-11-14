import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from 'react'
import {
  MAX_GIF_BYTES,
  MAX_GIF_URL_BYTES,
  MAX_MESSAGE_LENGTH,
  type GifSource,
} from '../features/messages/messages.types'

type ChatComposerInputProps = {
  value: string
  onChange: (value: string) => void
  onGif: (source: GifSource) => void
  onGifError: (message: string) => void
  disabled?: boolean
}

const editorClassName =
  'max-h-32 min-h-11 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap wrap-anywhere px-1 py-2.5 text-base leading-6 text-[#171b20] outline-none empty:before:pointer-events-none empty:before:text-[#68707a] empty:before:content-[attr(data-placeholder)] sm:min-h-12 sm:py-3'

const giphyMediaHost = /^(?:i|media\d*)\.giphy\.com$/
const gifFileName = /\.gif$/i
const localGifPath = /^(?:file:|[a-z]:[\\/]|\\\\)[^\r\n]*\.gif$/i
const attachSavedGif = 'Attach the saved GIF with the paperclip, or drop the GIF file here.'

type IncomingGif = GifSource | { kind: 'local-path' }

function directGifUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_GIF_URL_BYTES || /\s/.test(trimmed)) return null

  try {
    const url = new URL(trimmed)
    if (
      url.protocol === 'https:' &&
      giphyMediaHost.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.pathname.endsWith('.gif')
    ) {
      return url.href
    }
  } catch {
    return null
  }
  return null
}

function gifFromText(values: string[]): IncomingGif | null {
  const url = values.map(directGifUrl).find(Boolean)
  if (url) return { kind: 'url', url }

  return values.some((value) => localGifPath.test(value.trim())) ? { kind: 'local-path' } : null
}

function gifFromTransfer(data: DataTransfer): IncomingGif | null {
  const file = Array.from(data.files).find(
    (item) => item.type === 'image/gif' || gifFileName.test(item.name),
  )
  if (file) return { kind: 'file', file }

  const uris = data.getData('text/uri-list').split(/\r?\n/).filter((line) => !line.startsWith('#'))
  const values = [data.getData('text/plain'), ...uris]

  const html = data.getData('text/html')
  if (html) {
    // The detached template lets us inspect the source without inserting pasted markup.
    const template = document.createElement('template')
    template.innerHTML = html
    values.push(template.content.querySelector('img')?.getAttribute('src') ?? '')
  }

  return gifFromText(values)
}

function replaceSelection(editor: HTMLElement, text: string) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    editor.append(document.createTextNode(text))
    return
  }

  const range = selection.getRangeAt(0)
  range.deleteContents()
  if (text) {
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
  }
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function writeEditor(editor: HTMLElement, text: string, moveCaret: boolean) {
  editor.textContent = text
  if (!moveCaret || document.activeElement !== editor) return

  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function ChatComposerInput({
  value,
  onChange,
  onGif,
  onGifError,
  disabled = false,
}: ChatComposerInputProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const editorValue = useRef('')

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (editor && editorValue.current !== value) {
      writeEditor(editor, value, true)
      editorValue.current = value
    }
  }, [value])

  useEffect(() => {
    if (disabled) editorRef.current?.blur()
  }, [disabled])

  function acceptGif(source: IncomingGif) {
    if (source.kind === 'local-path') {
      onGifError(attachSavedGif)
      return
    }

    if (source.kind === 'file' && source.file.size > MAX_GIF_BYTES) {
      onGifError('Choose a GIF smaller than or equal to 2 MiB.')
      return
    }
    onGif(source)
  }

  function readText(editor: HTMLDivElement) {
    const text = editor.innerText.replace(/\r\n/g, '\n')
    const limited = text.slice(0, MAX_MESSAGE_LENGTH)
    if (limited !== text || (!limited && editor.childNodes.length)) {
      writeEditor(editor, limited, true)
    }
    editorValue.current = limited
    onChange(limited)
  }

  function handleInput(event: FormEvent<HTMLDivElement>) {
    const input = event.nativeEvent as InputEvent
    if (disabled || input.isComposing) return

    const editor = event.currentTarget
    const image = editor.querySelector('img')
    const transferred = input.dataTransfer ? gifFromTransfer(input.dataTransfer) : null
    const source = transferred ?? gifFromText([image?.getAttribute('src') ?? editor.innerText])
    if (source) {
      writeEditor(editor, value, true)
      acceptGif(source)
      return
    }

    if (image) {
      writeEditor(editor, value, true)
      onGifError('Paste a GIF file or a direct GIPHY GIF link.')
      return
    }

    readText(editor)
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    if (disabled) return

    const source = gifFromTransfer(event.clipboardData)
    if (source) {
      acceptGif(source)
      return
    }

    const text = event.clipboardData.getData('text/plain')
    if (text) {
      replaceSelection(event.currentTarget, text)
      readText(event.currentTarget)
    } else if (event.clipboardData.files.length) {
      onGifError('Paste the original GIF file or its direct GIPHY link.')
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (disabled) return

    const source = gifFromTransfer(event.dataTransfer)
    if (source) {
      acceptGif(source)
    } else if (event.dataTransfer.files.length) {
      onGifError('Drop a GIF file to attach it.')
    }
  }

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-label="Message"
      aria-multiline="true"
      aria-disabled={disabled}
      contentEditable={!disabled}
      data-placeholder="Type a message…"
      onInput={handleInput}
      onCompositionEnd={(event) => readText(event.currentTarget)}
      onPaste={handlePaste}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      className={editorClassName}
    />
  )
}
