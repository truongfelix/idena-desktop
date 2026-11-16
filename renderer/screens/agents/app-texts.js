/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {agentAppTexts} from '../settings/agent/api'

// What the app sends with the Instructions, per action (B-268, owner 2026-11-16): nothing hidden. The main process
// builds these texts with the same functions that send them (main/agent/app-texts.js).

let cached = null

/** {sent: {action: text}, suggestions: {flipStory, answerFlip, social}}, or null until read. */
export function useAppTexts() {
  const [texts, setTexts] = React.useState(cached)
  React.useEffect(() => {
    if (cached) return
    agentAppTexts().then(
      (value) => {
        cached = value
        setTexts(value)
      },
      () => {}
    )
  }, [])
  return texts
}

/** An action's ⓘ: what it is for, then what the app sends with the Instructions for it, when it sends something. */
export function ActionInfo({info, sent}) {
  const {t} = useTranslation()
  return (
    <>
      {info}
      {sent && (
        <>
          <Text mt={3} fontWeight={500}>
            {t('What the app sends with your Instructions')}
          </Text>
          <Box
            as="pre"
            mt={1}
            p={2}
            maxH="16rem"
            overflowY="auto"
            fontSize="xs"
            whiteSpace="pre-wrap"
            bg="gray.50"
            borderRadius="md"
          >
            {sent}
          </Box>
        </>
      )}
    </>
  )
}
