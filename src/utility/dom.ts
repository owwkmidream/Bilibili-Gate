import { APP_NAME } from '$common'
import delay from 'delay'

const TIMEOUT = 10 * 1000
const DELAY_INTERVAL = 200

export async function tryAction(
  selector: string,
  action: (el: HTMLElement) => void | Promise<void>
) {
  let arr: HTMLElement[] = []
  const query = () => {
    arr = Array.from(document.querySelectorAll<HTMLElement>(selector))
  }
  query()

  const start = performance.now()
  let elapsed = 0
  while (!arr.length && (elapsed = performance.now() - start) < TIMEOUT) {
    await delay(DELAY_INTERVAL)
    query()
  }

  if (!arr.length) {
    console.log(`[${APP_NAME}]: tryAction timeout, selector = %s`, selector)
    return
  }

  for (const el of arr) {
    await Promise.resolve(action(el))
  }
}

/**
 * 尝试移除元素
 */

export function tryToRemove(selector: string) {
  return tryAction(selector, (el) => el.remove())
}

/**
 * input 输入种, 用于拦截快捷键处理
 */

export function isCurrentTyping() {
  // if activeElement is input, disable shortcut
  const activeTagName = (document.activeElement?.tagName || '').toLowerCase()
  if (['input', 'textarea'].includes(activeTagName)) {
    return true
  }

  // if search panel is open, disable shortcut
  if (document.querySelector('.center-search__bar.is-focus')) {
    return true
  }

  return false
}
