/* eslint-disable react/prop-types */
import {useTranslation} from 'react-i18next'
import {Button} from '@chakra-ui/react'
import {useSocial} from '../provider'
import {person} from '../people'

/** A chip as the phone's FilterChip: selected or not. */
export function Chip({isSelected, onClick, children, ...props}) {
  return (
    <Button
      size="sm"
      h={8}
      px={3}
      rounded="md"
      borderWidth={1}
      borderColor={isSelected ? 'blue.500' : 'gray.100'}
      bg={isSelected ? 'blue.012' : 'transparent'}
      color={isSelected ? 'blue.500' : 'brandGray.500'}
      fontWeight={500}
      _hover={{bg: isSelected ? 'blue.012' : 'gray.50'}}
      _active={{bg: 'gray.50'}}
      onClick={onClick}
      {...props}
    >
      {isSelected && '✓ '}
      {children}
    </Button>
  )
}

/** The Follow chip of an address: "Follow", or "Following" once selected. */
export function FollowChip({address}) {
  const {t} = useTranslation()
  const {people, setPerson} = useSocial()
  const current = people[address] || person(address)
  return (
    <Chip
      isSelected={current.following}
      onClick={(e) => {
        e.stopPropagation()
        setPerson({...current, following: !current.following})
      }}
    >
      {current.following ? t('Following') : t('Follow')}
    </Chip>
  )
}
