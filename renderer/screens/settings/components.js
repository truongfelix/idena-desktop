/* eslint-disable react/prop-types */
import React from 'react'
import {
  Box,
  Button,
  Flex,
  FormControl,
  Heading,
  Stack,
  Text,
} from '@chakra-ui/react'
import {useRouter} from 'next/router'
import {FormLabel} from '../../shared/components/components'
import {ChevronDownIcon, ChevronRightIcon} from '../../shared/components/icons'
import {useFold} from './fold'

export function SettingsNavLink({href, ...props}) {
  const router = useRouter()

  return (
    <Button
      variant="tab"
      onClick={() => {
        router.push(href)
      }}
      isActive={router.pathname === href}
      {...props}
    />
  )
}

export function SettingsFormControl({children, ...props}) {
  return (
    <FormControl {...props}>
      <Stack isInline spacing="2" justify="space-between" align="center">
        {children}
      </Stack>
    </FormControl>
  )
}

export function SettingsFormLabel(props) {
  return (
    <FormLabel color="muted" fontWeight={400} minW="40" w="40" {...props} />
  )
}

/**
 * A section of a settings page. With `foldId`, it folds (B-250): its title is the button, an arrow before it (right:
 * folded, down: open), `summary` shown beside the folded title, its state remembered on this computer.
 */
export function SettingsSection({
  title,
  children,
  foldId,
  summary,
  defaultOpen = true,
  ...props
}) {
  if (foldId)
    return (
      <FoldingSection
        title={title}
        foldId={foldId}
        summary={summary}
        defaultOpen={defaultOpen}
        {...props}
      >
        {children}
      </FoldingSection>
    )
  return (
    <Box {...props}>
      <Heading fontWeight={500} fontSize="lg" mb={5}>
        {title}
      </Heading>
      {children}
    </Box>
  )
}

function FoldingSection({
  title,
  foldId,
  summary,
  defaultOpen,
  children,
  ...props
}) {
  const [isOpen, toggle] = useFold(foldId, defaultOpen)
  const contentId = `section-${foldId.replace(/[^\w-]/gu, '-')}`
  const Arrow = isOpen ? ChevronDownIcon : ChevronRightIcon
  return (
    <Box {...props}>
      <Heading fontWeight={500} fontSize="lg" mb={isOpen ? 5 : 0}>
        <Flex
          as="button"
          type="button"
          w="full"
          align="center"
          gap={2}
          textAlign="left"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={toggle}
          _hover={{color: 'blue.500'}}
        >
          <Arrow boxSize={5} color="muted" flexShrink={0} />
          <Box as="span" flexShrink={0}>
            {title}
          </Box>
          {!isOpen && summary && (
            <Text
              as="span"
              fontSize="md"
              fontWeight={400}
              color="muted"
              ml={2}
              minW={0}
              isTruncated
            >
              {summary}
            </Text>
          )}
        </Flex>
      </Heading>
      {/* Hidden, not unmounted: what is typed in a folded section (a key not saved yet) stays. */}
      <Box id={contentId} hidden={!isOpen}>
        {children}
      </Box>
    </Box>
  )
}

export function DevSettingsSection(props) {
  return global.isDev ? <SettingsSection {...props} /> : null
}

export function SettingsLinkButton(props) {
  return (
    <Button
      variant="link"
      colorScheme="blue"
      fontWeight={500}
      _hover={null}
      _active={null}
      _disabled={{
        color: 'muted',
      }}
      {...props}
    />
  )
}
