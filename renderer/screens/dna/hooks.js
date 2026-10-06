/* eslint-disable react/prop-types */
import {useRouter} from 'next/router'
import * as React from 'react'
import {useTranslation} from 'react-i18next'
import {areSameCaseInsensitive} from '../oracles/utils'
import {useFailToast} from '../../shared/hooks/use-toast'
import {
  DnaLinkMethod,
  dnaLinkMethod,
  dnaLinkParams,
  isOpenableDnaUrl,
  newerDnaLink,
  urlLogContext,
} from './utils'

export {DnaLinkMethod}

const DnaLinkContext = React.createContext()

function useLatest(value) {
  const ref = React.useRef(value)
  React.useEffect(() => {
    ref.current = value
  })
  return ref
}

// Holds the link that waits for its dialog: the dialogs mount at different times (send, raw and vote only once the
// node is synced), and a link can come before any of them.
export function DnaLinkProvider({children}) {
  const {t} = useTranslation()
  const failToast = useFailToast()
  const failToastRef = useLatest(failToast)

  const [link, setLink] = React.useState(null)
  const takenIds = React.useRef(new Set())

  React.useEffect(() => {
    const receive = (_, next) =>
      setLink((current) => newerDnaLink(current, next))

    const removeListener = global.ipcRenderer.on('DNA_LINK', receive)
    // A link that came before this listener (it started the app, or came during startup) waits in the main process
    global.ipcRenderer
      .invoke('CHECK_DNA_LINK')
      .then((pending) => receive(undefined, pending))
      .catch((error) =>
        global.logger.error('Cannot read the waiting dna link', error?.message)
      )

    return removeListener
  }, [])

  const take = React.useCallback((id) => {
    if (takenIds.current.has(id)) return false
    takenIds.current.add(id)
    global.ipcRenderer.send('DNA_LINK_HANDLED', id)
    setLink((current) => (current?.id === id ? null : current))
    return true
  }, [])

  React.useEffect(() => {
    if (link && !isOpenableDnaUrl(link.url) && take(link.id)) {
      global.logger.error('Received invalid dna url', urlLogContext(link.url))
      failToastRef.current({
        title: t('Invalid DNA link'),
        description: t(`You must provide valid URL including protocol version`),
      })
    }
  }, [failToastRef, link, t, take])

  const value = React.useMemo(() => ({link, take}), [link, take])

  return (
    <DnaLinkContext.Provider value={value}>{children}</DnaLinkContext.Provider>
  )
}

// Opens the waiting link of this method once `enabled`, then keeps its url and params for the dialog.
export function useDnaLinkMethod(method, {enabled = true, onReceive} = {}) {
  const {link, take} = React.useContext(DnaLinkContext)
  const onReceiveRef = useLatest(onReceive)

  const [received, setReceived] = React.useState({params: {}})

  React.useEffect(() => {
    if (
      enabled &&
      link &&
      isOpenableDnaUrl(link.url) &&
      dnaLinkMethod(link.url) === method &&
      take(link.id)
    ) {
      const params = dnaLinkParams(link.url)
      setReceived({url: link.url, params})
      if (onReceiveRef.current) onReceiveRef.current(link.url, params)
    }
  }, [enabled, link, method, onReceiveRef, take])

  return received
}

export function useDnaLinkRedirect(method, url) {
  const router = useRouter()

  useDnaLinkMethod(method, {
    onReceive: (_, params) => {
      const targetUrl = typeof url === 'function' ? url(params) : url
      if (!areSameCaseInsensitive(router.asPath, targetUrl)) {
        router.push(targetUrl)
      }
    },
  })
}
