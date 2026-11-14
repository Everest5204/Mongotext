import { useState } from 'react'
import type { Contact } from '../features/contacts/contacts.types'

type ChatThreadHeaderProps = {
  contact: Contact
  onBack: () => void
}

const actions = [
  {
    label: 'Voice call',
    icon: (
      <path d="m6.3 3.2 1.4-.6a1.8 1.8 0 0 1 2.3.9l1.4 3.4a1.8 1.8 0 0 1-.4 2l-1.1 1.1a14 14 0 0 0 4.1 4.1l1.1-1.1a1.8 1.8 0 0 1 2-.4l3.4 1.4a1.8 1.8 0 0 1 .9 2.3l-.6 1.4a3 3 0 0 1-3.2 1.8A18 18 0 0 1 4.5 6.4a3 3 0 0 1 1.8-3.2Z" />
    ),
  },
  {
    label: 'Video call',
    icon: (
      <>
        <rect x="3" y="6" width="12" height="12" rx="2" />
        <path d="m15 10 6-3v10l-6-3" />
      </>
    ),
  },
  {
    label: 'Conversation options',
    icon: (
      <g fill="currentColor" stroke="none">
        <circle cx="12" cy="5" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="12" cy="19" r="1.7" />
      </g>
    ),
  },
]

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function ChatThreadHeader({ contact, onBack }: ChatThreadHeaderProps) {
  const { name, avatarUrl } = contact
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toUpperCase()

  return (
    <header className="flex min-w-0 shrink-0 items-center gap-1.5 border-b border-[#eceef0] bg-white px-2 py-2 sm:gap-3 sm:px-4 sm:py-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to chats"
        className="grid size-11 shrink-0 place-items-center rounded-full text-[#171b20] transition-colors hover:bg-[#f5f5f6] focus-visible:outline-2 focus-visible:outline-[#e60023] motion-reduce:transition-none"
      >
        <svg {...iconProps} className="size-6">
          <path d="M19 12H5m7-7-7 7 7 7" />
        </svg>
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <div
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[#f5e8eb] text-sm font-bold text-[#a62943] sm:size-11"
        >
          {avatarUrl && avatarUrl !== failedAvatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              decoding="async"
              referrerPolicy="no-referrer"
              className="size-full object-cover"
              onError={() => setFailedAvatarUrl(avatarUrl)}
            />
          ) : (
            <span>{initials || '?'}</span>
          )}
        </div>

        <h2
          title={name}
          className="min-w-0 truncate text-base leading-tight font-semibold text-[#171b20] sm:text-lg"
        >
          {name}
        </h2>
      </div>

      <div role="group" aria-label="Chat actions" className="flex shrink-0 items-center">
        {actions.map(({ label, icon }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            disabled
            className="grid size-8 shrink-0 place-items-center rounded-full text-[#68707a] sm:size-10"
          >
            <svg {...iconProps} className="size-5">
              {icon}
            </svg>
          </button>
        ))}
      </div>
    </header>
  )
}