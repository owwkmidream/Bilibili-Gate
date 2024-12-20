import { baseDebug } from '$common'
import { CHARGE_ONLY_TEXT } from '$components/VideoCard/top-marks'
import { type DynamicFeedItem, type DynamicFeedItemExtend } from '$define'
import { EApiType } from '$define/index.shared'
import { settings } from '$modules/settings'
import { parseDuration } from '$utility'
import pmap from 'promise.map'
import { snapshot } from 'valtio'
import { QueueStrategy, type IService } from '../_base'
import { LiveRecService } from '../live'
import { fetchVideoDynamicFeeds } from './api'
import {
  hasLocalDynamicFeedCache,
  localDynamicFeedCache,
  performIncrementalUpdateIfNeed,
} from './cache'
import { parseSearchInput } from './cache/search'
import { getFollowGroupContent } from './group'
import {
  DynamicFeedVideoMinDuration,
  DynamicFeedVideoType,
  QUERY_DYNAMIC_MIN_ID,
  QUERY_DYNAMIC_MIN_TS,
  QUERY_DYNAMIC_OFFSET,
  QUERY_DYNAMIC_UP_MID,
  SELECTED_KEY_ALL,
  SELECTED_KEY_PREFIX_GROUP,
  SELECTED_KEY_PREFIX_UP,
  dfStore,
} from './store'
import { DynamicFeedUsageInfo } from './usage-info'

export type DynamicFeedServiceConfig = ReturnType<typeof getDynamicFeedServiceConfig>

export function getDynamicFeedServiceConfig() {
  const snap = snapshot(dfStore)
  return {
    /**
     * from dfStore
     */
    // UP | 分组
    upMid: snap.upMid,
    followGroupTagid: snap.selectedFollowGroup?.tagid,

    // 搜索
    searchText: snap.searchText,

    // 类型
    dynamicFeedVideoType: snap.dynamicFeedVideoType,
    hideChargeOnlyVideos: snap.hideChargeOnlyVideos,

    // 时长
    filterMinDuration: snap.filterMinDuration,
    filterMinDurationValue: snap.filterMinDurationValue,

    // flags
    hasSelectedUp: snap.hasSelectedUp,
    showFilter: snap.showFilter,
    selectedKey: snap.selectedKey,

    /**
     * from settings
     */
    showLiveInDynamicFeed: settings.dynamicFeedShowLive,

    whenViewAllEnableHideSomeContents: settings.dynamicFeedWhenViewAllEnableHideSomeContents,
    whenViewAllHideIds: new Set(settings.dynamicFeedWhenViewAllHideIds),

    advancedSearch: settings.dynamicFeedAdvancedSearch,
    searchCacheEnabled:
      !!snap.upMid &&
      settings.__internalDynamicFeedCacheAllItemsEntry && // the main switch
      settings.__internalDynamicFeedCacheAllItemsUpMids.includes(snap.upMid.toString()), // the switch for this up

    /**
     * from query
     */
    startingOffset: QUERY_DYNAMIC_OFFSET,
    minId: QUERY_DYNAMIC_MIN_ID,
    minTs: QUERY_DYNAMIC_MIN_TS,
  }
}

const debug = baseDebug.extend('modules:rec-services:dynamic-feed')

export class DynamicFeedRecService implements IService {
  static PAGE_SIZE = 15

  offset: string = ''
  page = 0 // pages loaded

  liveRecService: LiveRecService | undefined

  hasMoreDynFeed = true

  get hasMoreStreamingLive() {
    // has more streaming Live item
    if (this.liveRecService?.hasMore && !this.liveRecService.separatorAdded) {
      return true
    }
    return false
  }

  get hasMore() {
    return this.hasMoreStreamingLive || this.hasMoreDynFeed
  }

  constructor(public config: DynamicFeedServiceConfig) {
    // config live
    if (this.config.showLiveInDynamicFeed) {
      const filterEmpty =
        !this.upMid &&
        typeof this.followGroupTagid === 'undefined' &&
        !this.searchText &&
        this.dynamicFeedVideoType === DynamicFeedVideoType.All &&
        this.filterMinDuration === DynamicFeedVideoMinDuration.All
      if (filterEmpty) {
        this.liveRecService = new LiveRecService()
      }
    }

    // start offset
    if (this.config.startingOffset) {
      this.offset = this.config.startingOffset
    }
  }

  /**
   * shortcuts for ServiceConfig(this.config)
   */
  get upMid() {
    return this.config.upMid
  }
  // NOTE: number | undefined 默认分组是 0
  get followGroupTagid() {
    return this.config.followGroupTagid
  }
  get searchText() {
    return this.config.searchText
  }
  get dynamicFeedVideoType() {
    return this.config.dynamicFeedVideoType
  }
  get hideChargeOnlyVideos() {
    return this.config.hideChargeOnlyVideos
  }
  get filterMinDuration() {
    return this.config.filterMinDuration
  }
  get filterMinDurationValue() {
    return this.config.filterMinDurationValue
  }
  get hasSelectedUp() {
    return this.config.hasSelectedUp
  }
  get showFilter() {
    return this.config.showFilter
  }

  get viewingSomeGroup() {
    return typeof this.config.followGroupTagid === 'number'
  }
  private currentFollowGroupMids = new Set<number>()
  private async loadFollowGroupMids() {
    if (typeof this.followGroupTagid !== 'number') return // no need
    if (this.currentFollowGroupMids.size) return // loaded
    const mids = await getFollowGroupContent(this.followGroupTagid)
    this.currentFollowGroupMids = new Set(mids)
  }

  get viewingAll() {
    return this.config.selectedKey === SELECTED_KEY_ALL
  }
  private whenViewAllHideMids = new Set<string>()
  private whenViewAllHideMidsLoaded = false
  private async loadWhenViewAllHideMids() {
    // no need
    if (!this.viewingAll) return
    if (!this.config.whenViewAllEnableHideSomeContents) return
    if (!this.config.whenViewAllHideIds.size) return
    // loaded
    if (this.whenViewAllHideMidsLoaded) return

    const mids = Array.from(this.config.whenViewAllHideIds)
      .filter((x) => x.startsWith(SELECTED_KEY_PREFIX_UP))
      .map((x) => x.slice(SELECTED_KEY_PREFIX_UP.length))
    const groupIds = Array.from(this.config.whenViewAllHideIds)
      .filter((x) => x.startsWith(SELECTED_KEY_PREFIX_GROUP))
      .map((x) => x.slice(SELECTED_KEY_PREFIX_GROUP.length))

    const set = this.whenViewAllHideMids
    mids.forEach((x) => set.add(x))

    const midsInGroup = (await pmap(groupIds, async (id) => getFollowGroupContent(id), 3)).flat()
    midsInGroup.forEach((x) => set.add(x.toString()))

    this.whenViewAllHideMidsLoaded = true
  }

  private _cacheQueue: QueueStrategy<DynamicFeedItem> | undefined

  async loadMore(signal: AbortSignal | undefined = undefined) {
    if (!this.hasMore) {
      return
    }

    // load live first
    if (this.liveRecService && this.hasMoreStreamingLive) {
      const items = (await this.liveRecService.loadMore()) || []
      const hasSep = items.some((x) => x.api === EApiType.Separator)
      if (!hasSep) {
        return items
      } else {
        const idx = items.findIndex((x) => x.api === EApiType.Separator)
        return items.slice(0, idx)
      }
    }

    let rawItems: DynamicFeedItem[]

    // use search cache
    const useSearchCache = !!(
      this.upMid &&
      this.searchText &&
      this.config.searchCacheEnabled &&
      (await hasLocalDynamicFeedCache(this.upMid))
    )
    const useAdvancedSearch = useSearchCache && this.config.advancedSearch
    const useAdvancedSearchParsed = useAdvancedSearch
      ? parseSearchInput((this.searchText || '').toLowerCase())
      : undefined

    if (useSearchCache) {
      // fill queue with pre-filtered cached-items
      if (!this._cacheQueue) {
        await performIncrementalUpdateIfNeed(this.upMid)
        this._cacheQueue = new QueueStrategy<DynamicFeedItem>(20)
        this._cacheQueue.bufferQueue = ((await localDynamicFeedCache.get(this.upMid)) || []).filter(
          (x) => {
            const title = x?.modules?.module_dynamic?.major?.archive?.title || ''
            return filterBySearchText({
              searchText: this.searchText!,
              title,
              useAdvancedSearch,
              useAdvancedSearchParsed,
            })
          },
        )
      }
      // slice
      rawItems = this._cacheQueue.sliceFromQueue(this.page + 1) || []
      this.page++
      this.hasMoreDynFeed = !!this._cacheQueue.bufferQueue.length
      // offset not needed
    }

    // normal
    else {
      // 未登录会直接 throw err
      const data = await fetchVideoDynamicFeeds({
        signal,
        page: this.page + 1, // ++this.page, starts from 1, 实测 page 没啥用, 分页基于 offset
        offset: this.offset,
        upMid: this.upMid,
      })
      this.page++
      this.hasMoreDynFeed = data.has_more
      this.offset = data.offset
      rawItems = data.items

      /**
       * stop load more if there are `update since` conditions
       */
      if (this.config.minId && /^\d+$/.test(this.config.minId)) {
        const minId = BigInt(this.config.minId)
        const idx = rawItems.findIndex((x) => BigInt(x.id_str) <= minId)
        if (idx !== -1) {
          this.hasMoreDynFeed = false
          rawItems = rawItems.slice(0, idx + 1) // include minId
        }
      }
      if (this.config.minTs && /^\d+$/.test(this.config.minTs)) {
        const minTs = Number(this.config.minTs)
        const idx = rawItems.findIndex((x) => x.modules.module_author.pub_ts <= minTs)
        if (idx !== -1) {
          this.hasMoreDynFeed = false
          rawItems = rawItems.slice(0, idx + 1) // include minTs
        }
      }
    }

    // viewingSomeGroup: ensure current follow-group's mids loaded
    if (this.viewingSomeGroup) {
      await this.loadFollowGroupMids()
    }

    // viewingAll: ensure hide contents from these mids loaded
    if (this.viewingAll) {
      await this.loadWhenViewAllHideMids()
      debug('viewingAll: hide-mids = %o', this.whenViewAllHideMids)
    }

    const items: DynamicFeedItemExtend[] = rawItems

      // by 关注分组
      .filter((x) => {
        if (!this.viewingSomeGroup) return true
        if (!this.currentFollowGroupMids.size) return true
        const mid = x?.modules?.module_author?.mid
        if (!mid) return true
        return this.currentFollowGroupMids.has(mid)
      })

      // by 动态视频|投稿视频
      .filter((x) => {
        // only when the filter UI visible
        if (!this.showFilter) return true
        // all
        if (this.dynamicFeedVideoType === DynamicFeedVideoType.All) return true
        // type only
        const currentLabel = x.modules.module_dynamic.major.archive.badge.text as string
        if (this.dynamicFeedVideoType === DynamicFeedVideoType.DynamicOnly) {
          return currentLabel === '动态视频'
        }
        if (this.dynamicFeedVideoType === DynamicFeedVideoType.UploadOnly) {
          return currentLabel === '投稿视频' || currentLabel === CHARGE_ONLY_TEXT
        }
        return false
      })

      // by 充电专属
      .filter((x) => {
        // only when the filter UI visible
        if (!this.showFilter) return true
        if (!this.hideChargeOnlyVideos) return true
        const chargeOnly =
          (x.modules?.module_dynamic?.major?.archive?.badge?.text as string) === CHARGE_ONLY_TEXT
        return !chargeOnly
      })

      // by 最短时长
      .filter((x) => {
        // only when the filter UI visible
        if (!this.showFilter) return true
        if (this.filterMinDuration === DynamicFeedVideoMinDuration.All) return true

        const v = x.modules.module_dynamic.major.archive
        const duration = parseDuration(v.duration_text)
        return duration >= this.filterMinDurationValue
      })

      // by 关键字搜索
      .filter((x) => {
        // only when the filter UI visible
        if (!this.showFilter) return true
        if (!this.searchText) return true
        const title = x?.modules?.module_dynamic?.major?.archive?.title || ''
        return filterBySearchText({
          searchText: this.searchText,
          title,
          useAdvancedSearch,
          useAdvancedSearchParsed,
        })
      })

      // 在「全部」动态中隐藏 UP 的动态
      .filter((x) => {
        if (this.config.selectedKey !== SELECTED_KEY_ALL) return true
        const set = this.whenViewAllHideMids
        if (!set.size) return true
        const mid = x?.modules?.module_author?.mid
        if (!mid) return true
        return !set.has(mid.toString())
      })

      .map((item) => {
        return {
          ...item,
          api: EApiType.Dynamic,
          uniqId: item.id_str || crypto.randomUUID(),
        }
      })

    /**
     * filter functions
     */
    function filterBySearchText({
      title,
      searchText,
      useAdvancedSearch,
      useAdvancedSearchParsed,
    }: {
      title: string
      searchText: string
      useAdvancedSearch: boolean
      useAdvancedSearchParsed?: ReturnType<typeof parseSearchInput>
    }) {
      title = title.toLowerCase()
      searchText = searchText.toLowerCase()

      // 简单搜索
      const simpleSearch = () => title.includes(searchText)

      // 高级搜索
      const advancedSearch = () => {
        return (
          (useAdvancedSearchParsed?.includes ?? []).every((x) => title.includes(x)) &&
          (useAdvancedSearchParsed?.excludes ?? []).every((x) => !title.includes(x))
        )
      }

      return useAdvancedSearch ? advancedSearch() : simpleSearch()
    }

    /**
     * side effects
     */

    // fill up-name when filter up via query
    const { upMid, upName } = dfStore
    if (
      //
      QUERY_DYNAMIC_UP_MID &&
      upMid &&
      upName &&
      upName === upMid.toString() &&
      items[0]
    ) {
      const authorName = items[0].modules.module_author.name
      dfStore.upName = authorName
    }

    return items
  }

  get usageInfo(): ReactNode {
    return <DynamicFeedUsageInfo />
  }
}
