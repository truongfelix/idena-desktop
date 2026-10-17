/* eslint-disable react/prop-types */
import {useTranslation} from 'react-i18next'
import {Box, Text} from '@chakra-ui/react'
import {useSocialIdentity} from '../hooks'
import {useSocial} from '../provider'
import {shortAddress} from '../people'
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

/**
 * The name of `address` (B-72): its claimed name first, the private name given here beside it in grey, else the
 * private name alone, else the short address.
 */
export function PersonName({address}) {
  const {nameParts} = useSocial()
  const parts = nameParts?.[String(address).toLowerCase()]
  if (!parts) return shortAddress(address)
  return (
    <>
      {parts.name}
      {parts.note && (
        <Text as="span" color={MUTED} fontWeight={400}>
          {` · ${parts.note}`}
        </Text>
      )}
    </>
  )
}

/** An address as a link to its profile, shown by its name (PersonName). */
export function NameLink({address, onProfile, ...props}) {
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
      <PersonName address={address} />
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
