const filters = ['All', 'Unread', 'Groups', 'Requests'] as const

type ChatListHeaderProps = {
  search?: {
    value: string
    onChange: (value: string) => void
  }
}

export function ChatListHeader({ search }: ChatListHeaderProps) {
  return (
    <header className="shrink-0 px-6 pt-6 pb-2 sm:px-7">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[34px] leading-none font-black tracking-tight text-[#e60023] sm:text-[38px]">
          Mongotext
        </h1>

        <button
          type="button"
          aria-label="New chat"
          disabled
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e60023] text-white"
        >
          <svg
            aria-hidden="true"
            className="size-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="mt-5 flex h-11 items-center gap-3 rounded-full bg-[#e9eaec] px-4 text-[#767d87] transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-[#e60023]/60">
        <svg
          aria-hidden="true"
          className="size-5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4.5 4.5" />
        </svg>

        <input
          type="search"
          aria-label="Search people"
          placeholder="Search people..."
          value={search?.value ?? ''}
          onChange={(event) => search?.onChange(event.currentTarget.value)}
          disabled={!search}
          className="min-w-0 flex-1 truncate bg-transparent text-base outline-none placeholder:text-[#767d87] disabled:opacity-100 sm:text-sm"
        />
      </div>

      <div
        role="group"
        aria-label="Chat filters"
        className="mt-3 grid grid-cols-[0.76fr_1fr_1fr_1.18fr] gap-2"
      >
        {filters.map((filter) => {
          const isActive = filter === 'All'

          return (
            <button
              key={filter}
              type="button"
              aria-pressed={isActive}
              disabled
              className={`h-9 rounded-full text-[13px] font-medium sm:text-sm ${
                isActive
                  ? 'bg-[#e60023] text-white'
                  : 'bg-[#e9eaec] text-[#171b20]'
              }`}
            >
              {filter}
            </button>
          )
        })}
      </div>
    </header>
  )
}