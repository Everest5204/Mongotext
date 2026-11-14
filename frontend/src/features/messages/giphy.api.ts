const GIPHY_API = 'https://api.giphy.com/v1/gifs'
const API_KEY = import.meta.env.VITE_GIPHY_API_KEY?.trim()
const PAGE_SIZE = 20
const MAX_IDS_PER_REQUEST = 100
const MEDIA_HOST = /^(?:i|media\d*)\.giphy\.com$/
const FIELDS = [
  'id',
  'title',
  'alt_text',
  'username',
  'source_tld',
  'images.fixed_width_small',
  'images.fixed_height_small',
  'images.fixed_width',
  'images.fixed_height',
  'images.downsized',
  'images.original',
].join(',')

export const GIPHY_MAX_QUERY_LENGTH = 50

export type GiphyImage = {
  url: string
  width?: number
  height?: number
}

export type GiphyGif = {
  id: string
  label: string
  attribution: string
  preview: GiphyImage | null
  image: GiphyImage | null
}

type Rendition = { url?: string; width?: string; height?: string }

type ApiGif = {
  id: string
  title?: string
  alt_text?: string
  username?: string
  source_tld?: string
  images?: {
    fixed_width_small?: Rendition
    fixed_height_small?: Rendition
    fixed_width?: Rendition
    fixed_height?: Rendition
    downsized?: Rendition
    original?: Rendition
  }
}

type ApiResponse = {
  data: ApiGif[]
  pagination?: { total_count?: number }
}

function dimension(value: string | undefined) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

function firstImage(...renditions: (Rendition | undefined)[]): GiphyImage | null {
  for (const rendition of renditions) {
    if (!rendition?.url) continue

    try {
      const url = new URL(rendition.url)
      if (url.protocol !== 'https:' || !MEDIA_HOST.test(url.hostname)) continue

      return {
        url: rendition.url,
        width: dimension(rendition.width),
        height: dimension(rendition.height),
      }
    } catch {
      continue
    }
  }
  return null
}

function readGif(gif: ApiGif): GiphyGif {
  if (typeof gif?.id !== 'string' || !gif.id) {
    throw new Error('GIPHY returned a GIF without an ID.')
  }

  const images = gif.images
  const small = firstImage(images?.fixed_width_small, images?.fixed_height_small)
  const image = firstImage(
    images?.fixed_width,
    images?.fixed_height,
    images?.downsized,
    images?.original,
  ) ?? small

  return {
    id: gif.id,
    label: gif.alt_text?.trim() || gif.title?.trim() || 'Animated GIF',
    attribution: gif.username?.trim() || gif.source_tld?.trim() || '',
    preview: small ?? image,
    image,
  }
}

async function requestGiphy(
  path: '' | '/trending' | '/search',
  parameters: Record<string, string>,
  signal: AbortSignal,
) {
  if (!API_KEY) throw new Error('Set VITE_GIPHY_API_KEY to enable the GIF picker.')

  const params = new URLSearchParams({ api_key: API_KEY, rating: 'g', fields: FIELDS, ...parameters })
  const response = await fetch(`${GIPHY_API}${path}?${params}`, {
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal,
  })

  if (response.status === 429) throw new Error('GIPHY is rate limited. Try again later.')
  if (response.status === 401 || response.status === 403) throw new Error('Check your GIPHY Web API key.')
  if (!response.ok) throw new Error('Could not load GIFs. Try again.')

  const result = (await response.json()) as ApiResponse
  if (!Array.isArray(result?.data)) throw new Error('GIPHY returned an invalid response.')
  return result
}

export async function getGiphyPage(query: string, offset: number, signal: AbortSignal) {
  const searching = query.trim().length > 0
  const maxOffset = searching ? 4_999 : 499

  if (searching && Array.from(query).length > GIPHY_MAX_QUERY_LENGTH) {
    throw new Error(`Search terms must be ${GIPHY_MAX_QUERY_LENGTH} characters or fewer.`)
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > maxOffset) {
    return { gifs: [], nextOffset: null }
  }

  const parameters: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(offset) }
  if (searching) parameters.q = query

  const { data, pagination } = await requestGiphy(
    searching ? '/search' : '/trending',
    parameters,
    signal,
  )
  const end = offset + data.length
  const total = pagination?.total_count
  const hasMore = total === undefined ? data.length === PAGE_SIZE : end < total

  return {
    gifs: data.map(readGif),
    nextOffset: data.length > 0 && hasMore && end <= maxOffset ? end : null,
  }
}

export async function getGiphyGifsByIds(ids: readonly string[], signal: AbortSignal) {
  const uniqueIds = [...new Set(ids)]
  const requests: Promise<ApiResponse>[] = []

  for (let offset = 0; offset < uniqueIds.length; offset += MAX_IDS_PER_REQUEST) {
    const batch = uniqueIds.slice(offset, offset + MAX_IDS_PER_REQUEST)
    requests.push(requestGiphy('', { ids: batch.join(',') }, signal))
  }

  const gifs = new Map<string, GiphyGif>()
  for (const { data } of await Promise.all(requests)) {
    for (const item of data) gifs.set(item.id, readGif(item))
  }
  return gifs
}