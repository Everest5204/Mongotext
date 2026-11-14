import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_TOTAL_BYTES,
  type AttachmentSource,
  type ChatMessage,
  type GifSource,
  type GiphyGifSource,
  type MessageFrame,
  type MessagePage,
} from './messages.types'

export class MessageRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Message request failed (${status}).`)
    this.status = status
  }
}

async function request(url: string, options: RequestInit) {
  const response = await fetch(url, { ...options, cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) throw new MessageRequestError(response.status)
  return response
}

function messageForm(contactId: string, clientMessageId: string) {
  const body = new FormData()
  body.set('contactId', contactId)
  body.set('clientMessageId', clientMessageId)
  return body
}

async function postMessageForm(url: string, body: FormData) {
  const response = await request(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body,
  })
  return (await response.json()) as ChatMessage
}

export async function getEarlierMessages(contactId: string, before: string, signal: AbortSignal) {
  const params = new URLSearchParams({ contactId, before })
  const response = await request(`/api/messages?${params}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  return (await response.json()) as MessagePage
}

export async function sendTextMessage(contactId: string, text: string, clientMessageId: string) {
  const response = await request('/api/messages', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId, text, clientMessageId }),
  })
  return (await response.json()) as ChatMessage
}

export async function sendGifMessage(
  contactId: string,
  source: GifSource | GiphyGifSource,
  clientMessageId: string,
) {
  const body = messageForm(contactId, clientMessageId)

  if (source.kind === 'file') {
    body.set('file', source.file)
  } else if (source.kind === 'url') {
    body.set('url', source.url)
  } else {
    body.set('giphyId', source.id)
  }

  return postMessageForm('/api/messages/gif', body)
}

export async function sendAttachmentMessage(
  contactId: string,
  source: AttachmentSource,
  clientMessageId: string,
) {
  const body = messageForm(contactId, clientMessageId)
  body.set('text', source.text)
  for (const file of source.files) body.append('files', file)

  return postMessageForm('/api/messages/attachments', body)
}

export async function streamMessages(
  contactId: string,
  signal: AbortSignal,
  onFrame: (frame: MessageFrame) => void,
) {
  const params = new URLSearchParams({ contactId })
  const response = await request(`/api/messages/live?${params}`, {
    headers: { Accept: 'application/x-ndjson' },
    signal,
  })
  if (!response.body) throw new Error('The live message stream is unavailable.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let partialLine = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return

      const lines = (partialLine + decoder.decode(value, { stream: true })).split('\n')
      partialLine = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) onFrame(JSON.parse(line) as MessageFrame)
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function messageErrorText(error: unknown, fallback: string) {
  if (error instanceof MessageRequestError) {
    if (error.status === 401 || error.status === 403) return 'Sign in again to use this chat.'
    if (error.status === 404) return 'This contact is unavailable.'
    if (error.status === 409) return 'Edit the message and try sending it again.'
  }
  return fallback
}

export function gifErrorText(error: unknown, fallback: string) {
  if (error instanceof MessageRequestError) {
    switch (error.status) {
      case 400:
        return 'Choose a GIF from the picker, attach a GIF file, or paste a direct GIPHY GIF link.'
      case 409:
        return 'Select the GIF again and retry.'
      case 413:
        return 'Choose a GIF smaller than or equal to 2 MiB.'
      case 415:
        return 'This file is not a valid GIF.'
      case 422:
        return 'This GIF is too large or has too many frames.'
    }
  }
  return messageErrorText(error, fallback)
}

export function attachmentErrorText(error: unknown, fallback: string) {
  if (error instanceof MessageRequestError) {
    switch (error.status) {
      case 400:
        return 'Check your attachments and try again.'
      case 409:
        return 'Select the attachments again and retry.'
      case 413:
        return `Choose up to ${MAX_ATTACHMENTS} files totaling ${MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024)} MiB or less.`
      case 415:
        return 'One or more attachment formats are unsupported.'
      case 422:
        return 'One or more attachments are empty or invalid.'
    }
  }
  return messageErrorText(error, fallback)
}
