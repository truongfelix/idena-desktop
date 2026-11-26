// A sidebar link opens one page of a section (Settings opens /settings/general, Flips /flips/list) and stays marked on
// every page of that section: the first part of its path (B-320: the Node and Advanced tabs marked no link).

/** Whether the sidebar link to `href` is the one of the page at `pathname`. */
export function isNavItemActive(pathname, href) {
  const section = `/${String(href).split('/')[1]}`
  return pathname === section || String(pathname).startsWith(`${section}/`)
}
