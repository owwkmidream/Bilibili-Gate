/* eslint-disable no-constant-condition */
import { baseDebug } from '$common'
import type { FetcherOptions } from '$components/RecGrid/useRefresh'
import { getColumnCount } from '$components/RecGrid/useShortcut'
import type { TabType } from '$components/RecHeader/tab.shared'
import { anyFilterEnabled, filterRecItems } from '$components/VideoCard/process/filter'
import { lookinto } from '$components/VideoCard/process/normalize'
import type { RecItemType } from '$define'
import { uniqBy } from 'lodash'
import { AppRecService } from './app'
import { PcRecService } from './pc'

const debug = baseDebug.extend('service')

export const recItemUniqer = (item: RecItemType) =>
  lookinto<string | number>(item, {
    'pc': (item) => item.id,
    'app': (item) => item.param,
    'dynamic': (item) => item.modules.module_dynamic.major.archive.aid,
    'watchlater': (item) => item.bvid,
    'fav': (item) => item.bvid,
    'popular-general': (item) => item.bvid,
  })

export function uniqConcat(existing: RecItemType[], newItems: RecItemType[]) {
  const ids = existing.map(recItemUniqer)
  newItems = uniqBy(newItems, recItemUniqer)
  return existing.concat(
    newItems.filter((item) => {
      return !ids.includes(recItemUniqer(item))
    })
  )
}

export const usePcApi = (tab: TabType) => tab === 'keep-follow-only' || tab === 'recommend-pc'

export async function getMinCount(
  count: number,
  fetcherOptions: FetcherOptions,
  filterMultiplier = 5
) {
  const {
    tab,
    abortSignal,
    pcRecService,
    dynamicFeedService,
    watchLaterService,
    favService,
    popularGeneralService,
  } = fetcherOptions
  const appRecService = new AppRecService()

  let items: RecItemType[] = []
  let hasMore = true

  const addMore = async (restCount: number) => {
    let cur: RecItemType[] = []

    if (
      tab === 'dynamic-feed' ||
      tab === 'watchlater' ||
      tab === 'fav' ||
      tab === 'popular-general'
    ) {
      switch (tab) {
        // 动态
        case 'dynamic-feed':
          cur = (await dynamicFeedService.loadMore(abortSignal)) || []
          hasMore = dynamicFeedService.hasMore
          break

        // 稍候再看
        case 'watchlater':
          cur = (await watchLaterService.loadMore()) || []
          hasMore = watchLaterService.hasMore
          break

        // 收藏
        case 'fav':
          cur = (await favService.loadMore()) || []
          hasMore = favService.hasMore
          break

        // 综合热门
        case 'popular-general':
          cur = (await popularGeneralService.loadMore()) || []
          hasMore = popularGeneralService.hasMore
          break

        default:
          break
      }

      items = items.concat(cur)
      return
    }

    let times: number

    // 已关注
    if (tab === 'keep-follow-only') {
      times = 8
      debug('getMinCount: addMore(restCount = %s) times=%s', restCount, times)
    }

    // 常规
    else {
      const pagesize = usePcApi(tab) ? PcRecService.PAGE_SIZE : AppRecService.PAGE_SIZE

      const multipler = anyFilterEnabled(tab)
        ? filterMultiplier // 过滤, 需要大基数
        : 1.2 // 可能有重复, so not 1.0

      times = Math.ceil((restCount * multipler) / pagesize)

      debug(
        'getMinCount: addMore(restCount = %s) multipler=%s pagesize=%s times=%s',
        restCount,
        multipler,
        pagesize,
        times
      )
    }

    cur = usePcApi(tab)
      ? await pcRecService.getRecommendTimes(times, abortSignal)
      : await appRecService.getRecommendTimes(times)
    cur = filterRecItems(cur, tab)

    items = items.concat(cur)
    items = uniqBy(items, recItemUniqer)
  }

  await addMore(count)
  while (true) {
    // aborted
    if (abortSignal?.aborted) {
      debug('getMinCount: break for abortSignal')
      break
    }
    // no more
    if (!hasMore) {
      debug('getMinCount: break for tab=%s hasMore=false', tab)
      break
    }

    // enough
    if (items.length >= count) break
    await addMore(count - items.length)
  }

  return items
}

export async function refreshForHome(fetcherOptions: FetcherOptions) {
  let items = await getMinCount(getColumnCount(undefined, false) * 2, fetcherOptions, 5) // 7 * 2-row
  if (fetcherOptions.tab === 'watchlater') {
    items = items.slice(0, 20)
  }
  return items
}

export async function refreshForGrid(fetcherOptions: FetcherOptions) {
  return getMinCount(getColumnCount() * 3 + 1, fetcherOptions, 5) // 7 * 3-row, 1 screen
}

export async function getRecommendTimes(times: number, tab: TabType, pcRecService: PcRecService) {
  let items: RecItemType[] = usePcApi(tab)
    ? await pcRecService.getRecommendTimes(times)
    : await new AppRecService().getRecommendTimes(times)
  items = filterRecItems(items, tab)
  return items
}
