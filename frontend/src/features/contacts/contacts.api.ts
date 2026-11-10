import type { Contact } from './contacts.types'

type ContactsResponse = {
  contacts: Contact[]
}

export async function getContacts(signal?: AbortSignal): Promise<Contact[]> {
  const response = await fetch('/api/contacts', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Could not load Mongoksy users (${response.status}).`)
  }

  const data: ContactsResponse | null = await response.json()
  const contacts = data?.contacts

  if (!Array.isArray(contacts)) {
    throw new Error('Invalid contacts response.')
  }

  return contacts
}