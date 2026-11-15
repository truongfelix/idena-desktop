/* eslint-disable react/prop-types */
import * as React from 'react'
import {
  Box,
  Button,
  ButtonGroup,
  Flex,
  Stack,
  Text,
  useClipboard,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {SecondaryButton} from '../../shared/components/button'
import {
  agentErrorText,
  drawStoryPicture,
  writeFlipStory,
} from '../settings/agent/api'
import {useAgents} from './use-agents'

// "Write flip stories" in the flip editor (B-236, owner 2026-11-15): shown only when an agent that is on holds the
// action (not Off), so that a person without such an agent sees nothing of agents outside the Agents section.

/** The agent that writes the stories, or null: on, not paused, "Write flip stories" in its list and not Off. */
export function storyAgentOf(list) {
  if (!list || list.paused) return null
  return (
    list.agents.find(
      (a) =>
        a.enabled && a.actions.flipStory && a.actions.flipStory.level !== 'off'
    ) || null
  )
}

/** The flip's two keywords, as the agent is sent them; null without both. */
export function storyWords(keywords) {
  const words = (keywords && keywords.words) || []
  if (words.length < 2 || !words[0].name || !words[1].name) return null
  return words.slice(0, 2).map(({name, desc}) => ({name, desc: desc || ''}))
}

// The stories written in this window, by keywords and count of panels: the images step still shows the prompts the
// keywords step got, and going back does not ask the model again.
const written = new Map()
// The story the keywords step shows for each pair of keywords: what the images step shows too.
const latest = new Map()
// Alone asks once per keywords and count in this window, a failed answer included: a retry is the person's click.
const asked = new Set()
const listeners = new Set()
const wordsKey = (words) => words.map(({name}) => name).join('|')
const storyKey = (words, panels) =>
  `${panels}|${words.map(({name}) => name).join('|')}`

/** A story written for these keywords and count, kept for this window. */
export function rememberStory(words, panels, story) {
  written.set(storyKey(words, panels), story)
}

/** The story kept for these keywords and count, now the one shown for the keywords (images step included). */
export function pickStory(words, panels) {
  const story = written.get(storyKey(words, panels)) || null
  if (story) {
    latest.set(wordsKey(words), story)
    listeners.forEach((listener) => listener())
  }
  return story
}

/** The story shown for these keywords, whatever its count. */
export function shownStory(words) {
  return latest.get(wordsKey(words)) || null
}

/** Renders again when a story is shown: one may come after the person reached the images step. */
function useShownStories() {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const listener = () => setTick((n) => n + 1)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])
}

function PromptRow({index, prompt}) {
  const {t} = useTranslation()
  const {hasCopied, onCopy} = useClipboard(prompt)
  return (
    <Box>
      <Flex justify="space-between" align="center" mb={1}>
        <Text fontSize="sm" fontWeight={500}>
          {t('Picture {{n}}', {n: index + 1})}
        </Text>
        <Button size="sm" variant="link" colorScheme="blue" onClick={onCopy}>
          {hasCopied ? t('Copied!') : t('Copy')}
        </Button>
      </Flex>
      <Text fontSize="sm" color="muted" whiteSpace="pre-wrap">
        {prompt}
      </Text>
    </Box>
  )
}

function StoryView({story, withSummary = true}) {
  const {t} = useTranslation()
  return (
    <Stack spacing={4} mt={4}>
      {withSummary && (
        <Stack spacing={1}>
          {story.title && <Text fontWeight={500}>{story.title}</Text>}
          {story.character && (
            <Text fontSize="sm">
              {t('Character: {{text}}', {
                text: story.character,
                nsSeparator: '!!',
              })}
            </Text>
          )}
          {story.goal && (
            <Text fontSize="sm">
              {t('Goal: {{text}}', {text: story.goal, nsSeparator: '!!'})}
            </Text>
          )}
          {story.panels.some(Boolean) && (
            <Box as="ol" pl={5} fontSize="sm">
              {story.panels.map((line, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}>{line}</li>
              ))}
            </Box>
          )}
        </Stack>
      )}
      {story.prompts.map((prompt, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <PromptRow key={i} index={i} prompt={prompt} />
      ))}
    </Stack>
  )
}

/** The keywords step: write a story with the agent, 3 pictures (the 4th the person's) or 4, and its prompts. */
export function FlipStoryHelper({keywords}) {
  const {t} = useTranslation()
  const {list} = useAgents()
  const agent = storyAgentOf(list)
  const words = storyWords(keywords)
  const [panels, setPanels] = React.useState(3)
  const key = words ? storyKey(words, panels) : null
  // The first render reads only: the effect below makes it the shown story (no other component updated in a render).
  const [story, setStory] = React.useState(
    () => (key && written.get(key)) || null
  )
  const [error, setError] = React.useState(null)
  const [isWriting, setIsWriting] = React.useState(false)
  // Each write and each change of keywords or count: an answer for other keywords or another count is kept, never
  // shown here.
  const run = React.useRef(0)

  React.useEffect(() => {
    run.current += 1
    setIsWriting(false)
    setStory((words && pickStory(words, panels)) || null)
    setError(null)
    // words is rebuilt at each render: the key says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const write = React.useCallback(async () => {
    if (!agent || !words) return
    const forWords = words
    const forPanels = panels
    run.current += 1
    const mine = run.current
    asked.add(storyKey(forWords, forPanels))
    setIsWriting(true)
    setError(null)
    try {
      const next = await writeFlipStory(agent.id, forPanels, forWords)
      rememberStory(forWords, forPanels, next)
      if (run.current === mine) setStory(pickStory(forWords, forPanels))
    } catch (e) {
      if (run.current === mine) setError(agentErrorText(e))
    } finally {
      if (run.current === mine) setIsWriting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent && agent.id, key])

  // Alone: as soon as the keywords show, once per keywords and count.
  const isAlone = agent && agent.actions.flipStory.level === 'alone'
  React.useEffect(() => {
    if (isAlone && key && !written.has(key) && !asked.has(key)) write()
  }, [isAlone, key, write])

  if (!agent || !words) return null
  return (
    <Box borderWidth={1} borderRadius="md" p={4} mt={8}>
      <Flex justify="space-between" align="center" gap={3} wrap="wrap">
        <Text fontWeight={500}>
          {t('A story by {{name}}', {name: agent.name})}
        </Text>
        <Flex gap={3} align="center" wrap="wrap">
          <ButtonGroup
            isAttached
            size="sm"
            role="radiogroup"
            aria-label={t('Pictures in the story')}
          >
            {[3, 4].map((n) => (
              <Button
                key={n}
                role="radio"
                aria-checked={panels === n}
                variant={panels === n ? 'solid' : 'outline'}
                colorScheme={panels === n ? 'blue' : 'gray'}
                isDisabled={isWriting}
                onClick={() => setPanels(n)}
              >
                {n === 3 ? t('3 pictures, the 4th yours') : t('4 pictures')}
              </Button>
            ))}
          </ButtonGroup>
          <SecondaryButton size="sm" isLoading={isWriting} onClick={write}>
            {story ? t('Write another') : t('Write a story')}
          </SecondaryButton>
        </Flex>
      </Flex>
      {error && (
        <Text color="red.500" fontSize="sm" mt={3}>
          {error}
        </Text>
      )}
      {story && <StoryView story={story} />}
    </Box>
  )
}

/**
 * The slots a story's pictures go into (B-236 Make the images), in the order the editor shows them: every slot but the
 * nonsense picture's. Null when the story has more pictures than such slots (4 pictures while the 4th slot is still
 * the nonsense picture).
 */
export function storySlots(originalOrder, adversarialImageId, count) {
  const free = (originalOrder || []).filter((n) => n !== adversarialImageId)
  return free.length >= count ? free.slice(0, count) : null
}

/** Where a w x h picture goes in a W x H frame, whole and centred: {x, y, width, height}. */
export function fitContain(w, h, W, H) {
  const scale = Math.min(W / w, H / h)
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)
  return {
    x: Math.floor((W - width) / 2),
    y: Math.floor((H - height) / 2),
    width,
    height,
  }
}

const FRAME_WIDTH = 440
const FRAME_HEIGHT = 330

/** A drawn picture as a flip frame: 440 x 330, the picture whole on white, a PNG data URL. */
async function asFrame({mediaType, data}) {
  const img = new Image()
  img.src = `data:${mediaType};base64,${data}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = FRAME_WIDTH
  canvas.height = FRAME_HEIGHT
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT)
  const {x, y, width, height} = fitContain(
    img.naturalWidth,
    img.naturalHeight,
    FRAME_WIDTH,
    FRAME_HEIGHT
  )
  ctx.drawImage(img, x, y, width, height)
  return canvas.toDataURL('image/png')
}

/**
 * The images step: the prompts of the story written for these keywords, to copy into an image model; with an agent
 * whose service draws pictures (an image model set), Make the images puts them in the story's slots for the person
 * to check (`onImage(slot, url)`).
 */
export function FlipStoryPrompts({
  keywords,
  images = [],
  originalOrder,
  adversarialImageId,
  onImage,
}) {
  const {t} = useTranslation()
  const {list} = useAgents()
  const [progress, setProgress] = React.useState(null)
  const [error, setError] = React.useState(null)
  // Leaving the step stops the drawing: no picture is asked for, or put in, after that.
  const alive = React.useRef(true)
  React.useEffect(
    () => () => {
      alive.current = false
    },
    []
  )
  useShownStories()
  const agent = storyAgentOf(list)
  const words = storyWords(keywords)
  if (!agent || !words) return null
  const story = shownStory(words)
  if (!story) return null
  const count = story.prompts.length
  const slots = storySlots(originalOrder, adversarialImageId, count)
  const canDraw =
    agent.provider !== 'anthropic' && Boolean(agent.imageModel) && onImage
  const replaces = slots && slots.some((n) => images[n])

  const drawAll = async () => {
    setError(null)
    try {
      for (let i = 0; i < count && alive.current; i += 1) {
        setProgress(i + 1)
        // One after the other: each lands in its slot as soon as it is drawn.
        // eslint-disable-next-line no-await-in-loop
        const picture = await drawStoryPicture(agent.id, story.prompts[i])
        // eslint-disable-next-line no-await-in-loop
        const frame = await asFrame(picture)
        if (alive.current) onImage(slots[i], frame)
      }
    } catch (e) {
      if (alive.current) setError(agentErrorText(e))
    } finally {
      if (alive.current) setProgress(null)
    }
  }

  return (
    <Box borderWidth={1} borderRadius="md" p={4} mt={6}>
      <Flex justify="space-between" align="center" gap={3} wrap="wrap">
        <Text fontWeight={500}>
          {story.title || t('The story', {nsSeparator: '!!'})}
        </Text>
        {canDraw && (
          <SecondaryButton
            size="sm"
            isLoading={progress !== null}
            loadingText={t('Picture {{n}} of {{count}}', {
              n: progress,
              count,
            })}
            isDisabled={!slots}
            onClick={drawAll}
          >
            {t('Make the images')}
          </SecondaryButton>
        )}
      </Flex>
      {canDraw && !slots && (
        <Text fontSize="sm" color="muted" mt={2}>
          {t(
            'The story has 4 pictures: unlock the nonsense picture first, or write one with 3.',
            {nsSeparator: '!!'}
          )}
        </Text>
      )}
      {canDraw && replaces && progress === null && (
        <Text fontSize="sm" color="muted" mt={2}>
          {t('Make the images replaces the pictures already in those slots.')}
        </Text>
      )}
      {error && (
        <Text color="red.500" fontSize="sm" mt={2}>
          {error}
        </Text>
      )}
      <StoryView story={story} withSummary={false} />
    </Box>
  )
}
