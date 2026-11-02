// Lazy mounting via IntersectionObserver. Falls back to immediate execution when
// IntersectionObserver is unavailable.

/**
 * Run `fn(el)` once when `el` approaches the viewport.
 * @returns {() => void} disposer that cancels a pending run
 */
export function onVisible(el, fn, rootMargin = '300px 0px') {
  if (!('IntersectionObserver' in window)) {
    queueMicrotask(() => fn(el));
    return () => {};
  }
  let done = false;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !done) {
        done = true;
        io.disconnect();
        fn(el);
      }
    }
  }, { rootMargin });
  io.observe(el);
  return () => { done = true; io.disconnect(); };
}
