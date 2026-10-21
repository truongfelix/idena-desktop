/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Button,
  Divider,
  HStack,
  Input,
  Stack,
  Text,
  IconButton,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  useClipboard,
} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {TodoVotingCountBadge} from '../../oracles/components'
import {shortAddress} from '../people'
import {FollowChip} from '../components/chips'
import {PersonName} from '../components/identity'
import {useSocial} from '../provider'
import {PersonAvatar} from '../components/profile-public'

export const PAGE_SIZE = 30

/**
 * Social's text sizes, as the phone's (user 2026-10-17, B-88): a post's text 16 px (the app's 13), names and times
 * 13 px (11); the others a step up too. Chakra 1.8 writes the theme's font sizes as CSS variables, so the Social
 * page's box redefines them for what it holds (its dialogs open outside it and keep the app's sizes).
 */
export const SOCIAL_FONT_SIZES = {
  '--chakra-fontSizes-sm': '13px',
  '--chakra-fontSizes-md': '16px',
  '--chakra-fontSizes-mdx': '17px',
  '--chakra-fontSizes-base': '18px',
  '--chakra-fontSizes-lg': '20px',
}

export const useNow = () => {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000))
  React.useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      30000
    )
    return () => clearInterval(timer)
  }, [])
  return now
}

export function ShowMore({shown, total, onMore}) {
  const {t} = useTranslation()
  if (shown >= total) return null
  return (
    <Button variant="link" alignSelf="flex-start" onClick={onMore}>
      {t('Show more ({{count}} left)', {count: total - shown})}
    </Button>
  )
}

export function Rows({children}) {
  const items = React.Children.toArray(children)
  return (
    <Stack spacing={0} w="full" divider={<Divider />}>
      {items}
    </Stack>
  )
}

/** The rounded search bar; `trailing` (the feed's filter) sits at its end, after ✕ while something is typed. */
export function SearchField({
  value,
  onChange,
  trailing = null,
  placeholder = null,
}) {
  const {t} = useTranslation()
  return (
    <InputGroup size="lg">
      <InputLeftElement pointerEvents="none" color="muted">
        🔍
      </InputLeftElement>
      <Input
        value={value}
        maxLength={200}
        rounded="full"
        bg="gray.50"
        borderColor="gray.50"
        placeholder={placeholder ?? t('Search')}
        pr={trailing ? 24 : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {(value || trailing) && (
        <InputRightElement w="auto" pr={2}>
          <HStack spacing={0}>
            {value && (
              <Button
                variant="ghost"
                size="sm"
                rounded="full"
                aria-label={t('Clear the search')}
                onClick={() => onChange('')}
              >
                ✕
              </Button>
            )}
            {trailing}
          </HStack>
        </InputRightElement>
      )}
    </InputGroup>
  )
}

/** A person of the list (`contact`): the name as everywhere (PersonName, B-72), ✎ for the private name but on oneself. */
export function ContactRow({contact, onProfile, onRename}) {
  const {t} = useTranslation()
  const {me, nameParts} = useSocial()
  const named = Boolean(nameParts?.[contact.address])
  const isMe = Boolean(me) && contact.address === String(me).toLowerCase()
  return (
    <HStack
      spacing={3}
      borderWidth={1}
      borderColor="gray.100"
      rounded="lg"
      p={3}
      cursor="pointer"
      onClick={() => onProfile(contact.address)}
    >
      <PersonAvatar address={contact.address} boxSize={10} rounded="md" />
      <Stack spacing={0} flex={1} minW={0}>
        <Text fontWeight={500} noOfLines={1}>
          <PersonName address={contact.address} />
        </Text>
        {named && (
          <SmallText fontFamily="mono">
            {shortAddress(contact.address)}
          </SmallText>
        )}
      </Stack>
      {!isMe && (
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={t('Rename')}
          title={t('Rename')}
          icon={<Text>✎</Text>}
          onClick={(e) => {
            e.stopPropagation()
            onRename(contact.address)
          }}
        />
      )}
      <FollowChip address={contact.address} />
    </HStack>
  )
}

export function CopyButton({value}) {
  const {t} = useTranslation()
  const {hasCopied, onCopy} = useClipboard(value)
  return (
    <IconButton
      variant="ghost"
      size="xs"
      aria-label={t('Copy the address')}
      title={t('Copy the address')}
      icon={<Text>{hasCopied ? '✓' : '⧉'}</Text>}
      onClick={onCopy}
    />
  )
}

export function TabButton({isActive, onClick, badge, children}) {
  return (
    <Button variant="tab" isActive={isActive} onClick={onClick}>
      <HStack spacing={2}>
        <Text as="span">{children}</Text>
        {badge > 0 && (
          <TodoVotingCountBadge>
            {badge > 99 ? '99+' : badge}
          </TodoVotingCountBadge>
        )}
      </HStack>
    </Button>
  )
}
