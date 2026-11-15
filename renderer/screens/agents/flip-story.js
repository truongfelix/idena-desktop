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
// The last story written for each pair of keywords, whatever its count: what the images step shows.
const latest = new Map()
const wordsKey = (words) => words.map(({name}) => name).join('|')
const storyKey = (words, panels) =>
  `${panels}|${words.map(({name}) => name).join('|')}`

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
  const [story, setStory] = React.useState(
    () => (key && written.get(key)) || null
  )
  const [error, setError] = React.useState(null)
  const [isWriting, setIsWriting] = React.useState(false)
  const asked = React.useRef(new Set())

  React.useEffect(() => {
    setStory((key && written.get(key)) || null)
    setError(null)
  }, [key])

  const write = React.useCallback(async () => {
    if (!agent || !words) return
    const forKey = storyKey(words, panels)
    asked.current.add(forKey)
    setIsWriting(true)
    setError(null)
    try {
      const next = await writeFlipStory(agent.id, panels, words)
      written.set(forKey, next)
      latest.set(wordsKey(words), next)
      setStory(next)
    } catch (e) {
      setError(agentErrorText(e))
    } finally {
      setIsWriting(false)
    }
    // words is rebuilt at each render: the key says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent && agent.id, key, panels])

  // Alone: as soon as the keywords show, once per keywords and count.
  const isAlone = agent && agent.actions.flipStory.level === 'alone'
  React.useEffect(() => {
    if (isAlone && key && !written.has(key) && !asked.current.has(key)) write()
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
  const agent = storyAgentOf(list)
  const words = storyWords(keywords)
  if (!agent || !words) return null
  const story = latest.get(wordsKey(words))
  if (!story) return null
  const count = story.prompts.length
  const slots = storySlots(originalOrder, adversarialImageId, count)
  const canDraw =
    agent.provider !== 'anthropic' && Boolean(agent.imageModel) && onImage
  const replaces = slots && slots.some((n) => images[n])

  const drawAll = async () => {
    setError(null)
    try {
      for (let i = 0; i < count; i += 1) {
        setProgress(i + 1)
        // One after the other: each lands in its slot as soon as it is drawn.
        // eslint-disable-next-line no-await-in-loop
        const picture = await drawStoryPicture(agent.id, story.prompts[i])
        // eslint-disable-next-line no-await-in-loop
        onImage(slots[i], await asFrame(picture))
      }
    } catch (e) {
      setError(agentErrorText(e))
    } finally {
      setProgress(null)
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
