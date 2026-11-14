import { useLayoutEffect, useRef, useState } from 'react'
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_TOTAL_BYTES,
  type AttachmentKind,
} from '../features/messages/messages.types'

export type DraftAttachment = {
  id: string
  kind: AttachmentKind
  file: File
}

type ChatAttachmentPreviewProps = {
  attachments: readonly DraftAttachment[]
  onAdd: () => void
  onRemove: (id: string) => void
  disabled?: boolean
}

type AttachmentTileProps = {
  attachment: DraftAttachment
  onRemove: (id: string) => void
  disabled: boolean
}

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function AttachmentTile({ attachment: { id, kind, file }, onRemove, disabled }: AttachmentTileProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failedFile, setFailedFile] = useState<File | null>(null)
  const failed = failedFile === file

  useLayoutEffect(() => {
    const media = imageRef.current ?? videoRef.current
    if (!media) return

    const url = URL.createObjectURL(file)
    media.src = url
    return () => URL.revokeObjectURL(url)
  }, [file, kind, failed])

  return (
    <li className="relative w-24 shrink-0 sm:w-28">
      <div className="relative grid aspect-4/3 place-items-center overflow-hidden rounded-xl bg-[#f0f1f3] text-[#68707a]">
        {kind === 'image' && !failed && (
          <img
            ref={imageRef}
            alt=""
            decoding="async"
            onError={() => setFailedFile(file)}
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {kind === 'video' && !failed && (
          <>
            <video
              ref={videoRef}
              preload="metadata"
              muted
              playsInline
              aria-hidden="true"
              onError={() => setFailedFile(file)}
              className="absolute inset-0 size-full object-cover"
            />
            <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] leading-4 text-white">
              Video
            </span>
          </>
        )}
        {kind === 'audio' && (
          <div className="flex flex-col items-center gap-1 text-xs">
            <svg {...iconProps} className="size-5">
              <path d="M9 18V5l12-2v13M9 9l12-2" />
              <ellipse cx="6" cy="18" rx="3" ry="2" />
              <ellipse cx="18" cy="16" rx="3" ry="2" />
            </svg>
            Audio
          </div>
        )}
        {failed && <span className="px-2 text-center text-xs leading-4">Preview unavailable</span>}
      </div>

      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        disabled={disabled}
        onClick={() => onRemove(id)}
        className="absolute top-0.5 right-0.5 grid size-10 place-items-center rounded-full text-[#171b20] focus-visible:outline-2 focus-visible:outline-[#e60023] disabled:opacity-60"
      >
        <span className="grid size-7 place-items-center rounded-full bg-white/95 shadow-sm">
          <svg {...iconProps} className="size-4"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </span>
      </button>

      <span dir="auto" title={file.name} className="mt-1 block truncate text-xs text-[#555d68]">
        {file.name}
      </span>
    </li>
  )
}

export function ChatAttachmentPreview({
  attachments,
  onAdd,
  onRemove,
  disabled = false,
}: ChatAttachmentPreviewProps) {
  if (!attachments.length) return null

  const totalBytes = attachments.reduce((total, { file }) => total + file.size, 0)
  const atLimit = attachments.length >= MAX_ATTACHMENTS || totalBytes >= MAX_ATTACHMENT_TOTAL_BYTES

  return (
    <section aria-label="Selected attachments" className="mb-2 flex w-fit min-w-0 max-w-full items-start gap-2">
      <ul className="flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain p-1">
        {attachments.map((attachment) => (
          <AttachmentTile key={attachment.id} attachment={attachment} onRemove={onRemove} disabled={disabled} />
        ))}
      </ul>

      <button
        type="button"
        aria-label="Add more attachments"
        title={atLimit ? 'Attachment limit reached' : 'Add more attachments'}
        disabled={disabled || atLimit}
        onClick={onAdd}
        className="mt-1 grid size-11 shrink-0 place-items-center rounded-full bg-[#f0f1f3] text-[#a62943] hover:bg-[#faeaed] focus-visible:outline-2 focus-visible:outline-[#e60023] disabled:opacity-60"
      >
        <svg {...iconProps} className="size-5"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </section>
  )
}