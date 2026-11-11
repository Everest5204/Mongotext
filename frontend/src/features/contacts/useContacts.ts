import { useCallback, useEffect, useMemo, useState } from 'react'
import { getContacts, getContactsPage } from './contacts.api'
import type { Contact } from './contacts.types'

const SEARCH_DELAY_MS = 300

type ContactsState =
  | { status: 'loading' }
  | { status: 'ready'; contacts: Contact[] }
  | { status: 'error' }

type DirectoryState = {
  contacts: Contact[]
  nextCursor: string | null
  request: { cursor: string | null } | null
  failed: boolean
}

type SearchState = {
  query: string
  request: { term: string }
  result: ContactsState
}

function prioritizeContacts(
  directory: Contact[],
  searchResults: Contact[],
  searchTerm: string,
) {
  const term = searchTerm.toLowerCase()
  const matches = new Map(searchResults.map((contact) => [contact.id, contact]))
  const remaining: Contact[] = []

  for (const contact of directory) {
    if (matches.has(contact.id)) continue

    if (contact.name.toLowerCase().includes(term)) {
      matches.set(contact.id, contact)
    } else {
      remaining.push(contact)
    }
  }

  return {
    contacts: [...matches.values(), ...remaining],
    matchCount: matches.size,
  }
}

export function useContacts() {
  const [directory, setDirectory] = useState<DirectoryState>({
    contacts: [],
    nextCursor: null,
    request: { cursor: null },
    failed: false,
  })
  const [search, setSearch] = useState<SearchState>({
    query: '',
    request: { term: '' },
    result: { status: 'loading' },
  })

  const pageRequest = directory.request
  const { query, request: searchRequest, result } = search
  const { term } = searchRequest

  function setQuery(value: string) {
    const nextTerm = value.trim().replace(/\s+/g, ' ')

    setSearch((current) => {
      if (nextTerm === current.request.term) {
        return { ...current, query: value }
      }

      return {
        query: value,
        request: { term: nextTerm },
        result: { status: 'loading' },
      }
    })
  }

  const loadNextPage = useCallback(() => {
    setDirectory((current) => {
      if (current.request || (!current.nextCursor && !current.failed)) {
        return current
      }

      return {
        ...current,
        request: { cursor: current.nextCursor },
        failed: false,
      }
    })
  }, [])

  useEffect(() => {
    if (!pageRequest) return

    const controller = new AbortController()
    const { signal } = controller

    async function loadPage(cursor: string | null) {
      try {
        const page = await getContactsPage(signal, cursor)

        setDirectory((current) => {
          if (signal.aborted || current.request !== pageRequest) return current

          return {
            contacts: [...current.contacts, ...page.contacts],
            nextCursor: page.nextCursor,
            request: null,
            failed: false,
          }
        })
      } catch {
        setDirectory((current) => {
          if (signal.aborted || current.request !== pageRequest) return current
          return { ...current, request: null, failed: true }
        })
      }
    }

    void loadPage(pageRequest.cursor)
    return () => controller.abort()
  }, [pageRequest])

  useEffect(() => {
    if (!term) return

    const controller = new AbortController()
    const { signal } = controller

    async function searchPeople() {
      let nextResult: ContactsState

      try {
        const contacts = await getContacts(signal, term)
        nextResult = { status: 'ready', contacts }
      } catch {
        nextResult = { status: 'error' }
      }

      setSearch((current) => {
        if (signal.aborted || current.request !== searchRequest) return current
        return { ...current, result: nextResult }
      })
    }

    const timer = window.setTimeout(() => void searchPeople(), SEARCH_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [searchRequest, term])

  const ranked = useMemo(() => {
    if (!term) return { contacts: directory.contacts, matchCount: 0 }

    const searchResults = result.status === 'ready' ? result.contacts : []
    return prioritizeContacts(directory.contacts, searchResults, term)
  }, [directory.contacts, result, term])

  let contactsState: ContactsState

  if (ranked.contacts.length) {
    contactsState = { status: 'ready', contacts: ranked.contacts }
  } else if (pageRequest || (term && result.status === 'loading')) {
    contactsState = { status: 'loading' }
  } else if (directory.failed || (term && result.status === 'error')) {
    contactsState = { status: 'error' }
  } else {
    contactsState = { status: 'ready', contacts: ranked.contacts }
  }

  return {
    query,
    setQuery,
    contactsState,
    searchStatus: term ? result.status : 'idle',
    matchCount: ranked.matchCount,
    hasMore: directory.nextCursor !== null,
    isLoadingMore: pageRequest !== null && directory.contacts.length > 0,
    directoryFailed: directory.failed,
    loadNextPage,
  }
}