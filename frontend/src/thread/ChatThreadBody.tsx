import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import type { ChatMessage } from '../features/messages/messages.types'
import type { ThreadMessagesState } from '../features/messages/useThreadMessages'
import { ChatGif, ChatGifProvider } from './ChatGif'
import { ChatMessageMedia } from './ChatMessageMedia'

type ChatThreadBodyProps = {
  state: ThreadMessagesState
  onLoadEarlier: () => Promise<void>
}

const messageTime = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
})

const messageDateTime = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'long',
})

const emojiTokens = /[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}|(?=\p{Emoji})\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?/gu

function isEmojiOnly(text: string) {
  const remaining = text.replace(emojiTokens, '')
  return remaining !== text && /^[\s\u200D]*$/u.test(remaining)
}

const ThreadMessage = memo(function ThreadMessage({ message }: { message: ChatMessage }) {
  const { text, gif, giphyId, attachments, sentAt, outgoing } = message
  const hasMedia = Boolean(gif || giphyId || attachments?.length)
  const emojiOnly = !hasMedia && isEmojiOnly(text)
  const bubbleColor = outgoing
    ? 'rounded-br-md bg-[#e60023] text-white'
    : 'rounded-bl-md bg-white text-[#171b20]'
  const bubbleStyle = `rounded-[1.15rem] px-3.5 py-2 text-sm leading-6 sm:text-base ${bubbleColor}`
  const timeStyle = outgoing || (!hasMedia && !emojiOnly) ? 'text-right' : 'text-left'
  const timeColor = outgoing && !hasMedia && !emojiOnly ? 'text-white/85' : 'text-[#68707a]'
  const contentStyle = hasMedia
    ? `flex flex-col gap-1 ${outgoing ? 'items-end' : 'items-start'}`
    : emojiOnly ? 'text-3xl leading-snug sm:text-4xl' : bubbleStyle

  return (
    <li className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
      <div className={`min-w-0 max-w-[min(85%,36rem)] ${contentStyle}`}>
        {attachments && <ChatMessageMedia attachments={attachments} />}
        {gif ? <ChatGif media={gif} /> : giphyId && <ChatGif giphyId={giphyId} />}
        {text && (
          <p dir="auto" className={`max-w-full whitespace-pre-wrap wrap-anywhere ${hasMedia ? bubbleStyle : ''}`}>
            {text}
          </p>
        )}
        <time
          dateTime={new Date(sentAt).toISOString()}
          title={messageDateTime.format(sentAt)}
          className={`block text-[11px] leading-4 tabular-nums ${timeStyle} ${timeColor}`}
        >
          {messageTime.format(sentAt)}
        </time>
      </div>
    </li>
  )
})

export function ChatThreadBody({ state, onLoadEarlier }: ChatThreadBodyProps) {
  const { messages, nextCursor, status, error, earlier } = state
  const hasMessages = messages.length > 0
  const viewportRef = useRef<HTMLElement>(null)
  const messageListRef = useRef<HTMLOListElement>(null)
  const nearLatest = useRef(true)
  const latestId = useRef<string | undefined>(undefined)
  const statusText = status === 'loading'
    ? 'Loading messages…'
    : status === 'reconnecting' ? 'Reconnecting to chat…' : error

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const latest = messages.at(-1)
    if (viewport && (nearLatest.current || (latest?.outgoing && latest.id !== latestId.current))) {
      viewport.scrollTop = viewport.scrollHeight
    }
    latestId.current = latest?.id
  }, [messages])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (nearLatest.current) viewport.scrollTop = viewport.scrollHeight
    })
    observer.observe(viewport)
    if (messageListRef.current) observer.observe(messageListRef.current)
    return () => observer.disconnect()
  }, [hasMessages])

  function trackScroll() {
    const viewport = viewportRef.current
    if (viewport) {
      nearLatest.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 72
    }
  }

  return (
    <section
      ref={viewportRef}
      aria-label="Messages"
      onScroll={trackScroll}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-[#f0f1f3] px-3 py-4 sm:px-6"
    >
      {statusText && (
        <p
          role={error ? 'alert' : 'status'}
          className={`shrink-0 text-center text-sm leading-6 text-[#68707a] ${hasMessages ? 'mb-3' : 'm-auto'}`}
        >
          {statusText}
        </p>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={() => void onLoadEarlier()}
          disabled={earlier === 'loading'}
          className="mx-auto mb-3 shrink-0 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#a62943] focus-visible:outline-2 focus-visible:outline-[#e60023] disabled:opacity-60"
        >
          {earlier === 'loading'
            ? 'Loading earlier messages…'
            : earlier === 'error' ? 'Retry earlier messages' : 'Load earlier messages'}
        </button>
      )}

      {hasMessages && (
        <ol ref={messageListRef} className="mt-auto shrink-0 space-y-2" aria-live="polite" aria-relevant="additions">
          <ChatGifProvider messages={messages}>
            {messages.map((message) => <ThreadMessage key={message.id} message={message} />)}
          </ChatGifProvider>
        </ol>
      )}

      {status === 'ready' && !hasMessages && (
        <p className="m-auto text-center text-sm leading-6 text-[#68707a]">No messages yet.</p>
      )}
    </section>
  )
}