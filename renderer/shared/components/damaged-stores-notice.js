import React from 'react'
import {useRouter} from 'next/router'
import {useToast} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {Toast} from './components'
import {damagedStoreWhat, newDamagedStores} from '../utils/damaged-stores'

const CHECK_INTERVAL_MS = 5000

// Tells the user of each saved file the app found damaged and put aside (main/stores/setup.js, B-177): a store is
// read when first used, so it is checked again on each page change and every few seconds.
export function DamagedStoresNotice() {
  const {t} = useTranslation()
  const toast = useToast()
  const router = useRouter()
  const told = React.useRef(0)

  React.useEffect(() => {
    const check = () => {
      const stores = newDamagedStores(global.damagedStores?.(), told.current)
      told.current += stores.length
      for (const {file, aside} of stores) {
        global.logger?.warn?.('A damaged saved file was put aside', {
          file,
          aside,
        })
        const what = damagedStoreWhat(file, t)
        // Next to the store, in the app's data folder; the log has the whole path.
        const copy = String(aside).split(/[\\/]/).pop()
        toast({
          status: 'warning',
          duration: null,
          // eslint-disable-next-line react/display-name
          render: ({onClose}) => (
            <Toast
              status="warning"
              title={t(
                'A saved file was damaged, probably by a power cut, and was put aside'
              )}
              description={
                what
                  ? t(
                      'It held {{what}}; the app goes on without it. Its copy: {{file}}',
                      {what, file: copy, nsSeparator: '|'}
                    )
                  : t('The app goes on without it. Its copy: {{file}}', {
                      file: copy,
                      nsSeparator: '|',
                    })
              }
              actionContent={t('Close')}
              onAction={onClose}
            />
          ),
        })
      }
    }
    check()
    router.events.on('routeChangeComplete', check)
    const timer = setInterval(check, CHECK_INTERVAL_MS)
    return () => {
      router.events.off('routeChangeComplete', check)
      clearInterval(timer)
    }
  }, [router.events, t, toast])

  return null
}
