import { useHover } from 'ahooks'
import { limitFunction } from 'promise.map'
import { useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useUnoMerge } from 'unocss-merge/react'
import { APP_CLS_CARD, APP_CLS_CARD_COVER, APP_NAMESPACE } from '$common'
import { AppRoot } from '$components/AppRoot'
import { useLargePreviewRelated } from '$components/LargePreview/useLargePreview'
import { defaultRecSharedEmitter } from '$components/Recommends/rec.shared'
import { VideoCardActionsClassNames } from '$components/VideoCard/child-components/VideoCardActions'
import { settings } from '$modules/settings'
import { isInIframe, setupForNoneHomepage } from './shared'

export function initDynamicPage() {
  if (isInIframe()) return // pagetual use iframe to load more
  setupForNoneHomepage()
  if (settings.videoCard.videoPreview.addTo.dynamicPage) {
    addLargePreviewForDynamicFeed()
  }
}

function addLargePreviewForDynamicFeed() {
  const run = limitFunction(() => {
    // 选择器匹配四种动态类型:
    // 1. 投稿视频 / 动态视频 / 合集更新 - .bili-dyn-card-video
    // 2. 动态转发的原视频 - .bili-dyn-content__orig 中的 .bili-dyn-card-video
    const itemsSelector = '.bili-dyn-card-video'
    const list = Array.from(document.querySelectorAll<HTMLAnchorElement>(itemsSelector))
    for (const el of list) addLargePreview(el)
  }, 1)

  run()
  const ob = new MutationObserver(() => run())
  ob.observe(document.body, { childList: true, subtree: true })
}

const processed = new WeakSet<HTMLElement>()
const processedAttr = `${APP_NAMESPACE}-add-large-preview-processed`

function addLargePreview(el: HTMLAnchorElement) {
  if (processed.has(el)) return
  if (el.getAttribute(processedAttr)) return

  // .bili-dyn-card-video__cover 的 overflow 是 visible，可以正常显示 tooltip
  // .bili-dyn-card-video__cover 的 position 是 relative，可以用绝对定位
  const coverEl = el.querySelector<HTMLDivElement>('.bili-dyn-card-video__cover')
  if (!coverEl) return

  // 为 LargePreview 组件添加必要的类名
  // LargePreview 的 getCoverRect 会查找 APP_CLS_CARD 和 APP_CLS_CARD_COVER 类名来定位
  el.classList.add(APP_CLS_CARD)
  coverEl.classList.add(APP_CLS_CARD_COVER)

  const container = document.createElement('div')
  coverEl.appendChild(container)
  processed.add(el)
  el.setAttribute(processedAttr, 'true')

  const root = createRoot(container)
  root.render(
    <AppRoot>
      <LargePreviewSetup el={el} coverEl={coverEl} />
    </AppRoot>,
  )
}

function LargePreviewSetup({ el, coverEl }: { el: HTMLAnchorElement; coverEl: HTMLDivElement }) {
  const { bvid = '', cover } = useMemo(() => parseCardInfo(el), [el])
  const cardEl = el
  const hovering = useHover(cardEl)
  const videoCardAsTriggerRef = useRef<HTMLElement | null>(coverEl)

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
      <div className={useUnoMerge(VideoCardActionsClassNames.top('left'), 'left-8px')}>
        {largePreviewActionButtonEl}
      </div>
      {/* portal 到 cover 而不是 cardEl，因为 cardEl 是 <a> 标签有 overflow: hidden */}
      {createPortal(largePreviewEl, coverEl)}
    </>
  )
}

function parseCardInfo(el: HTMLAnchorElement) {
  let bvid: string | undefined
  {
    // .bili-dyn-card-video 本身就是一个链接 <a href="//www.bilibili.com/video/BVxxx">
    const link = el.href
    if (link) {
      bvid = /\/video\/(?<bvid>BV\w+)/i.exec(link)?.groups?.bvid
    }
  }

  const cover = el.querySelector<HTMLImageElement>('.bili-dyn-card-video__cover img')?.src

  return { bvid, cover }
}
