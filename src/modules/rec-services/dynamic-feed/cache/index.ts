import type { DynamicFeedItem } from '$define'
import { getIdbCache } from '$utility/idb'
import { uniqBy } from 'es-toolkit'
import { fetchVideoDynamicFeeds } from '../api'

const cache = getIdbCache<DynamicFeedItem[]>('dynamic-feed-items')
const infoCache = getIdbCache<{ count: number; updatedAt: number }>('dynamic-feed-items-info') // cache.get is expensive
export { cache as localDynamicFeedCache, infoCache as localDynamicFeedInfoCache }

export async function hasLocalDynamicFeedCache(upMid: number) {
  const existing = await infoCache.get(upMid)
  return !!existing?.count
}

export async function updateLocalDynamicFeedCache(upMid: number) {
  if (await hasLocalDynamicFeedCache(upMid)) {
    // perform incremental update
    await performIncrementalUpdate(upMid)
  } else {
    // perform full update
    await performFullUpdate(upMid)
  }
}

/**
 * 近期已经更新过, 不要再更新了
 */
export async function performIncrementalUpdateIfNeed(upMid: number, force = false) {
  const info = await infoCache.get(upMid)
  if (!force && info && info.count && info.updatedAt && Date.now() - info.updatedAt < 60 * 1000) {
    return
  }
  return performIncrementalUpdate(upMid)
}

async function performIncrementalUpdate(upMid: number) {
  // it's built for "incremental"
  if (!(await hasLocalDynamicFeedCache(upMid))) return

  const existing = (await cache.get(upMid)) || []
  const existingIds = new Set(existing.map((x) => x.id_str))

  let page = 1
  let offset = ''
  let hasMore = true
  let newItems: DynamicFeedItem[] = []

  while (hasMore) {
    const data = await fetchVideoDynamicFeeds({ upMid, page, offset })
    const items = data.items
    newItems = [...newItems, ...items]
    offset = data.offset
    hasMore = data.has_more
    page++

    if (hasMore && existingIds.size) {
      const allIncluded = items.every((item) => existingIds.has(item.id_str))
      if (allIncluded) {
        hasMore = false
      }
    }
  }

  const allItems = uniqBy([...newItems, ...existing], (x) => x.id_str)
  await cache.set(upMid, allItems)
  await infoCache.set(upMid, { count: allItems.length, updatedAt: Date.now() })
}

const fullUpdateInProgressCache = getIdbCache<{
  page: number
  offset: string
  items: DynamicFeedItem[]
}>('dynamic-feed-items-in-progress')

async function performFullUpdate(upMid: number, skipCache = false) {
  const inProgressCached = skipCache ? undefined : await fullUpdateInProgressCache.get(upMid)
  let page = inProgressCached?.page ?? 1
  let offset = inProgressCached?.offset ?? ''
  let allItems: DynamicFeedItem[] = inProgressCached?.items ?? []
  let hasMore = true

  while (hasMore) {
    const data = await fetchVideoDynamicFeeds({ upMid, page, offset })
    const items = data.items
    allItems = [...allItems, ...items]
    offset = data.offset
    hasMore = data.has_more
    page++

    // save cache for future continuation
    await fullUpdateInProgressCache.set(upMid, { page, offset, items: allItems })
  }

  // completed
  const _allItems = uniqBy(allItems, (x) => x.id_str)
  await cache.set(upMid, _allItems)
  await infoCache.set(upMid, { count: _allItems.length, updatedAt: Date.now() })
  await fullUpdateInProgressCache.delete(upMid)
}