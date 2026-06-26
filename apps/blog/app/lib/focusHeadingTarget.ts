export function focusHeadingTarget(element: HTMLElement): void {
  const previousTabIndex = element.getAttribute('tabindex');

  element.tabIndex = -1;
  element.focus({ preventScroll: true });
  element.addEventListener(
    'blur',
    () => {
      if (previousTabIndex === null) {
        element.removeAttribute('tabindex');
        return;
      }

      element.setAttribute('tabindex', previousTabIndex);
    },
    { once: true }
  );
}
