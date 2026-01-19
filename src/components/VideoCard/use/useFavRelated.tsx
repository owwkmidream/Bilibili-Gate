import { useMemoizedFn } from 'ahooks'
import clsx from 'clsx'
import { assert, delay } from 'es-toolkit'
import { useMemo, useState } from 'react'
import {
  handleModifyFavItemToFolder,
  startModifyFavItemToFolder,
  startPickFavFolder,
} from '$components/ModalFavManager'
import { getMultiSelectedItems } from '$components/RecGrid/rec-grid-state'
import { ETab } from '$components/RecHeader/tab-enum'
import { isFav, isLiked, isWatchlater, type RecItemType } from '$define'
import { antMessage, antModal, defineAntMenus } from '$modules/antd'
import {
  IconAnimatedChecked,
  IconForDelete,
  IconForEdit,
  IconForFav,
  IconForFaved,
  IconForLoading,
  IconForOpenExternalLink,
} from '$modules/icon'
import { multiSelectStore } from '$modules/multi-select/store'
import { defaultFavFolderTitle, UserFavApi } from '$modules/rec-services/fav/api'
import { formatFavCollectionUrl, formatFavFolderUrl } from '$modules/rec-services/fav/fav-url'
import { clearFavFolderAllItemsCache } from '$modules/rec-services/fav/service/fav-folder'
import { FavQueryKey, favStore } from '$modules/rec-services/fav/store'
import toast from '$utility/toast'
import { VideoCardActionButton } from '../child-components/VideoCardActions'
import { clsContextMenuIcon } from '../context-menus'
import { getLinkTarget } from './useOpenRelated'
import type { RecSharedEmitter } from '$components/Recommends/rec.shared'
import type { IVideoCardData } from '$modules/filter/normalize'

export type FavContext = ReturnType<typeof useInitFavContext>

export function useInitFavContext(item: RecItemType, avid: string | undefined) {
  const [folderNames, setFolderNames] = useState<string[] | undefined>(undefined)
  const [folderUrls, setFolderUrls] = useState<string[] | undefined>(undefined)
  const [folderIds, setFolderIds] = useState<number[] | undefined>(undefined)

  const updateFavFolderNames = useMemoizedFn(async () => {
    // 只在「稍后再看」|「赞」|「收藏」提供收藏状态
    if (!(isWatchlater(item) || isLiked(item) || (isFav(item) && item.from === 'fav-folder'))) return
    if (!avid) return
    const result = await UserFavApi.getVideoFavState(avid)
    if (result) {
      setFolderNames(result.favFolderNames)
      setFolderUrls(result.favFolderUrls)
      setFolderIds(result.favFolderIds)
    }
  })

  return useMemo(
    () => ({ folderNames, folderUrls, folderIds, updateFavFolderNames }),
    [folderNames, folderUrls, folderIds, updateFavFolderNames],
  )
}

export function getWatchlaterTabFavMenus(ctx: FavContext, item: RecItemType, avid: string | undefined) {
  if (!isWatchlater(item) || !avid) return []
  const folderNames = ctx.folderNames ?? []
  const folderUrls = ctx.folderUrls ?? []
  const folderIds = ctx.folderIds ?? []

  const favedMenus = defineAntMenus([
    {
      // 浏览收藏夹
      key: 'watchlater-faved:browse-fav-folder',
      icon: <IconForFaved className={clsx(clsContextMenuIcon, 'color-gate-primary')} />,
      label: `已收藏在 ${(folderNames || []).map((n) => `「${n}」`).join('')}`,
      onClick() {
        folderUrls.forEach((u) => {
          window.open(u, getLinkTarget())
        })
      },
    },
    {
      // 修改收藏夹
      key: 'watchlater-faved:modify-fav',
      icon: <IconForEdit className={clsContextMenuIcon} />,
      label: '编辑收藏',
      async onClick() {
        assert(folderIds.length, 'folderIds.length should not be empty')
        await startModifyFavItemToFolder(folderIds, (targetFolder) => {
          return handleModifyFavItemToFolder(avid, folderIds, targetFolder)
        })
      },
    },
  ])

  const unfavedMenus = defineAntMenus([
    {
      // 快速收藏
      key: 'watchlater:add-quick-fav',
      icon: <IconForFav className={clsContextMenuIcon} />,
      label: '收藏到「默认收藏夹」',
      async onClick() {
        const success = await UserFavApi.addFav(avid)
        if (success) antMessage.success(`已加入收藏夹「${defaultFavFolderTitle}」`)
      },
    },
    {
      // 收藏
      key: 'watchlater:add-fav',
      icon: <IconForFav className={clsContextMenuIcon} />,
      label: '收藏到',
      async onClick() {
        await startPickFavFolder(async (targetFolder) => {
          const success = await UserFavApi.addFav(avid, targetFolder.id)
          if (success) antMessage.success(`已加入收藏夹「${targetFolder.title}」`)
          return success
        })
      },
    },
  ])

  const faved = !!folderNames.length
  return faved ? favedMenus : unfavedMenus
}

export function getFavTabMenus({
  ctx,
  item,
  cardData,
  tab,
  multiSelecting,
  multiSelectingAppendix,
  onRemoveCurrent,
  recSharedEmitter,
}: {
  ctx: FavContext
  item: RecItemType
  cardData: IVideoCardData
  tab: ETab
  multiSelecting: boolean | undefined
  multiSelectingAppendix: string
  onRemoveCurrent: ((item: RecItemType, data: IVideoCardData, silent?: boolean) => void | Promise<void>) | undefined
  recSharedEmitter: RecSharedEmitter
}) {
  if (!isFav(item)) return []

  const { avid } = cardData
  const folderNames = ctx.folderNames ?? []
  const folderUrls = ctx.folderUrls ?? []
  const folderIds = ctx.folderIds ?? []

  // 收藏夹
  if (item.from === 'fav-folder') {
    const batchMenus = multiSelecting
      ? [
          {
            key: 'fav:batch-move-fav',
            label: `移动到其他收藏夹${multiSelectingAppendix}`,
            icon: <IconParkOutlineTransferData className={clsContextMenuIcon} />,
            async onClick() {
              if (!multiSelectStore.multiSelecting) return

              const selectedFavItems = getMultiSelectedItems()
                .filter((x) => isFav(x) && x.from === 'fav-folder')
                .toReversed() // gui first item as queue last, keep first in target folder
              const folderIds = new Set(selectedFavItems.map((i) => i.folder.id))
              if (!folderIds.size) return toast('至少选择一项视频')
              if (folderIds.size > 1) return toast('多选移动: 只能批量移动同一源收藏夹下的视频')

              const srcFavFolderId = selectedFavItems[0].folder.id
              const resources = selectedFavItems.map((x) => `${x.id}:${x.type}`)
              const uniqIds = selectedFavItems.map((x) => x.uniqId)
              const titles = selectedFavItems.map((x) => x.title)

              await startModifyFavItemToFolder(
                [item.folder.id],
                async (targetFolder) => {
                  assert(targetFolder, 'targetFolder should not be empty')
                  const success = await UserFavApi.moveFavs(resources, srcFavFolderId, targetFolder.id)
                  if (!success) return

                  clearFavFolderAllItemsCache(item.folder.id)
                  clearFavFolderAllItemsCache(targetFolder.id)
                  recSharedEmitter.emit('remove-cards', [uniqIds, titles, true])
                  antMessage.success(`已移动 ${uniqIds.length} 个视频到「${targetFolder.title}」收藏夹`)
                  return success
                },
                false,
              )
            },
          },
        ]
      : []

    return defineAntMenus([
      {
        key: 'open-fav-folder',
        label: '浏览收藏夹',
        icon: <IconForOpenExternalLink className={clsContextMenuIcon} />,
        onClick() {
          const { id } = item.folder
          const url =
            tab !== ETab.Fav || (favStore.selectedKey === 'all' && favStore.usingShuffle)
              ? `/?${FavQueryKey.FolderIdFull}=${id}`
              : formatFavFolderUrl(id)
          window.open(url, getLinkTarget())
        },
      },
      {
        test: !!avid,
        key: 'modify-fav',
        icon: <IconForEdit className={clsContextMenuIcon} />,
        label: '编辑收藏',
        async onClick() {
          await startModifyFavItemToFolder(
            folderIds,
            async (targetFolder) => {
              const success = await handleModifyFavItemToFolder(avid!, folderIds, targetFolder)
              if (success && targetFolder?.id !== item.folder.id) onRemoveCurrent?.(item, cardData, true)
              return success
            },
            false,
          )
        },
      },
      {
        key: 'remove-fav',
        label: '移除收藏',
        icon: <IconForDelete className={clsContextMenuIcon} />,
        async onClick() {
          // 经常误操作, 点到这项, 直接移除了...
          const confirm = await antModal.confirm({
            centered: true,
            title: '移除收藏',
            content: (
              <>
                确定将视频「{item.title}」<br />
                从收藏夹「{item.folder.title}」中移除?
              </>
            ),
          })
          if (!confirm) return

          const resource = `${item.id}:${item.type}`
          const success = await UserFavApi.removeFavs(item.folder.id, resource)
          if (!success) return

          clearFavFolderAllItemsCache(item.folder.id)
          onRemoveCurrent?.(item, cardData)
        },
      },
      ...batchMenus,
    ])
  }

  // 合集
  if (item.from === 'fav-collection') {
    return defineAntMenus([
      {
        key: 'open-fav-collection',
        label: '浏览合集',
        icon: <IconForOpenExternalLink className={clsContextMenuIcon} />,
        onClick() {
          const { id } = item.collection
          const url =
            tab !== ETab.Fav || (favStore.selectedKey === 'all' && favStore.usingShuffle)
              ? `/?${FavQueryKey.CollectionIdFull}=${id}`
              : formatFavCollectionUrl(id)
          window.open(url, getLinkTarget())
        },
      },
    ])
  }

  // unexpected
  return []
}

/**
 * 收藏夹视频卡片的移除按钮 hook
 * 类似于稀后再看的移除按钮，点击后直接移除收藏（不二次确认）
 * 动画流程：删除图标 -> 转圈 -> 打钩动画 -> 卡片消失
 */
export function useFavRemoveButton({
  item,
  cardData,
  onRemoveCurrent,
  actionButtonVisible,
}: {
  item: RecItemType
  cardData: IVideoCardData
  onRemoveCurrent: ((item: RecItemType, data: IVideoCardData, silent?: boolean) => void | Promise<void>) | undefined
  actionButtonVisible: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [removed, setRemoved] = useState(false)

  const hasFavRemoveEntry = useMemo(() => {
    // 只在收藏夹视频上显示
    return isFav(item) && item.from === 'fav-folder'
  }, [item])

  const onRemove = useMemoizedFn(async (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()

    if (loading || removed) return
    if (!isFav(item) || item.from !== 'fav-folder') return

    setLoading(true)
    const resource = `${item.id}:${item.type}`
    const success = await UserFavApi.removeFavs(item.folder.id, resource)

    if (!success) {
      setLoading(false)
      return
    }

    clearFavFolderAllItemsCache(item.folder.id)

    // 先关闭 loading，然后显示打钩动画
    setLoading(false)
    setRemoved(true)

    // 等待动画完成后移除卡片 (IconAnimatedChecked 动画约 200ms)
    await delay(250)
    onRemoveCurrent?.(item, cardData)
  })

  const icon = (() => {
    if (loading) {
      return <IconForLoading className='size-16px' />
    }
    if (removed) {
      return <IconAnimatedChecked size={18} useAnimation />
    }
    return <IconForDelete className='size-16px' />
  })()

  const tooltip = removed ? '已移除收藏' : '移除收藏'

  const favRemoveButtonEl = hasFavRemoveEntry && (
    <VideoCardActionButton
      visible={actionButtonVisible}
      inlinePosition='left'
      icon={icon}
      tooltip={tooltip}
      onClick={onRemove}
    />
  )

  return { favRemoveButtonEl, hasFavRemoveEntry }
}
