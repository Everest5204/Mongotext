import type { Contact } from '../features/contacts/contacts.types'
import { useThreadMessages } from '../features/messages/useThreadMessages'
import { ChatComposer } from './ChatComposer'
import { ChatThreadBody } from './ChatThreadBody'
import { ChatThreadHeader } from './ChatThreadHeader'

type ChatThreadProps = {
  contact: Contact
  onBack: () => void
}

export function ChatThread({ contact, onBack }: ChatThreadProps) {
  const { state, loadEarlier, send } = useThreadMessages(contact.id)

  return (
    <section
      aria-label={`Chat with ${contact.name}`}
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-white"
    >
      <ChatThreadHeader contact={contact} onBack={onBack} />
      <ChatThreadBody state={state} onLoadEarlier={loadEarlier} />
      <ChatComposer canSend={state.status === 'ready'} onSend={send} />
    </section>
  )
}