const headingFocusCleanups = new WeakMap<HTMLElement, () => void>();

export function focusHeadingTarget(element: HTMLElement): void {
  headingFocusCleanups.get(element)?.();

  const previousTabIndex = element.getAttribute('tabindex');

  const cleanup = () => {
    if (previousTabIndex === null) {
      element.removeAttribute('tabindex');
    } else {
      element.setAttribute('tabindex', previousTabIndex);
    }

    element.removeEventListener('blur', cleanup);
    headingFocusCleanups.delete(element);
  };

  element.tabIndex = -1;
  headingFocusCleanups.set(element, cleanup);
  element.addEventListener('blur', cleanup, { once: true });
  element.focus({ preventScroll: true });
}
