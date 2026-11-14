import { useState } from 'react'
import type { Contact } from '../contacts/contacts.types'

type ChatListRowProps = {
  contact: Contact
  onSelect?: (contact: Contact) => void
}

const rowClassName = 'flex min-h-19 w-full min-w-0 items-center gap-3 py-2.5 text-left sm:gap-4'

export function ChatListRow({ contact, onSelect }: ChatListRowProps) {
  const { name, avatarUrl, profileTitle } = contact
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toUpperCase()

  const content = (
    <>
      <span
        aria-hidden="true"
        className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-[#f5e8eb] text-sm font-bold text-[#a62943] sm:size-15"
      >
        {avatarUrl && avatarUrl !== failedAvatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
            onError={() => setFailedAvatarUrl(avatarUrl)}
          />
        ) : (
          <span>{initials || '?'}</span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          title={name}
          className="block truncate text-[17px] leading-6 font-bold text-[#171b20] sm:text-lg"
        >
          {name}
        </span>

        {profileTitle && (
          <span className="mt-0.5 block truncate text-sm leading-5 text-[#747b84]">
            {profileTitle}
          </span>
        )}
      </span>
    </>
  )

  if (!onSelect) {
    return <li className={rowClassName}>{content}</li>
  }

  return (
    <li>
      <button
        type="button"
        aria-label={`Open chat with ${name}`}
        onClick={() => onSelect(contact)}
        className={`${rowClassName} cursor-pointer rounded-xl transition-colors hover:bg-[#f7f7f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e60023] active:bg-[#f0f1f3] motion-reduce:transition-none`}
      >
        {content}
      </button>
    </li>
  )
}