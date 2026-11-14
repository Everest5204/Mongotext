import { useEffect, useRef, useState } from 'react'
import {
  getEarlierMessages,
  MessageRequestError,
  messageErrorText,
  sendAttachmentMessage,
  sendGifMessage,
  sendTextMessage,
  streamMessages,
} from './messages.api'
import type { ChatMessage, MessageContent, MessagePage } from './messages.types'

export type ThreadMessagesState = MessagePage & {
  status: 'loading' | 'ready' | 'reconnecting' | 'unavailable'
  error: string | null
  earlier: 'idle' | 'loading' | 'error'
}

const initialState: ThreadMessagesState = {
  status: 'loading',
  messages: [],
  nextCursor: null,
  error: null,
  earlier: 'idle',
}

function mergeMessages(current: ChatMessage[], additions: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of additions) byId.set(message.id, message)

  if (byId.size === current.length) return current
  return [...byId.values()].sort((left, right) =>
    left.sentAt - right.sentAt || (left.id < right.id ? -1 : 1),
  )
}

function withSnapshot(current: ThreadMessagesState, page: MessagePage): ThreadMessagesState {
  const firstNewId = page.messages[0]?.id
  const overlap = current.messages.findIndex((message) => message.id === firstNewId)
  const loadedHistory = overlap > 0 ? current.messages.slice(0, overlap) : []

  return {
    messages: [...loadedHistory, ...page.messages],
    nextCursor: overlap > 0 ? current.nextCursor : page.nextCursor,
    status: 'ready',
    error: null,
    earlier: 'idle',
  }
}

function withMessage(current: ThreadMessagesState, message: ChatMessage) {
  const messages = mergeMessages(current.messages, [message])
  return messages === current.messages ? current : { ...current, messages }
}

export function useThreadMessages(contactId: string) {
  const [state, setState] = useState(initialState)
  const earlierRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let retryTimer: number | undefined
    let retryDelay = 1000

    async function connect() {
      try {
        await streamMessages(contactId, signal, (frame) => {
          if (signal.aborted) return

          if (frame.type === 'snapshot') {
            earlierRequest.current?.abort()
            earlierRequest.current = null
            retryDelay = 1000
            setState((current) => withSnapshot(current, frame.page))
          } else {
            setState((current) => withMessage(current, frame.message))
          }
        })
      } catch (error) {
        if (signal.aborted) return
        if (
          error instanceof MessageRequestError &&
          error.status >= 400 && error.status < 500 &&
          error.status !== 408 && error.status !== 429
        ) {
          setState((current) => ({
            ...current,
            status: 'unavailable',
            error: messageErrorText(error, 'Choose another contact to open a chat.'),
          }))
          return
        }
      }

      if (signal.aborted) return
      setState((current) => ({ ...current, status: 'reconnecting', error: null }))
      retryTimer = window.setTimeout(() => void connect(), retryDelay)
      retryDelay = Math.min(retryDelay * 2, 10_000)
    }

    void connect()

    return () => {
      controller.abort()
      window.clearTimeout(retryTimer)
      earlierRequest.current?.abort()
      earlierRequest.current = null
    }
  }, [contactId])

  async function loadEarlier() {
    if (!state.nextCursor || earlierRequest.current) return
    const controller = new AbortController()
    earlierRequest.current = controller
    setState((current) => ({ ...current, earlier: 'loading' }))

    try {
      const page = await getEarlierMessages(contactId, state.nextCursor, controller.signal)
      if (controller.signal.aborted) return
      setState((current) => ({
        ...current,
        messages: mergeMessages(current.messages, page.messages),
        nextCursor: page.nextCursor,
        earlier: 'idle',
      }))
    } catch {
      if (!controller.signal.aborted) {
        setState((current) => ({ ...current, earlier: 'error' }))
      }
    } finally {
      if (earlierRequest.current === controller) earlierRequest.current = null
    }
  }

  async function send(content: MessageContent, clientMessageId: string) {
    let message: ChatMessage

    if (typeof content === 'string') {
      message = await sendTextMessage(contactId, content, clientMessageId)
    } else if (content.kind === 'attachments') {
      message = await sendAttachmentMessage(contactId, content, clientMessageId)
    } else {
      message = await sendGifMessage(contactId, content, clientMessageId)
    }

    setState((current) => withMessage(current, message))
  }

  return { state, loadEarlier, send }
}
