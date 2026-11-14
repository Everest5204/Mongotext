import { useRef, useState, type FormEvent } from 'react'
import { attachmentErrorText, gifErrorText, messageErrorText } from '../features/messages/messages.api'
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_TOTAL_BYTES,
  type AttachmentKind,
  type GifSource,
  type MessageContent,
} from '../features/messages/messages.types'
import { ChatAttachmentPreview, type DraftAttachment } from './ChatAttachmentPreview'
import { ChatComposerInput } from './ChatComposerInput'
import { ChatGifPicker } from './ChatGifPicker'

type ChatComposerProps = {
  canSend: boolean
  onSend: (content: MessageContent, clientMessageId: string) => Promise<void>
}

type PendingDraft = {
  text: string
  attachmentIds: string
  requestId: string
}

type GifAttempt = { source: GifSource; requestId: string }
type FailedGif = GifAttempt & { message: string }

const attachmentFormats: ReadonlyArray<[AttachmentKind, string, ...string[]]> = [
  ['image', 'image/jpeg', '.jpg', '.jpeg'],
  ['image', 'image/png', '.png'],
  ['image', 'image/webp', '.webp'],
  ['image', 'image/gif', '.gif'],
  ['image', 'image/avif', '.avif'],
  ['audio', 'audio/mpeg', '.mp3'],
  ['audio', 'audio/mp4', '.m4a'],
  ['audio', 'audio/wav', '.wav'],
  ['audio', 'audio/ogg', '.ogg', '.oga', '.opus'],
  ['audio', 'audio/webm'],
  ['video', 'video/mp4', '.mp4', '.m4v'],
  ['video', 'video/webm', '.webm'],
  ['video', 'video/quicktime', '.mov'],
]
const attachmentAccept = attachmentFormats.flatMap(([, ...specifiers]) => specifiers).join(',')
const sendFallback = 'Could not confirm sending. Try again.'

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const fieldButtonClassName =
  'mb-0.5 grid size-10 shrink-0 place-items-center rounded-full text-[#68707a] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#e60023] disabled:opacity-60 sm:size-11'

function attachmentKind(file: File) {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  const byType = attachmentFormats.find(([, mime]) => mime === file.type.toLowerCase())
  const byExtension = extension
    ? attachmentFormats.find(([, , ...extensions]) => extensions.includes(extension))
    : undefined
  return (byType ?? byExtension)?.[0]
}

function newMessageId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : sendFallback
}

export function ChatComposer({ canSend, onSend }: ChatComposerProps) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
  const [failedGif, setFailedGif] = useState<FailedGif | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)
  const pendingDraft = useRef<PendingDraft | null>(null)
  const pendingPickerGifs = useRef(new Map<string, string>())
  const text = draft.trim()
  const hasContent = text.length > 0 || attachments.length > 0

  function openFiles() {
    if (!sendingRef.current) fileInputRef.current?.click()
  }

  function addFiles(files: File[]) {
    if (!files.length || sendingRef.current) return

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setError(`Choose up to ${MAX_ATTACHMENTS} attachments per message.`)
      return
    }

    const totalBytes = attachments.reduce((sum, { file }) => sum + file.size, 0)
      + files.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      setError(`Attachments can total up to ${MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024)} MiB per message.`)
      return
    }

    const additions: DraftAttachment[] = []
    for (const file of files) {
      const kind = attachmentKind(file)
      if (!kind || file.size === 0) {
        setError(`Choose a supported, nonempty photo, audio file, or video. Could not add ${file.name}.`)
        return
      }
      additions.push({ id: newMessageId(), kind, file })
    }

    setAttachments((current) => [...current, ...additions])
    setError('')
  }

  async function sendMessage(content: MessageContent, requestId: string) {
    if (sendingRef.current) throw new Error('Wait until the current message finishes sending.')
    if (!canSend) throw new Error('Wait for the chat to reconnect.')

    sendingRef.current = true
    setIsSending(true)
    try {
      await onSend(content, requestId)
    } catch (failure) {
      const describeError = typeof content === 'string'
        ? messageErrorText
        : content.kind === 'attachments' ? attachmentErrorText : gifErrorText
      throw new Error(describeError(failure, sendFallback))
    } finally {
      sendingRef.current = false
      setIsSending(false)
    }
  }

  async function sendPickerGif(gifId: string) {
    const pending = pendingPickerGifs.current
    const requestId = pending.get(gifId) ?? newMessageId()
    pending.set(gifId, requestId)

    await sendMessage({ kind: 'giphy', id: gifId }, requestId)
    pending.delete(gifId)
  }

  async function sendInputGif(attempt: GifAttempt) {
    setFailedGif(null)
    setError('')

    try {
      await sendMessage(attempt.source, attempt.requestId)
    } catch (failure) {
      setFailedGif({ ...attempt, message: errorMessage(failure) })
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasContent || !canSend || sendingRef.current) return

    setError('')
    const attachmentIds = attachments.map(({ id }) => id).join(',')
    const previous = pendingDraft.current
    const requestId = previous?.text === text && previous.attachmentIds === attachmentIds
      ? previous.requestId
      : newMessageId()
    pendingDraft.current = { text, attachmentIds, requestId }

    const content: MessageContent = attachments.length
      ? { kind: 'attachments', files: attachments.map(({ file }) => file), text }
      : text

    try {
      await sendMessage(content, requestId)
      pendingDraft.current = null
      setAttachments([])
      setDraft((current) => current === draft ? '' : current)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return (
    <footer className="min-w-0 shrink-0 border-t border-[#eceef0] bg-white px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {error && <p role="alert" className="pb-2 text-xs font-medium text-[#a62943]">{error}</p>}
      {failedGif && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#a62943]">
          <p role="alert">{failedGif.message}</p>
          <button type="button" onClick={() => void sendInputGif(failedGif)} disabled={!canSend || isSending} className="font-semibold underline disabled:opacity-60">
            Retry GIF
          </button>
          <button type="button" onClick={() => setFailedGif(null)} className="text-[#68707a] underline">
            Dismiss
          </button>
        </div>
      )}
      {isSending && !pickerOpen && (
        <p role="status" className="pb-2 text-xs text-[#68707a]">Sending…</p>
      )}

      <ChatAttachmentPreview
        attachments={attachments}
        onAdd={openFiles}
        onRemove={(id) => {
          if (sendingRef.current) return
          setAttachments((current) => current.filter((attachment) => attachment.id !== id))
          setError('')
        }}
        disabled={isSending}
      />

      <form className="flex min-w-0 items-end gap-2 sm:gap-3" onSubmit={(event) => void handleSubmit(event)}>
        <input
          ref={fileInputRef}
          type="file"
          accept={attachmentAccept}
          multiple
          hidden
          onChange={(event) => {
            const input = event.currentTarget
            const files = Array.from(input.files ?? [])
            input.value = ''
            addFiles(files)
          }}
        />

        <div className="flex min-w-0 flex-1 items-end rounded-3xl bg-[#f0f1f3] px-1 focus-within:ring-2 focus-within:ring-[#e60023]/25">
          <button
            type="button"
            aria-label="Attach photos, audio or video"
            onClick={openFiles}
            disabled={isSending}
            className={fieldButtonClassName}
          >
            <svg {...iconProps} className="size-5">
              <path d="M20 11.5 11.4 20a4.5 4.5 0 0 1-6.4-6.4l9.4-9.4a3 3 0 0 1 4.2 4.2l-9 9a1.5 1.5 0 0 1-2.1-2.1l7.8-7.8" />
            </svg>
          </button>

          <ChatComposerInput
            value={draft}
            onChange={(value) => {
              setDraft(value)
              setError('')
            }}
            onGif={(source) => void sendInputGif({ source, requestId: newMessageId() })}
            onGifError={setError}
          />

          <button
            type="button"
            aria-label="Open GIF picker"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen(true)}
            disabled={isSending && !pickerOpen}
            className={fieldButtonClassName}
          >
            <span className="rounded border border-current px-1 text-[11px] leading-4 font-bold">GIF</span>
          </button>
        </div>

        <button
          type={hasContent ? 'submit' : 'button'}
          aria-label={hasContent ? 'Send message' : 'Record a voice message'}
          disabled={!hasContent || !canSend || isSending}
          className={`grid size-11 shrink-0 place-items-center rounded-full bg-[#e60023] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e60023] sm:size-12 ${hasContent ? 'disabled:opacity-60' : ''}`}
        >
          <svg {...iconProps} className="size-5 sm:size-6">
            {hasContent ? (
              <path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" />
            ) : (
              <>
                <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
                <path d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5v3" />
              </>
            )}
          </svg>
        </button>
      </form>

      {pickerOpen && (
        <ChatGifPicker
          canSend={canSend && !isSending}
          onClose={() => setPickerOpen(false)}
          onSelect={sendPickerGif}
        />
      )}
    </footer>
  )
}