/* eslint-disable react/prop-types */
import {useTranslation} from 'react-i18next'
import {Box, Text} from '@chakra-ui/react'
import {useSocialIdentity} from '../hooks'
import {useSocial} from '../provider'
import {displayName} from '../people'
import {LINK, MUTED} from './theme'
import {identityColor, identityStatus} from '../format'

/** The dot colors of the phone app's status. */
export const healthColor = {
  good: '#2E9D4A',
  warn: '#F08C00',
  bad: '#D93025',
  off: 'gray.300',
}

export function StatusDot({health, size = 2.5}) {
  return (
    <Box
      w={size}
      h={size}
      rounded="full"
      bg={healthColor[health]}
      flexShrink={0}
    />
  )
}

/** A label of the scan's state: {health, kind, behind, share}. */
export function useScanLabel(state) {
  const {t} = useTranslation()
  return {
    noNode: t('The node does not answer'),
    noPeers: t('No peers'),
    validation: t('Paused during the validation'),
    syncing: t('The node is syncing'),
    starting: t('Starting the scan'),
    scanOff: t('Scan off'),
    behind: t('{{count}} blocks behind', {count: state.behind}),
    history: t('Reading older posts ({{percent}}%)', {
      percent: Math.floor((state.share || 0) * 100),
    }),
    upToDate: t('Up to date'),
  }[state.kind]
}

/** An address as a link to its profile, shown by its contact name if it has one. */
export function NameLink({address, onProfile, ...props}) {
  const {names} = useSocial()
  return (
    <Text
      as="button"
      color={LINK}
      fontWeight={500}
      textAlign="left"
      onClick={(e) => {
        e.stopPropagation()
        onProfile(address)
      }}
      {...props}
    >
      {displayName(address, names)}
    </Text>
  )
}

/** An identity's state, in its color ("Human"), with the age when `withAge` ("Human · age 12"). */
export function IdentityLabel({address, withAge = false, ...props}) {
  const {t} = useTranslation()
  const {data: identity} = useSocialIdentity(address)
  if (!identity) return null
  const status = identityStatus(identity.state)
  const label =
    withAge && identity.age > 0 && status !== 'Not validated'
      ? `${t(status)} · ${t('age {{age}}', {age: identity.age})}`
      : t(status)
  return (
    <Text
      as="span"
      fontWeight={500}
      color={identityColor(identity.state) || MUTED}
      {...props}
    >
      {label}
    </Text>
  )
}
