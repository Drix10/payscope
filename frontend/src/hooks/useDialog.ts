import { useEffect, useRef, RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function useDialog(ref: RefObject<HTMLElement>, onClose: () => void, enabled = true) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!enabled) return
    const dialog = ref.current
    if (!dialog) return
    const previousActiveElement = document.activeElement as HTMLElement | null
    const appContent = document.querySelector<HTMLElement>('[data-app-content]')
    const previousAriaHidden = appContent?.getAttribute('aria-hidden')
    const previousInert = appContent?.inert ?? false
    const shouldHideAppContent = Boolean(appContent && !appContent.contains(dialog))
    if (appContent && shouldHideAppContent) {
      appContent.setAttribute('aria-hidden', 'true')
      appContent.inert = true
    }
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    focusables()[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusables()
      if (!elements.length) return
      const currentIndex = elements.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? elements.length - 1 : currentIndex - 1)
        : (currentIndex + 1) % elements.length
      event.preventDefault()
      elements[nextIndex].focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (appContent && shouldHideAppContent) {
        if (previousAriaHidden == null) appContent.removeAttribute('aria-hidden')
        else appContent.setAttribute('aria-hidden', previousAriaHidden)
        appContent.inert = previousInert
      }
      if (previousActiveElement?.isConnected && !previousActiveElement.inert) previousActiveElement.focus()
      else document.querySelector<HTMLElement>('#canvas-background')?.focus()
    }
  }, [ref, enabled])
}
