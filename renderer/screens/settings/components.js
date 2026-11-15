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
import {InfoTip} from '../../shared/components/info-tip'
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
/** A section of a settings page; `info`: what it is for, in an ⓘ beside its title. */
export function SettingsSection({
  title,
  children,
  foldId,
  summary,
  info,
  defaultOpen = true,
  ...props
}) {
  if (foldId)
    return (
      <FoldingSection
        title={title}
        foldId={foldId}
        summary={summary}
        info={info}
        defaultOpen={defaultOpen}
        {...props}
      >
        {children}
      </FoldingSection>
    )
  return (
    <Box {...props}>
      <Heading fontWeight={500} fontSize="lg" mb={5}>
        <Flex align="center" gap={2}>
          {title}
          {info && <InfoTip label={title}>{info}</InfoTip>}
        </Flex>
      </Heading>
      {children}
    </Box>
  )
}

function FoldingSection({
  title,
  foldId,
  summary,
  info,
  defaultOpen,
  children,
  ...props
}) {
  const [isOpen, toggle] = useFold(foldId, defaultOpen)
  const contentId = `section-${foldId.replace(/[^\w-]/gu, '-')}`
  const Arrow = isOpen ? ChevronDownIcon : ChevronRightIcon
  return (
    <Box {...props}>
      <Heading
        fontWeight={500}
        fontSize="lg"
        mb={isOpen ? 5 : 0}
        display="flex"
        alignItems="center"
        gap={2}
      >
        <Flex
          as="button"
          type="button"
          flexShrink={0}
          align="center"
          gap={2}
          textAlign="left"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={toggle}
          _hover={{color: 'blue.500'}}
        >
          <Arrow boxSize={5} color="muted" flexShrink={0} />
          <Box as="span">{title}</Box>
        </Flex>
        {info && <InfoTip label={title}>{info}</InfoTip>}
        {!isOpen && summary && (
          // The summary opens the section too (the title's button says it to a screen reader).
          <Text
            as="span"
            fontSize="md"
            fontWeight={400}
            color="muted"
            ml={2}
            flex={1}
            minW={0}
            cursor="pointer"
            isTruncated
            onClick={toggle}
          >
            {summary}
          </Text>
        )}
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
