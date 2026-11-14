export type MessageGif = {
  url: string
  width?: number
  height?: number
}

export type GifSource =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }

export type GiphyGifSource = {
  kind: 'giphy'
  id: string
}

export type AttachmentKind = 'image' | 'audio' | 'video'

export type MessageAttachment = {
  id: string
  kind: AttachmentKind
  name: string
  mimeType: string
  sizeBytes: number
  url: string
}

export type AttachmentSource = {
  kind: 'attachments'
  files: readonly File[]
  text: string
}

export type MessageContent = string | GifSource | GiphyGifSource | AttachmentSource

export type ChatMessage = {
  id: string
  text: string
  gif?: MessageGif
  giphyId?: string
  attachments?: MessageAttachment[]
  sentAt: number
  outgoing: boolean
}

export type MessagePage = {
  messages: ChatMessage[]
  nextCursor: string | null
}

export type MessageFrame =
  | { type: 'snapshot'; page: MessagePage }
  | { type: 'message'; message: ChatMessage }

export const MAX_MESSAGE_LENGTH = 4000
export const MAX_GIF_BYTES = 2 * 1024 * 1024
export const MAX_GIF_URL_BYTES = 2048
export const MAX_ATTACHMENTS = 10
export const MAX_ATTACHMENT_TOTAL_BYTES = 32 * 1024 * 1024