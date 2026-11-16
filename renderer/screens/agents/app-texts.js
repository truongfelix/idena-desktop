/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {agentAppTexts} from '../settings/agent/api'

// What the app sends with the Instructions, per action (B-268, owner 2026-11-16): nothing hidden. The main process
// builds these texts with the same functions that send them (main/agent/app-texts.js).

// By the Social actions held: the texts never change in a running app.
const cached = new Map()

/**
 * {sent: {action: text}, suggestions: {flipStory, answerFlip, social}}, or null until read; `held` the Social actions
 * the agent holds (its run lists only those).
 */
export function useAppTexts(held) {
  const key = held ? held.join(',') : '*'
  const [texts, setTexts] = React.useState(() => cached.get(key) || null)
  React.useEffect(() => {
    if (cached.has(key)) {
      setTexts(cached.get(key))
      return undefined
    }
    let live = true
    agentAppTexts(held).then(
      (value) => {
        cached.set(key, value)
        if (live) setTexts(value)
      },
      () => {}
    )
    return () => {
      live = false
    }
    // The key names the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return texts
}

/**
 * An action's ⓘ: what it is for, then what the app sends with the Instructions for it, when it sends something;
 * `changed`: the agent holds its own text for the action's area.
 */

/** The area whose part an action is asked with (main/agent/app-parts.js PARTS), or undefined. */
export const partOf = (action) =>
  ({
    flipStory: 'flipStory',
    answerFlip: 'validation',
    report: 'validation',
    flipJudge: 'validation',
    post: 'social',
    reply: 'social',
    like: 'social',
    message: 'social',
    tip: 'social',
  }[action])
export function ActionInfo({info, sent, changed = false}) {
  const {t} = useTranslation()
  return (
    <>
      {info}
      {changed && (
        // The agent's own text is sent for this area (B-282): the app's is not shown as if it were.
        <Text mt={3}>
          {t(
            'You changed the app’s part for this area. What is sent is in What the app adds.'
          )}
        </Text>
      )}
      {sent && !changed && (
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
