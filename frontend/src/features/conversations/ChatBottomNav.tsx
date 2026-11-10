const tabs = [
  {
    label: 'Chats',
    icon: (
      <>
        <path
          d="M12 2a9 9 0 0 0-7.55 13.9L3 22l5.56-2.78A9 9 0 1 0 12 2Z"
          fill="currentColor"
          stroke="none"
        />
        <g fill="white" stroke="none">
          <circle cx="8" cy="11" r="1" />
          <circle cx="12" cy="11" r="1" />
          <circle cx="16" cy="11" r="1" />
        </g>
      </>
    ),
  },
  {
    label: 'Calls',
    icon: (
      <path d="m6.3 3.2 3 4.4-2.1 2.2a14 14 0 0 0 7 7l2.2-2.1 4.4 3c.5.4.6 1.1.3 1.6L20 21.1c-.3.5-.9.7-1.5.7C9.8 21.2 2.8 14.2 2.2 5.5c0-.6.2-1.2.7-1.5l1.8-1.1c.5-.3 1.2-.2 1.6.3Z" />
    ),
  },
  {
    label: 'People',
    icon: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2H3Z" />
        <path d="M16 4.5a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 4.5V20h-3" />
      </>
    ),
  },
  {
    label: 'Account',
    icon: (
      <>
        <circle cx="12" cy="12" r="9.5" />
        <circle cx="12" cy="9" r="2.75" />
        <path d="M6.5 19a5.5 5.5 0 0 1 11 0" />
      </>
    ),
  },
]

export function ChatBottomNav() {
  return (
    <nav
      aria-label="Mongotext tabs"
      className="grid shrink-0 grid-cols-4 rounded-t-[18px] border-t border-black/5 bg-[#f9f9fa] px-2 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-3px_12px_rgba(0,0,0,0.03)]"
    >
      {tabs.map(({ label, icon }) => {
        const isActive = label === 'Chats'

        return (
          <button
            key={label}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            disabled
            className={`flex flex-col items-center justify-center gap-1 text-[13px] font-medium disabled:opacity-100 ${
              isActive ? 'text-[#e60023]' : 'text-[#68707a]'
            }`}
          >
            <svg
              aria-hidden="true"
              className="size-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {icon}
            </svg>

            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}