import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  getGiphyPage,
  GIPHY_MAX_QUERY_LENGTH,
  type GiphyGif,
} from '../features/messages/giphy.api'

type ChatGifPickerProps = {
  canSend: boolean
  onClose: () => void
  onSelect: (gifId: string) => Promise<void>
}

type PageRequest = { query: string; offset: number }

type PickerResults = {
  gifs: GiphyGif[]
  nextOffset: number | null
  pending: PageRequest | null
  failure: { request: PageRequest; message: string } | null
}

const initialResults: PickerResults = {
  gifs: [],
  nextOffset: null,
  pending: { query: '', offset: 0 },
  failure: null,
}

const SEARCH_DELAY_MS = 300
const actionClassName =
  'mx-auto mt-3 block min-h-10 rounded-full bg-[#f0f1f3] px-4 text-sm font-semibold text-[#a62943] hover:bg-[#faeaed] focus-visible:outline-2 focus-visible:outline-[#e60023] disabled:opacity-60'

type GifTileProps = {
  gif: GiphyGif
  disabled: boolean
  onSelect: (gifId: string) => void
}

function GifTile({ gif, disabled, onSelect }: GifTileProps) {
  const [failedUrls, setFailedUrls] = useState<string[]>([])
  const preview = [gif.preview, gif.image].find((image) => image && !failedUrls.includes(image.url))

  return (
    <button
      type="button"
      aria-label={`Send ${gif.label}`}
      disabled={disabled || !preview || !gif.image}
      onClick={() => onSelect(gif.id)}
      className="block w-full overflow-hidden rounded-xl bg-[#f0f1f3] text-left text-[#171b20] hover:ring-2 hover:ring-[#e60023]/35 focus-visible:outline-2 focus-visible:outline-[#e60023] disabled:cursor-default disabled:hover:ring-0"
    >
      {preview ? (
        <img
          src={preview.url}
          alt=""
          width={preview.width}
          height={preview.height}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailedUrls((current) => [...current, preview.url])}
          className="block aspect-4/3 h-auto w-full object-contain"
        />
      ) : (
        <span className="grid aspect-4/3 place-items-center px-2 text-center text-xs text-[#68707a]">
          GIF unavailable
        </span>
      )}
      {gif.attribution && (
        <span className="block truncate px-2 py-1 text-xs text-[#555d68]" title={gif.attribution}>
          {gif.attribution}
        </span>
      )}
    </button>
  )
}

export function ChatGifPicker({ canSend, onClose, onSelect }: ChatGifPickerProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(initialResults)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const { gifs, nextOffset, pending, failure } = results

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    dialog.showModal()
    return () => dialog.close()
  }, [])

  useEffect(() => {
    if (!pending) return

    const controller = new AbortController()
    const { signal } = controller
    const { query, offset } = pending
    const delay = query.trim() && offset === 0 ? SEARCH_DELAY_MS : 0

    const timer = window.setTimeout(async () => {
      try {
        const page = await getGiphyPage(query, offset, signal)
        if (signal.aborted) return

        setResults((current) => {
          if (current.pending !== pending) return current
          return {
            gifs: offset === 0 ? page.gifs : [...current.gifs, ...page.gifs],
            nextOffset: page.nextOffset,
            pending: null,
            failure: null,
          }
        })
      } catch (error) {
        if (signal.aborted) return

        const message = error instanceof Error ? error.message : 'Could not load GIFs.'
        setResults((current) => {
          if (current.pending !== pending) return current
          return { ...current, pending: null, failure: { request: pending, message } }
        })
      }
    }, delay)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [pending])

  function search(value: string) {
    setQuery(value)
    if (!value.trim() && !query.trim()) return

    scrollRef.current?.scrollTo({ top: 0 })
    setSendError('')
    setResults({ ...initialResults, pending: { query: value, offset: 0 } })
  }

  function loadPage(request: PageRequest) {
    setResults((current) => (
      current.pending ? current : { ...current, pending: request, failure: null }
    ))
  }

  async function sendGif(gifId: string) {
    if (!canSend || sendingRef.current) return

    sendingRef.current = true
    setSending(true)
    setSendError('')

    try {
      await onSelect(gifId)
      if (dialogRef.current?.open) onClose()
    } catch (error) {
      if (dialogRef.current?.open) {
        setSendError(error instanceof Error ? error.message : 'Could not send the GIF. Try again.')
      }
    } finally {
      sendingRef.current = false
      if (dialogRef.current?.open) setSending(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="m-auto h-[32rem] max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white text-[#171b20] shadow-xl backdrop:bg-black/30 open:flex max-sm:mb-0 max-sm:rounded-b-none sm:max-h-[80dvh]"
    >
      <div className="shrink-0 border-b border-[#eceef0] px-4 pt-3 pb-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-bold">GIFs</h2>
          <button
            type="button"
            aria-label="Close GIF picker"
            onClick={onClose}
            className="grid size-10 place-items-center rounded-full text-[#68707a] hover:bg-[#f0f1f3] focus-visible:outline-2 focus-visible:outline-[#e60023]"
          >
            <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <input
          type="search"
          aria-label="Search GIFs"
          placeholder="Search GIFs"
          value={query}
          maxLength={GIPHY_MAX_QUERY_LENGTH}
          onChange={(event) => search(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault()
          }}
          className="block h-11 w-full rounded-full bg-[#f0f1f3] px-4 text-base outline-none placeholder:text-[#68707a] focus-visible:ring-2 focus-visible:ring-[#e60023]/55"
        />
        {sending && <p role="status" className="mt-2 text-sm text-[#555d68]">Sending GIF…</p>}
        {!canSend && !sending && <p role="status" className="mt-2 text-sm text-[#555d68]">Waiting for the chat connection…</p>}
        {sendError && <p role="alert" className="mt-2 text-sm text-[#a62943]">{sendError}</p>}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {gifs.length > 0 && (
          <ul aria-label={query.trim() ? 'GIF search results' : 'Trending GIFs'} className="grid grid-cols-2 items-start gap-2 min-[400px]:grid-cols-3">
            {gifs.map((gif, index) => (
              <li key={`${gif.id}-${index}`} className="min-w-0">
                <GifTile gif={gif} disabled={!canSend || sending} onSelect={(id) => void sendGif(id)} />
              </li>
            ))}
          </ul>
        )}
        {pending && gifs.length === 0 && (
          <p role="status" className="py-6 text-center text-sm text-[#68707a]">Loading GIFs…</p>
        )}
        {!pending && !failure && gifs.length === 0 && (
          <p role="status" className="py-6 text-center text-sm text-[#68707a]">No GIFs found.</p>
        )}
        {failure && (
          <div className="py-3 text-center text-sm">
            <p role="alert" className="text-[#a62943]">{failure.message}</p>
            <button type="button" onClick={() => loadPage(failure.request)} className={actionClassName}>
              Retry loading GIFs
            </button>
          </div>
        )}
        {nextOffset !== null && !failure && (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => loadPage({ query, offset: nextOffset })}
            className={actionClassName}
          >
            {pending ? 'Loading more GIFs…' : 'Load more GIFs'}
          </button>
        )}
      </div>

      <footer className="flex shrink-0 justify-center border-t border-[#eceef0] px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <a
          href="https://giphy.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-black px-2 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e60023]"
        >
          Powered by
          <img src="https://giphy.com/static/img/giphy-logo.webp" alt="GIPHY" referrerPolicy="no-referrer" className="h-3.5 w-auto max-w-22" />
        </a>
      </footer>
    </dialog>
  )
}
