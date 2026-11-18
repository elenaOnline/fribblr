// Reading theme tokens from JS. The values live in tokens.css; nothing here holds a colour.
// Prefer writing 'var(--token)' into a style (el.style.fill = 'var(--kind-pic-side)'): it follows the ground and the
// appearance by itself. Read a resolved value only where CSS cannot reach (canvas drawing, exported files), and read it
// again from onThemeChange(), which calls back when data-ground or data-appearance changes on <html>.

/** The resolved value of a custom property, e.g. token('--mark-blue') -> '#005E8B'. */
export function token(name, element = document.documentElement) {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

/** Calls back whenever the ground or the appearance changes. Returns a function that stops listening. */
export function onThemeChange(callback) {
  const observer = new MutationObserver(() => callback());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ground', 'data-appearance'] });
  return () => observer.disconnect();
}
