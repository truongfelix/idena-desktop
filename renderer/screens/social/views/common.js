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
import {Avatar, SmallText} from '../../../shared/components/components'
import {TodoVotingCountBadge} from '../../oracles/components'
import {shortAddress} from '../people'
import {FollowChip} from '../components/chips'

export const PAGE_SIZE = 30

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

export function SearchField({value, onChange}) {
  const {t} = useTranslation()
  return (
    <InputGroup>
      <InputLeftElement pointerEvents="none" color="muted">
        🔍
      </InputLeftElement>
      <Input
        value={value}
        maxLength={200}
        rounded="full"
        bg="gray.50"
        borderColor="gray.50"
        placeholder={t('Search')}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <InputRightElement>
          <Button variant="ghost" size="sm" onClick={() => onChange('')}>
            ✕
          </Button>
        </InputRightElement>
      )}
    </InputGroup>
  )
}

export function ContactRow({contact, onProfile, onRename}) {
  const {t} = useTranslation()
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
      <Avatar address={contact.address} boxSize={10} rounded="md" />
      <Stack spacing={0} flex={1} minW={0}>
        <Text fontWeight={500} noOfLines={1}>
          {contact.name || shortAddress(contact.address)}
        </Text>
        {contact.name && (
          <SmallText fontFamily="mono">
            {shortAddress(contact.address)}
          </SmallText>
        )}
      </Stack>
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
