import { useHover } from 'ahooks'
import clsx from 'clsx'
import { limitFunction } from 'promise.map'
import { useEffect, useMemo, useRef, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useUnoMerge } from 'unocss-merge/react'
import { proxy, useSnapshot } from 'valtio'
import { APP_CLS_CARD, APP_CLS_CARD_COVER, APP_NAME, APP_NAMESPACE } from '$common'
import { AppRoot } from '$components/AppRoot'
import { useLargePreviewRelated } from '$components/LargePreview/useLargePreview'
import { defaultRecSharedEmitter } from '$components/Recommends/rec.shared'
import { VideoCardActionsClassNames } from '$components/VideoCard/child-components/VideoCardActions'
import { AntdTooltip } from '$modules/antd/custom'
import { IconForDynamicFeed, IconForSpaceUpload } from '$modules/icon'
import { DynamicFeedQueryKey } from '$modules/rec-services/dynamic-feed/store'
import { FavQueryKey } from '$modules/rec-services/fav/store'
import { IconForCollection } from '$modules/rec-services/fav/views'
import { SpaceUploadQueryKey } from '$modules/rec-services/space-upload/store'
import { settings } from '$modules/settings'
import { reusePendingPromise } from '$utility/async'
import { poll, tryAction } from '$utility/dom'
import { isInIframe, setupForNoneHomepage } from './shared'

export function initSpacePage() {
  if (isInIframe()) return
  setupForNoneHomepage()
  addDynEntry()
  if (settings.videoCard.videoPreview.addTo.spacePage) {
    addLargePreviewForSpacePage()
  }
}

const rootElId = `${APP_NAMESPACE}-${crypto.randomUUID()}`

async function addDynEntry() {
  if (!state.mid) return

  const oldSelector = '.h-action'
  const newSelector = '.upinfo .operations'
  await tryAction(
    [oldSelector, newSelector].join(','),
    (container) => {
      state.href = location.href
      state.usingNewSpacePage = container.matches(newSelector)
      getFollowedStatus()

      const rootEl = document.createElement('span')
      rootEl.id = rootElId
      rootEl.classList.add('mr-24px')
      container.prepend(rootEl)
      const root = createRoot(rootEl)
      root.render(
        <AppRoot>
          <ActionButtons />
        </AppRoot>,
      )
    },
    { pollTimeout: 10_000, pollInterval: 1_000 },
  )
}

const state = proxy({
  href: location.href,
  usingNewSpacePage: false,
  followed: false,

  get mid() {
    return parseMid(this.href)
  },

  get collectionId(): number | undefined {
    const u = new URL(this.href)

    // new: https://space.bilibili.com/<mid>/lists/<collection-id>?type=season
    {
      const reg = /https:\/\/space.bilibili.com\/(?<mid>\d+)\/lists\/(?<collectionId>\d+)(?:\?type=season)?/
      const match = this.href.match(reg)
      if (match?.groups?.collectionId && (u.searchParams.get('type') === 'season' || !u.searchParams.get('type'))) {
        return Number(match?.groups?.collectionId)
      }
    }

    // old: https://space.bilibili.com/<mid>/channel/collectiondetail?sid=<collection-id>
    {
      const reg = /https:\/\/space.bilibili.com\/\d+\/channel\/collectiondetail\?/
      if (reg.test(this.href)) {
        const u = new URL(this.href)
        const collectionId = u.searchParams.get('sid')?.trim()
        if (collectionId) {
          return Number(collectionId)
        }
      }
    }
  },

  get isCollectionPage() {
    return typeof this.collectionId === 'number'
  },

  get searchKeyword() {
    const reg = /https:\/\/space.bilibili.com\/\d+\/search/
    if (!reg.test(this.href)) return
    const searchParams = new URLSearchParams(location.search)
    const keyword = searchParams.get('keyword')
    return keyword ?? undefined
  },

  get isSearching() {
    return !!this.searchKeyword?.trim()
  },
})

const getFollowedStatus = reusePendingPromise(async () => {
  const followed = await poll(
    () => {
      const list = Array.from(document.querySelectorAll('.space-follow-btn')).filter(
        (el) => el.textContent?.trim() === '已关注',
      )
      if (list.length > 0) return true
    },
    { interval: 100, timeout: 5_000 },
  )
  state.followed = !!followed
})

if (window.navigation !== undefined) {
  window.navigation.addEventListener?.('navigatesuccess', () => {
    state.href = location.href
    getFollowedStatus()
  })
}

function ActionButtons() {
  const { mid, collectionId, followed, isSearching, searchKeyword } = useSnapshot(state)
  if (!mid) return

  const clsBtn = 'w-34px b-white/33% rounded-full hover:(b-gate-primary bg-gate-primary)'
  const clsIcon = 'size-17px'

  // 投稿
  let btnSpaceUpload: ReactNode
  {
    let href = `https://www.bilibili.com/?${SpaceUploadQueryKey.Mid}=${mid}`
    if (isSearching && searchKeyword) {
      href += `&${SpaceUploadQueryKey.SearchText}=${searchKeyword}`
    }
    btnSpaceUpload = (
      <ActionButton key='btnSpaceUpload' className={clsBtn} href={href} tooltip={`在「${APP_NAME}」中查看 UP 的投稿`}>
        <IconForSpaceUpload className={clsIcon} />
      </ActionButton>
    )
  }

  // 动态
  let btnDynamicFeed: ReactNode
  if (followed) {
    const href = `https://www.bilibili.com/?${DynamicFeedQueryKey.Mid}=${mid}`
    btnDynamicFeed = (
      <ActionButton key='btnDynamicFeed' className={clsBtn} href={href} tooltip={`在「${APP_NAME}」中查看 UP 的动态`}>
        <IconForDynamicFeed className={clsIcon} />
      </ActionButton>
    )
  }

  // 合集
  let btnViewCollection: ReactNode
  if (typeof collectionId === 'number') {
    btnViewCollection = (
      <ActionButton
        key='btnViewCollection'
        className={clsBtn}
        href={`https://www.bilibili.com/?${FavQueryKey.CollectionIdFull}=${collectionId}`}
        target='_blank'
        tooltip={`在「${APP_NAME}」中查看合集`}
      >
        <IconForCollection className={clsIcon} />
      </ActionButton>
    )
  }

  return (
    <span className='inline-flex items-center gap-x-8px'>
      {btnViewCollection}
      {btnSpaceUpload}
      {btnDynamicFeed}
    </span>
  )
}

function ActionButton({
  href,
  children,
  className,
  style,
  tooltip,
  ...restProps
}: ComponentProps<'a'> & { tooltip?: ReactNode }) {
  const { usingNewSpacePage } = useSnapshot(state)
  const _className = useUnoMerge(
    'h-34px w-150px flex cursor-pointer items-center justify-center b-1px b-white/20% rounded-6px b-solid bg-white/14% text-14px color-white font-700 transition-duration-300 transition-property-all hover:bg-white/40%',
    className,
  )
  const btn = usingNewSpacePage ? (
    <a {...restProps} href={href} className={_className} style={style}>
      {children}
    </a>
  ) : (
    <a
      href={href}
      className={clsx('h-f-btn', className)}
      style={{ width: 'auto', paddingInline: '15px', ...style }}
      {...restProps}
    >
      {children}
    </a>
  )

  if (tooltip) {
    return <AntdTooltip title={tooltip}>{btn}</AntdTooltip>
  } else {
    return btn
  }
}

function parseMid(href = location.href) {
  const url = new URL(href)
  const mid = url.pathname
    .split('/')
    .map((x) => x.trim())
    .find(Boolean)
  if (!mid || !/^\d+$/.test(mid)) return
  return mid
}

/**
 * 浮动预览功能
 * 用户空间页面使用 .bili-video-card 结构，与搜索页相同
 */

const previewProcessed = new WeakSet<HTMLDivElement>()
const previewProcessedAttr = `${APP_NAMESPACE}-space-large-preview-processed`

function addLargePreviewForSpacePage() {
  const run = limitFunction(() => {
    // 用户空间页面使用 .bili-video-card 结构
    const itemsSelector = '.bili-video-card'
    const list = Array.from(document.querySelectorAll<HTMLDivElement>(itemsSelector))
    for (const el of list) addLargePreviewToCard(el)
  }, 1)

  run()
  const ob = new MutationObserver(() => run())
  ob.observe(document.body, { childList: true, subtree: true })
}

function addLargePreviewToCard(el: HTMLDivElement) {
  if (previewProcessed.has(el)) return
  if (el.getAttribute(previewProcessedAttr)) return

  // 用户空间页封面: .bili-video-card__cover
  const coverEl = el.querySelector<HTMLDivElement>('.bili-video-card__cover')
  if (!coverEl) return

  // 为 LargePreview 组件添加必要的类名
  // LargePreview 的 getCoverRect 会查找 APP_CLS_CARD 和 APP_CLS_CARD_COVER 类名来定位
  el.classList.add(APP_CLS_CARD)
  coverEl.classList.add(APP_CLS_CARD_COVER)

  const container = document.createElement('div')
  coverEl.appendChild(container)
  previewProcessed.add(el)
  el.setAttribute(previewProcessedAttr, 'true')

  const root = createRoot(container)
  root.render(
    <AppRoot>
      <SpaceLargePreviewSetup el={el} coverEl={coverEl} />
    </AppRoot>,
  )
}

function SpaceLargePreviewSetup({ el, coverEl }: { el: HTMLDivElement; coverEl: HTMLDivElement }) {
  const { bvid = '', cover } = useMemo(() => parseSpaceCardInfo(el), [el])
  const cardEl = el
  const hovering = useHover(cardEl)
  const videoCardAsTriggerRef = useRef<HTMLElement | null>(coverEl)

  // 修复层级问题：
  // 1. 浮动窗口被相邻卡片遮挡：hover 时提升当前卡片 z-index
  // 2. 浮动预览被官方 UI 遮挡：按钮使用更高的 z-index
  useEffect(() => {
    if (hovering) {
      cardEl.style.zIndex = '1000'
    } else {
      cardEl.style.removeProperty('z-index')
    }
  }, [hovering, cardEl])

  const { largePreviewActionButtonEl, largePreviewEl } = useLargePreviewRelated({
    shouldFetchPreviewData: !!bvid,
    hasLargePreviewActionButton: true,
    actionButtonVisible: hovering,
    actionButtonProps: {
      inlinePosition: 'left', // tooltip 向右展开，避免被左边界裁剪
      useMotion: true,
      motionProps: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: { delay: 0 } },
        transition: { duration: 0.15, ease: 'linear', delay: 0 },
      },
    },
    // required
    bvid,
    cid: undefined,
    uniqId: bvid,
    recSharedEmitter: defaultRecSharedEmitter,
    cardTarget: cardEl,
    // optional
    cover,
    videoCardAsTriggerRef,
  })

  return (
    <>
      {/* 放在左上角，避免遮挡右上角的官方稍后再看按钮 */}
      {/* 官方稍后再看按钮 z-index 为 200，我们使用 z-[300] 确保覆盖 */}
      <div className={useUnoMerge(VideoCardActionsClassNames.top('left'), 'left-8px z-[300]')}>
        {largePreviewActionButtonEl}
      </div>
      {/* portal 到 cover 而不是 cardEl */}
      {createPortal(largePreviewEl, coverEl)}
    </>
  )
}

function parseSpaceCardInfo(el: HTMLDivElement) {
  let bvid: string | undefined
  {
    // 用户空间页链接结构: .bili-video-card__cover > a.bili-cover-card
    // 使用更通用的选择器查找视频链接
    const link = el.querySelector<HTMLAnchorElement>('a[href*="/video/"]')?.href
    if (link) {
      bvid = /\/video\/(?<bvid>BV\w+)/i.exec(link)?.groups?.bvid
    }
  }

  const cover = el.querySelector<HTMLImageElement>('.bili-video-card__cover img')?.src

  return { bvid, cover }
}
