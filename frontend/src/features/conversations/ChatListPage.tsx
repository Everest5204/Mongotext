import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ChatThread } from '../../thread/ChatThread'
import type { Contact } from '../contacts/contacts.types'
import { useContacts } from '../contacts/useContacts'
import { ChatBottomNav } from './ChatBottomNav'
import { ChatListHeader } from './ChatListHeader'
import { ChatListRow } from './ChatListRow'

const ContactRow = memo(ChatListRow)

export default function ChatListPage() {
  const {
    query,
    setQuery,
    contactsState,
    searchStatus,
    matchCount,
    hasMore,
    isLoadingMore,
    directoryFailed,
    loadNextPage,
  } = useContacts()
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const listRef = useRef<HTMLElement>(null)
  const loadMoreRef = useRef<HTMLButtonElement>(null)
  const threadPanelRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const openThread = useCallback((contact: Contact) => {
    const focusedElement = document.activeElement
    returnFocusRef.current =
      focusedElement instanceof HTMLElement && listRef.current?.contains(focusedElement)
        ? focusedElement
        : null
    setSelectedContact(contact)
  }, [])

  useEffect(() => {
    if (selectedContact) {
      threadPanelRef.current?.focus({ preventScroll: true })
      return
    }

    returnFocusRef.current?.focus({ preventScroll: true })
    returnFocusRef.current = null
  }, [selectedContact])

  useEffect(() => {
    const list = listRef.current
    const button = loadMoreRef.current

    if (!hasMore || isLoadingMore || directoryFailed || !list || !button) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadNextPage()
      },
      { root: list, rootMargin: '0px 0px 320px 0px' },
    )

    observer.observe(button)
    return () => observer.disconnect()
  }, [directoryFailed, hasMore, isLoadingMore, loadNextPage])

  function handleSearchChange(value: string) {
    setQuery(value)
    if (listRef.current) listRef.current.scrollTop = 0
  }

  const isSearching = searchStatus !== 'idle'
  const showResults = contactsState.status === 'ready' && contactsState.contacts.length > 0
  const listVisibility = selectedContact ? 'invisible md:visible' : ''

  return (
    <main className="grid h-dvh w-full min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-white font-sans text-[#171b20] antialiased md:grid-cols-[4.5rem_clamp(17.5rem,29vw,29.75rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
      <div
        className={`col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col bg-white md:col-start-2 md:border-r md:border-[#eceef0] ${listVisibility}`}
      >
        <ChatListHeader search={{ value: query, onChange: handleSearchChange }} />

        <section
          ref={listRef}
          aria-label="Mongoksy users"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-3 sm:px-7"
        >
          {contactsState.status === 'loading' && (
            <p role="status" className="py-10 text-center text-sm text-slate-500">
              {isSearching ? 'Searching people…' : 'Loading Mongoksy users…'}
            </p>
          )}

          {contactsState.status === 'error' && (
            <p role="alert" className="py-10 text-center text-sm text-slate-600">
              Could not load Mongoksy users.
            </p>
          )}

          {contactsState.status === 'ready' && (
            <>
              {searchStatus === 'ready' && matchCount === 0 && (
                <p role="status" className="py-3 text-sm text-slate-600">
                  No users match your search.
                </p>
              )}

              {showResults && searchStatus === 'error' && (
                <p role="status" className="py-3 text-sm text-slate-600">
                  Could not search users.
                </p>
              )}

              {contactsState.contacts.length > 0 && (
                <ul className="space-y-1">
                  {contactsState.contacts.map((contact) => (
                    <ContactRow key={contact.id} contact={contact} onSelect={openThread} />
                  ))}
                </ul>
              )}

              {!isSearching && !showResults && (
                <p role="status" className="py-10 text-center text-sm text-slate-500">
                  No people to show yet.
                </p>
              )}
            </>
          )}

          {isLoadingMore && (
            <p role="status" className="py-4 text-center text-sm text-slate-500">
              Loading more people…
            </p>
          )}

          {directoryFailed && (
            <button
              type="button"
              onClick={loadNextPage}
              className="mx-auto my-3 block rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#a62943]"
            >
              Retry loading people
            </button>
          )}

          {hasMore && !isLoadingMore && !directoryFailed && (
            <button
              ref={loadMoreRef}
              type="button"
              onClick={loadNextPage}
              className="mx-auto my-3 block rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#a62943]"
            >
              Load more people
            </button>
          )}
        </section>
      </div>

      <div
        className={`col-start-1 row-start-2 min-w-0 md:row-start-1 md:min-h-0 md:border-r md:border-[#eceef0] ${listVisibility}`}
      >
        <ChatBottomNav desktopRail />
      </div>

      <section
        ref={threadPanelRef}
        aria-label="Conversation panel"
        tabIndex={selectedContact ? -1 : undefined}
        className={`col-start-1 row-start-1 row-end-3 min-h-0 min-w-0 bg-[#fdfdfd] outline-none md:col-start-3 md:row-end-2 ${
          selectedContact ? '' : 'hidden md:grid md:place-items-center'
        }`}
      >
        {selectedContact ? (
          <ChatThread
            key={selectedContact.id}
            contact={selectedContact}
            onBack={() => setSelectedContact(null)}
          />
        ) : (
          <p className="px-6 text-center text-sm text-[#68707a]">
            Select a contact to open a chat.
          </p>
        )}
      </section>
    </main>
  )
}