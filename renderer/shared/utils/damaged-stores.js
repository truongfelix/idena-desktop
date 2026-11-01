// The saved files the app put aside because they were damaged (main/stores/setup.js, B-177), as the user reads them.

/** What the file held, in the user's words; null for one the user does not know by name. */
export function damagedStoreWhat(file, t) {
  switch (String(file).replace(/\.json$/, '')) {
    case 'flips':
      return t('your flip drafts')
    case 'invites':
      return t('your invitations')
    case 'contacts':
      return t('your contacts')
    case 'settings':
      return t('the settings')
    case 'validation2':
      return t('the validation in progress')
    default:
      return null
  }
}

/** The stores of `all` not told yet, given how many were: the list only grows. */
export function newDamagedStores(all, told) {
  return Array.isArray(all) ? all.slice(told) : []
}
