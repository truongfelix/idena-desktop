/* eslint-disable react/prop-types */
import * as React from 'react'
import {
  IconButton,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
} from '@chakra-ui/react'
import {InfoIcon} from './icons'

/**
 * An ⓘ that shows `children` (what a section or an option is for) on hover, on focus or on a click, in place of a
 * line of small print under it. `label` names it for screen readers.
 */
export function InfoTip({label, children}) {
  return (
    <Popover trigger="hover" placement="bottom-start" isLazy openDelay={150}>
      <PopoverTrigger>
        <IconButton
          aria-label={label}
          icon={<InfoIcon />}
          variant="ghost"
          color="muted"
          fontSize="lg"
          minW={6}
          w={6}
          h={6}
          _hover={{color: 'blue.500', bg: 'transparent'}}
          _active={{bg: 'transparent'}}
          onClick={(e) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <Portal>
        <PopoverContent maxW="sm" fontSize="md" fontWeight={400}>
          <PopoverArrow />
          <PopoverBody>{children}</PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  )
}
