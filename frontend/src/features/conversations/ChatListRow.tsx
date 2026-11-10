import { useState } from 'react'
import type { Contact } from '../contacts/contacts.types'

type ChatListRowProps = {
  contact: Contact
}

export function ChatListRow({ contact }: ChatListRowProps) {
  const { name, avatarUrl, profileTitle } = contact
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toUpperCase()

  return (
    <li className="flex min-h-19 items-center gap-4 py-2.5">
      <div
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
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[17px] leading-6 font-bold text-[#171b20] sm:text-lg">
          {name}
        </h2>

        {profileTitle && (
          <p className="mt-0.5 truncate text-sm leading-5 text-[#747b84]">
            {profileTitle}
          </p>
        )}
      </div>
    </li>
  )
}