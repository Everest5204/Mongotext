import type { Contact } from './contacts.types'

type ContactsResponse = {
  contacts: Contact[]
  nextCursor?: string | null
}

type ContactsPage = {
  contacts: Contact[]
  nextCursor: string | null
}

async function fetchContacts(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<ContactsPage> {
  const search = params.toString()
  const endpoint = search ? `/api/contacts?${search}` : '/api/contacts'

  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signal ?? null,
  })

  if (!response.ok) {
    throw new Error(`Could not load users (${response.status}).`)
  }

  const data: ContactsResponse | null = await response.json()
  const contacts = data?.contacts

  if (!Array.isArray(contacts)) {
    throw new Error('Invalid contacts response.')
  }

  const nextCursor = data?.nextCursor
  return {
    contacts,
    nextCursor: typeof nextCursor === 'string' && nextCursor ? nextCursor : null,
  }
}

export async function getContacts(
  signal?: AbortSignal,
  query = '',
): Promise<Contact[]> {
  const params = new URLSearchParams()
  const term = query.trim()
  if (term) params.set('q', term)

  const page = await fetchContacts(params, signal)
  return page.contacts
}

export function getContactsPage(
  signal?: AbortSignal,
  cursor: string | null = null,
): Promise<ContactsPage> {
  const params = new URLSearchParams()
  if (cursor) params.set('cursor', cursor)

  return fetchContacts(params, signal)
}