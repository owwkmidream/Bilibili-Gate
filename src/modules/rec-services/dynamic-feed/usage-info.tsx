import { flexVerticalCenterStyle, iconOnlyRoundButtonCss } from '$common/emotion-css'
import { CheckboxSettingItem } from '$components/ModalSettings/setting-item'
import { copyBvidInfos, copyBvidsSingleLine } from '$components/RecGrid/unsafe-window-export'
import { useOnRefreshContext } from '$components/RecGrid/useRefresh'
import { CHARGE_ONLY_TEXT } from '$components/VideoCard/top-marks'
import { HelpInfo } from '$components/_base/HelpInfo'
import { AntdTooltip } from '$components/_base/antd-custom'
import { colorPrimaryValue } from '$components/css-vars'
import { IconPark } from '$modules/icon/icon-park'
import { settings, updateSettings, useSettingsSnapshot } from '$modules/settings'
import { AntdMessage } from '$utility'
import { getAvatarSrc } from '$utility/image'
import type { AntdMenuItemType } from '$utility/type'
import { useRequest } from 'ahooks'
import { Avatar, Badge, Button, Checkbox, Dropdown, Input, Popover, Radio, Space } from 'antd'
import type { CheckboxChangeEvent } from 'antd/es/checkbox'
import { delay, throttle } from 'es-toolkit'
import { fastSortWithOrders } from 'fast-sort-lens'
import { useSnapshot } from 'valtio'
import TablerFilter from '~icons/tabler/filter'
import TablerFilterCheck from '~icons/tabler/filter-check'
import { usePopupContainer } from '../_base'
import {
  createUpdateSearchCacheNotifyFns,
  hasLocalDynamicFeedCache,
  localDynamicFeedInfoCache,
  updateLocalDynamicFeedCache,
} from './cache'
import {
  DynamicFeedVideoMinDuration,
  DynamicFeedVideoMinDurationConfig,
  DynamicFeedVideoType,
  DynamicFeedVideoTypeLabel,
  dfStore,
  updateFilterData,
  type DynamicFeedStore,
  type UpMidType,
} from './store'

export function dynamicFeedFilterSelectUp(payload: Partial<typeof dfStore>) {
  Object.assign(dfStore, payload)
  // 选择了 up, 去除红点
  if (payload.upMid) {
    const item = dfStore.upList.find((x) => x.mid.toString() === payload.upMid)
    if (item) item.has_update = false
  }
}

const clearPayload: Partial<DynamicFeedStore> = {
  upMid: undefined,
  upName: undefined,
  searchText: undefined,
  selectedFollowGroup: undefined,
  dynamicFeedVideoType: DynamicFeedVideoType.All,
  filterMinDuration: DynamicFeedVideoMinDuration.All,
}

const S = {
  filterWrapper: css`
    padding-block: 10px;
  `,

  filterSection: css`
    min-width: 300px;
    margin-top: 10px;
    &:first-child {
      margin-top: 0;
    }

    .title {
      padding-left: 3px;
      font-size: 20px;
      ${flexVerticalCenterStyle}
    }
    .content {
      /* margin-top: 5px; */
    }
  `,
}

const flexBreak = (
  <div
    css={css`
      flex-basis: 100%;
      height: 0;
    `}
  />
)

export function DynamicFeedUsageInfo() {
  const { ref, getPopupContainer } = usePopupContainer()
  const onRefresh = useOnRefreshContext()

  const {
    dynamicFeedEnableFollowGroupFilter,
    __internalDynamicFeedAddCopyBvidButton: addCopyBvidButton,
    __internalDynamicFeedExternalSearchInput: externalSearchInput,
  } = useSettingsSnapshot()
  const {
    hasSelectedUp,
    upName,
    upMid,
    upList,
    followGroups,
    selectedFollowGroup,
    dynamicFeedVideoType,
    filterMinDuration,
    showFilter,
    searchText,
    selectedKey,
    hideChargeOnlyVideos,
  } = useSnapshot(dfStore)

  const showFilterBadge = useMemo(() => {
    return (
      showFilter &&
      !!(
        dynamicFeedVideoType !== DynamicFeedVideoType.All ||
        hideChargeOnlyVideos ||
        searchText ||
        filterMinDuration !== DynamicFeedVideoMinDuration.All
      )
    )
  }, [showFilter, dynamicFeedVideoType, hideChargeOnlyVideos, searchText, filterMinDuration])

  // try update on mount
  useMount(() => {
    updateFilterData()
  })

  const onSelect = useMemoizedFn(async (payload: Partial<typeof dfStore>) => {
    dynamicFeedFilterSelectUp(payload)
    await delay(100)
    onRefresh?.()
  })

  const onClear = useMemoizedFn(() => {
    onSelect({ ...clearPayload })
  })

  const menuItems = useMemo((): AntdMenuItemType[] => {
    const itemAll: AntdMenuItemType = {
      key: 'all',
      icon: <Avatar size={'small'}>全</Avatar>,
      label: '全部',
      onClick: onClear,
    }

    let groupItems: AntdMenuItemType[] = []
    if (dynamicFeedEnableFollowGroupFilter) {
      groupItems = followGroups.map((group) => {
        return {
          key: `group:${group.tagid}`,
          label: group.name,
          icon: <Avatar size={'small'}>组</Avatar>,
          onClick() {
            onSelect({ ...clearPayload, selectedFollowGroup: structuredClone({ ...group }) })
          },
        }
      })
    }

    function mapName(name: string) {
      return (
        name
          .toLowerCase()
          // 让字母在前面
          .replace(/^([a-z])/, '999999$1')
      )
    }

    const upListSorted = fastSortWithOrders(upList, [
      { prop: (it) => (it.has_update ? 1 : 0), order: 'desc' },
      {
        prop: 'uname',
        order: (a: string, b: string) => {
          ;[a, b] = [a, b].map(mapName)
          return a.localeCompare(b, 'zh-CN')
        },
      },
    ])

    const items: AntdMenuItemType[] = upListSorted.map((up) => {
      let avatar: ReactNode = <Avatar size={'small'} src={getAvatarSrc(up.face)} />
      if (up.has_update) {
        avatar = <Badge dot>{avatar}</Badge>
      }

      return {
        key: `up:${up.mid}`,
        icon: avatar,
        // label: up.uname,
        label: (
          <span
            title={up.uname}
            css={css`
              display: block;
              max-width: 130px;
              text-overflow: ellipsis;
              white-space: nowrap;
              overflow: hidden;
            `}
          >
            {up.uname}
          </span>
        ),
        onClick() {
          onSelect({ ...clearPayload, upMid: up.mid.toString(), upName: up.uname })
        },
      }
    })

    return [itemAll, ...groupItems, ...items]
  }, [upList, upList.map((x) => !!x.has_update), dynamicFeedEnableFollowGroupFilter])

  const searchInput = (
    <Input.Search
      style={{ width: externalSearchInput ? '250px' : '97%' }}
      placeholder='按标题关键字过滤'
      type='search'
      autoCorrect='off'
      autoCapitalize='off'
      name={`searchText_${upMid}`}
      // 有自带的历史记录, 何乐而不为
      // 悬浮 autocomplete 时 popover 关闭了
      // autoComplete='on'
      variant='outlined'
      defaultValue={dfStore.searchText}
      autoComplete='off'
      allowClear
      onChange={(e) => {
        tryInstantSearchWithCache({ searchText: e.target.value, upMid, onRefresh })
      }}
      onSearch={async (val) => {
        dfStore.searchText = val || undefined
        await delay(100)
        onRefresh?.()
      }}
    />
  )

  const filterPopoverContent = (
    <div css={S.filterWrapper}>
      <div className='section' css={S.filterSection}>
        <div className='title'>
          视频类型
          <HelpInfo>
            「{CHARGE_ONLY_TEXT}」在此程序中归类为「投稿视频」
            <br />
            「动态视频」时长通常较短
          </HelpInfo>
        </div>
        <div className='content'>
          <Radio.Group
            buttonStyle='solid'
            value={dynamicFeedVideoType}
            onChange={async (v) => {
              dfStore.dynamicFeedVideoType = v.target.value
              await delay(100)
              onRefresh?.()
            }}
          >
            {Object.values(DynamicFeedVideoType).map((v) => {
              return (
                <Radio.Button key={v} value={v}>
                  {DynamicFeedVideoTypeLabel[v]}
                </Radio.Button>
              )
            })}
          </Radio.Group>
        </div>
      </div>

      {dynamicFeedVideoType !== DynamicFeedVideoType.DynamicOnly && (
        <div className='section' css={S.filterSection}>
          <div className='title'>充电专属</div>
          <div className='content' css={flexVerticalCenterStyle}>
            <Checkbox
              checked={hideChargeOnlyVideos}
              onChange={async (e) => {
                const val = e.target.checked
                const set = dfStore.hideChargeOnlyVideosForKeysSet
                if (val) {
                  set.add(selectedKey)
                } else {
                  set.delete(selectedKey)
                }
                await delay(100)
                onRefresh?.()
              }}
              css={css`
                margin-left: 5px;
              `}
            >
              <AntdTooltip
                title={
                  <>
                    隐藏「{CHARGE_ONLY_TEXT}」视频
                    <br />
                    程序会针对 UP 或 分组记忆你的选择~
                  </>
                }
              >
                <span style={{ userSelect: 'none' }}>隐藏「{CHARGE_ONLY_TEXT}」</span>
              </AntdTooltip>
            </Checkbox>
          </div>
        </div>
      )}

      <div className='section' css={S.filterSection}>
        <div className='title'>最短时长</div>
        <div className='content'>
          <Radio.Group
            css={css`
              overflow: hidden;
              .ant-radio-button-wrapper {
                padding-inline: 10px; // 原始 15px
              }
            `}
            buttonStyle='solid'
            value={filterMinDuration}
            onChange={async (v) => {
              dfStore.filterMinDuration = v.target.value
              await delay(100)
              onRefresh?.()
            }}
          >
            {Object.values(DynamicFeedVideoMinDuration).map((k) => {
              const { label } = DynamicFeedVideoMinDurationConfig[k]
              return (
                <Radio.Button key={k} value={k}>
                  {label}
                </Radio.Button>
              )
            })}
          </Radio.Group>
        </div>
      </div>

      {!externalSearchInput && (
        <div className='section' css={S.filterSection}>
          <div className='title'>搜索</div>
          <div className='content'>{searchInput}</div>
        </div>
      )}

      <SearchCacheRelated />
    </div>
  )

  return (
    <>
      <Space ref={ref}>
        <Dropdown
          placement='bottomLeft'
          getPopupContainer={getPopupContainer}
          menu={{
            items: menuItems,
            style: { maxHeight: '60vh', overflowY: 'scroll' },
          }}
        >
          <Button>
            {upName
              ? `UP: ${upName}`
              : selectedFollowGroup
                ? `分组 - ${selectedFollowGroup.name}`
                : '全部'}
          </Button>
        </Dropdown>

        {(hasSelectedUp || selectedFollowGroup) && (
          <Button onClick={onClear} className='gap-0'>
            <IconPark name='Return' size={14} style={{ marginRight: 5 }} />
            <span>清除</span>
          </Button>
        )}

        {showFilter && (
          <Popover
            // open
            arrow={false}
            placement='bottomLeft'
            getPopupContainer={getPopupContainer}
            content={filterPopoverContent}
          >
            <Badge dot={showFilterBadge} color={colorPrimaryValue} offset={[-5, 5]}>
              <Button css={iconOnlyRoundButtonCss}>
                {showFilterBadge ? <TablerFilterCheck /> : <TablerFilter />}
              </Button>
            </Badge>
          </Popover>
        )}

        {externalSearchInput && searchInput}

        {addCopyBvidButton && (
          <>
            <Button
              onClick={() => {
                copyBvidsSingleLine()
                AntdMessage.success('已复制')
              }}
            >
              Copy Bvids SingleLine
            </Button>
            <Button
              onClick={() => {
                copyBvidInfos()
                AntdMessage.success('已复制')
              }}
            >
              Copy Bvid Infos
            </Button>
          </>
        )}
      </Space>
    </>
  )
}

function SearchCacheRelated() {
  const { __internalDynamicFeedCacheAllItemsEntry, __internalDynamicFeedCacheAllItemsUpMids } =
    useSettingsSnapshot()
  const { hasSelectedUp, upMid, upName } = useSnapshot(dfStore)

  const $req = useRequest(
    async (upMid: UpMidType, upName: string) => {
      const { notifyOnProgress, notifyOnSuccess } = createUpdateSearchCacheNotifyFns(upMid, upName)
      await updateLocalDynamicFeedCache(upMid, notifyOnProgress)
      notifyOnSuccess()
    },
    {
      manual: true,
    },
  )

  const checked = useMemo(
    () => !!upMid && __internalDynamicFeedCacheAllItemsUpMids.includes(upMid.toString()),
    [upMid, __internalDynamicFeedCacheAllItemsUpMids],
  )
  const onChange = useCallback((e: CheckboxChangeEvent) => {
    if (!upMid) return
    const val = e.target.checked

    const set = new Set(settings.__internalDynamicFeedCacheAllItemsUpMids)
    if (val) {
      set.add(upMid.toString())
    } else {
      set.delete(upMid.toString())
    }
    updateSettings({ __internalDynamicFeedCacheAllItemsUpMids: Array.from(set) })
  }, [])

  return (
    <>
      {__internalDynamicFeedCacheAllItemsEntry && hasSelectedUp && upMid && upName && (
        <div className='section' css={S.filterSection}>
          <div className='title'>
            搜索缓存
            <HelpInfo>
              开启搜索缓存后, 会加载并缓存 UP 所有的动态 <br />
              {'当本地有缓存且总条数 <= 5000时, 搜索框成为及时搜索, 无需点击搜索按钮'}
            </HelpInfo>
          </div>
          <div className='content'>
            <div className='flex gap-y-3 gap-x-10 flex-wrap'>
              <Checkbox className='inline-flex items-center' checked={checked} onChange={onChange}>
                <AntdTooltip title='只有开启此项, 搜索时才会使用缓存'>
                  <span>为「{upName}」开启</span>
                </AntdTooltip>
              </Checkbox>
              <Button
                loading={$req.loading}
                onClick={async () => {
                  await $req.runAsync(upMid, upName)
                }}
              >
                更新缓存
              </Button>
              {flexBreak}

              <CheckboxSettingItem
                configKey='dynamicFeedAdvancedSearch'
                label={'使用高级搜索'}
                tooltip={
                  <>
                    高级搜索 <br />
                    1. 可以使用多个搜索词, 用空格分隔, 逻辑关系为且 (AND) <br />
                    2. 可以使用引号包裹搜索词, 如 "word or sentence" <br />
                    2. 可以使用 -"word or sentence" 排除关键词 <br />
                  </>
                }
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const tryInstantSearchWithCache = throttle(async function ({
  searchText,
  upMid,
  onRefresh,
}: {
  searchText: string
  upMid?: UpMidType | undefined
  onRefresh?: () => void
}) {
  if (!upMid) return
  if (!(searchText || (!searchText && dfStore.searchText))) return
  if (!settings.__internalDynamicFeedCacheAllItemsEntry) return // feature not enabled
  if (!settings.__internalDynamicFeedCacheAllItemsUpMids.includes(upMid.toString())) return // up not checked
  if (!(await hasLocalDynamicFeedCache(upMid))) return // cache not exist

  // cached info
  const info = await localDynamicFeedInfoCache.get(upMid)
  if (!info || !info.count) return
  if (info.count >= 5000) return // for bad performance

  // instant search
  dfStore.searchText = searchText
  await delay(0)
  onRefresh?.()
}, 100)
