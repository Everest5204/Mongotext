import { useState } from 'react'
import type { MessageAttachment } from '../features/messages/messages.types'

type ChatMessageMediaProps = {
  attachments: readonly MessageAttachment[]
}

function AttachmentPlayer({ attachment }: { attachment: MessageAttachment }) {
  const { kind, name, url } = attachment
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className="rounded-xl bg-white px-3 py-2 text-sm text-[#68707a]">
        <span dir="auto" className="block wrap-anywhere font-medium text-[#171b20]">{name}</span>
        <span role="status">Could not load this {kind}.</span>
      </div>
    )
  }

  if (kind === 'image') {
    return (
      <img
        src={url}
        alt={name}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="block max-h-72 max-w-full rounded-xl object-contain sm:max-h-96"
      />
    )
  }

  if (kind === 'video') {
    return (
      <video
        src={url}
        aria-label={name}
        controls
        playsInline
        preload="none"
        onError={() => setFailed(true)}
        className="block aspect-video max-h-80 w-full rounded-xl bg-black object-contain"
      />
    )
  }

  return (
    <div className="min-w-0 rounded-xl bg-white p-2">
      <p dir="auto" title={name} className="mb-1 truncate px-1 text-sm font-medium text-[#171b20]">
        {name}
      </p>
      <audio
        src={url}
        aria-label={name}
        controls
        preload="none"
        onError={() => setFailed(true)}
        className="block w-full"
      />
    </div>
  )
}

export function ChatMessageMedia({ attachments }: ChatMessageMediaProps) {
  if (!attachments.length) return null

  return (
    <ul aria-label="Message attachments" className="grid w-96 max-w-full min-w-0 gap-2">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="min-w-0">
          <AttachmentPlayer key={attachment.url} attachment={attachment} />
        </li>
      ))}
    </ul>
  )
}