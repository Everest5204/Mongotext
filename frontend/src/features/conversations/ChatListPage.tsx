import { useEffect, useState } from 'react'
import { getContacts } from '../contacts/contacts.api'
import type { Contact } from '../contacts/contacts.types'
import { ChatBottomNav } from './ChatBottomNav'
import { ChatListHeader } from './ChatListHeader'
import { ChatListRow } from './ChatListRow'

type ContactsState =
  | { status: 'loading' }
  | { status: 'ready'; contacts: Contact[] }
  | { status: 'error' }

export default function ChatListPage() {
  const [contactsState, setContactsState] = useState<ContactsState>({
    status: 'loading',
  })

  useEffect(() => {
    const controller = new AbortController()

    async function loadContacts() {
      try {
        const contacts = await getContacts(controller.signal)

        if (!controller.signal.aborted) {
          setContactsState({ status: 'ready', contacts })
        }
      } catch {
        if (!controller.signal.aborted) {
          setContactsState({ status: 'error' })
        }
      }
    }

    void loadContacts()

    return () => controller.abort()
  }, [])

  return (
    <main className="flex h-dvh min-h-96 w-full flex-col bg-[#f7f7f8] font-sans text-[#171b20] antialiased">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col md:px-8 xl:px-12">
        <ChatListHeader />

        <section
          aria-label="Mongoksy users"
          className="min-h-0 flex-1 overflow-y-auto px-6 py-3 sm:px-7"
        >
          {contactsState.status === 'loading' && (
            <p role="status" className="py-10 text-center text-sm text-slate-500">
              Loading Mongoksy users…
            </p>
          )}

          {contactsState.status === 'error' && (
            <p role="alert" className="py-10 text-center text-sm text-slate-600">
              Could not load Mongoksy users.
            </p>
          )}

          {contactsState.status === 'ready' &&
            (contactsState.contacts.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No people to show yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {contactsState.contacts.map((contact) => (
                  <ChatListRow key={contact.id} contact={contact} />
                ))}
              </ul>
            ))}
        </section>

        <ChatBottomNav />
      </div>
    </main>
  )
}