/* eslint-disable react/prop-types */
import * as React from 'react'
import {
  Box,
  Button,
  Checkbox,
  Flex,
  Stack,
  Text,
  Wrap,
  useClipboard,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {SecondaryButton} from '../../shared/components/button'
import {Textarea} from '../../shared/components/components'
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

/**
 * The agent that draws the pictures (B-258 Make the pictures, its own right): on, not paused, "Make the pictures" not
 * Off, on a service that draws. Null without one.
 */
export function pictureAgentOf(list) {
  if (!list || list.paused) return null
  return (
    list.agents.find(
      (a) =>
        a.enabled &&
        a.actions.flipPictures &&
        a.actions.flipPictures.level !== 'off' &&
        // eslint-disable-next-line no-use-before-define
        drawsPictures(a)
    ) || null
  )
}

/** The flip's two keywords, as the agent is sent them (a description cut at 200 characters); null without both. */
export function storyWords(keywords) {
  const words = (keywords && keywords.words) || []
  if (words.length < 2 || !words[0].name || !words[1].name) return null
  return words
    .slice(0, 2)
    .map(({name, desc}) => ({name, desc: (desc || '').slice(0, 200)}))
}

const names = (words) => words.map(({name}) => name)

/** What a story run may give (B-268): the stories in words, the image prompts, the pictures drawn from them. */
export const STORY_PARTS = ['story', 'prompts', 'images']
const DEFAULT_PARTS = ['story', 'prompts']

/**
 * The draft's stories (the flip machine's `story`, B-236, B-268) when they were written for these keywords; null
 * otherwise (other keywords, none yet). A draft of a build before B-268 (one story, its prompts at the top) is read
 * as one story.
 */
export function storyForKeywords(saved, words) {
  if (!saved || !words || !Array.isArray(saved.words)) return null
  if (saved.words.join('|') !== names(words).join('|')) return null
  if (Array.isArray(saved.stories)) {
    const stories = saved.stories
      .filter((one) => one && typeof one === 'object')
      .map((one) => ({
        title: typeof one.title === 'string' ? one.title : '',
        story: typeof one.story === 'string' ? one.story : '',
        prompts: (Array.isArray(one.prompts) ? one.prompts : []).filter(
          (prompt) => typeof prompt === 'string' && prompt.trim()
        ),
      }))
      .filter((one) => one.story || one.prompts.length)
    return stories.length
      ? {
          ...saved,
          idea: typeof saved.idea === 'string' ? saved.idea : '',
          parts: Array.isArray(saved.parts) ? saved.parts : DEFAULT_PARTS,
          titles: Array.isArray(saved.titles) ? saved.titles : [],
          stories,
        }
      : null
  }
  if (!Array.isArray(saved.prompts) || !saved.prompts.length) return null
  return {
    words: saved.words,
    idea: '',
    parts: DEFAULT_PARTS,
    titles: saved.title ? [saved.title] : [],
    stories: [
      {
        title: saved.title || '',
        story: (saved.panels || []).filter(Boolean).join('\n'),
        prompts: saved.prompts,
      },
    ],
  }
}

/**
 * A run's stories as the draft keeps them: with their keywords, the idea and the parts asked, and the titles of every
 * story written for these keywords so far (the next "Try another story" sends them as not to give again).
 */
export function draftStory({stories}, words, {idea = '', parts, titles = []}) {
  const all = [...titles, ...stories.map((one) => one.title).filter(Boolean)]
  return {
    words: names(words),
    idea,
    parts,
    titles: all.slice(-10),
    stories,
  }
}

/** The draft with one prompt changed (`story`, `index`), as the person edited it. */
export function withPrompt(saved, story, index, text) {
  return {
    ...saved,
    stories: saved.stories.map((one, i) =>
      i === story
        ? {
            ...one,
            prompts: one.prompts.map((p, j) => (j === index ? text : p)),
          }
        : one
    ),
  }
}

/** Every prompt of the draft's stories, in order, with its story and place: [{story, index, prompt}]. */
export const promptsOf = (saved) =>
  saved
    ? saved.stories.flatMap((one, story) =>
        one.prompts.map((prompt, index) => ({story, index, prompt}))
      )
    : []

/** Whether the agent's service draws pictures (an image model set; not Anthropic, which has none). */
export const drawsPictures = (agent) =>
  Boolean(agent) && agent.provider !== 'anthropic' && Boolean(agent.imageModel)

// Alone writes once per keywords in this window, a failed answer included: a retry is the person's click.
const asked = new Set()

function CopyButton({text}) {
  const {t} = useTranslation()
  const {hasCopied, onCopy} = useClipboard(text)
  return (
    <Button size="sm" variant="link" colorScheme="blue" onClick={onCopy}>
      {hasCopied ? t('Copied!') : t('Copy')}
    </Button>
  )
}

/** A prompt the person may edit: saved when the box loses the focus. */
function PromptBox({label, prompt, onSave, isDisabled}) {
  const [draft, setDraft] = React.useState(prompt)
  React.useEffect(() => setDraft(prompt), [prompt])
  return (
    <Box>
      <Flex justify="space-between" align="center" mb={1}>
        <Text fontSize="sm" fontWeight={500}>
          {label}
        </Text>
        <CopyButton text={draft} />
      </Flex>
      <Textarea
        aria-label={label}
        fontSize="sm"
        rows={4}
        value={draft}
        maxLength={2000}
        isDisabled={isDisabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          const next = e.currentTarget.value.trim()
          if (next && next !== prompt) onSave(next)
          else setDraft(prompt)
        }}
      />
    </Box>
  )
}

function StoriesView({saved, onStory, isDisabled}) {
  const {t} = useTranslation()
  return (
    <Stack spacing={6} mt={4}>
      {saved.stories.map((one, s) => (
        // eslint-disable-next-line react/no-array-index-key
        <Stack key={s} spacing={3}>
          {one.title && <Text fontWeight={500}>{one.title}</Text>}
          {one.story && (
            <Text fontSize="sm" whiteSpace="pre-wrap">
              {one.story}
            </Text>
          )}
          {one.prompts.map((prompt, i) => (
            <PromptBox
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              label={t('Prompt {{n}}', {n: i + 1})}
              prompt={prompt}
              isDisabled={isDisabled}
              onSave={(text) => onStory(withPrompt(saved, s, i, text))}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  )
}

/**
 * The keywords step (B-236, B-268): the person's idea for this story and what the run gives (the story, the image
 * prompts, the pictures), then the agent's stories with their prompts to edit. The stories shown are the draft's
 * (`story`); a new run or an edit goes to the draft through `onStory`.
 */
export function FlipStoryHelper({keywords, story: saved, onStory}) {
  const {t} = useTranslation()
  const {list} = useAgents()
  const agent = storyAgentOf(list)
  const words = storyWords(keywords)
  const kept = storyForKeywords(saved, words)
  const key = words ? names(words).join('|') : null
  const [idea, setIdea] = React.useState(kept ? kept.idea : '')
  const [parts, setParts] = React.useState(kept ? kept.parts : DEFAULT_PARTS)
  const [error, setError] = React.useState(null)
  const [isWriting, setIsWriting] = React.useState(false)
  // The keywords now: an answer for others is never shown nor saved.
  const current = React.useRef(key)
  current.current = key
  const run = React.useRef(0)
  const canDraw = Boolean(pictureAgentOf(list))
  // The titles given so far for these keywords, read when a run starts.
  const titles = React.useRef([])
  titles.current = kept ? kept.titles : []

  // Other keywords: their own draft's idea and ticks, or none.
  React.useEffect(() => {
    run.current += 1
    setIsWriting(false)
    setError(null)
    setIdea(kept ? kept.idea : '')
    setParts(kept ? kept.parts : DEFAULT_PARTS)
    // kept is read again at each render: the key says when the keywords changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const write = React.useCallback(async () => {
    if (!agent || !words) return
    const forWords = words
    const forKey = key
    const asks = parts.filter((part) => part !== 'images')
    run.current += 1
    const mine = run.current
    asked.add(forKey)
    setIsWriting(true)
    setError(null)
    try {
      const written = await writeFlipStory(agent.id, {
        words: forWords,
        idea,
        parts: asks,
        notThese: titles.current,
      })
      if (current.current === forKey)
        onStory(
          draftStory(written, forWords, {
            idea,
            parts,
            titles: titles.current,
          })
        )
    } catch (e) {
      if (run.current === mine) setError(agentErrorText(e))
    } finally {
      if (run.current === mine) setIsWriting(false)
    }
    // words is rebuilt at each render: the key says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent && agent.id, key, idea, parts, onStory])

  // Alone: as soon as the keywords show, once per keywords, with what the person last asked.
  const isAlone = agent && agent.actions.flipStory.level === 'alone'
  const hasStory = Boolean(kept)
  React.useEffect(() => {
    if (isAlone && key && !hasStory && !asked.has(key)) write()
  }, [isAlone, key, hasStory, write])

  if (!agent || !words) return null
  const choices = [
    ['story', t('The story')],
    ['prompts', t('The image prompts')],
    ...(canDraw ? [['images', t('The pictures')]] : []),
  ]
  const toggle = (part, on) =>
    setParts((now) => {
      let next = on ? [...now, part] : now.filter((one) => one !== part)
      // The pictures are drawn from the prompts; without the prompts, no pictures.
      if (part === 'images' && on) next = [...next, 'prompts']
      if (part === 'prompts' && !on)
        next = next.filter((one) => one !== 'images')
      return STORY_PARTS.filter((one) => next.includes(one))
    })
  return (
    <Box borderWidth={1} borderRadius="md" p={4} mt={8}>
      <Text fontWeight={500}>
        {t('A story by {{name}}', {name: agent.name})}
      </Text>
      <Textarea
        mt={3}
        fontSize="sm"
        rows={2}
        value={idea}
        maxLength={2000}
        placeholder={t('Your idea for this story (optional)')}
        aria-label={t('Your idea for this story (optional)')}
        onChange={(e) => setIdea(e.target.value)}
      />
      <Flex justify="space-between" align="center" gap={3} wrap="wrap" mt={3}>
        <Wrap spacing={4}>
          {choices.map(([part, label]) => (
            <Checkbox
              key={part}
              isChecked={parts.includes(part)}
              isDisabled={isWriting}
              onChange={(e) => toggle(part, e.target.checked)}
            >
              {label}
            </Checkbox>
          ))}
        </Wrap>
        <SecondaryButton
          size="sm"
          isLoading={isWriting}
          isDisabled={!parts.some((part) => part !== 'images')}
          onClick={write}
        >
          {kept ? t('Try another story') : t('Write a story')}
        </SecondaryButton>
      </Flex>
      {error && (
        <Text color="red.500" fontSize="sm" mt={3}>
          {error}
        </Text>
      )}
      {kept && (
        <StoriesView saved={kept} onStory={onStory} isDisabled={isWriting} />
      )}
    </Box>
  )
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
export async function asFrame({mediaType, data}) {
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

// The pictures drawn in this window, by prompt (B-268): going back to the keywords and on again keeps them; a prompt
// edited is a new picture. Alone draws each prompt once in this window, a failed one included.
const drawn = new Map()
const drawnAlone = new Set()

/** The slots the person can put a picture in: every slot but the nonsense picture's, with its place on screen. */
export function freeSlots(originalOrder, adversarialImageId) {
  return (originalOrder || [])
    .map((slot, place) => ({slot, place}))
    .filter(({slot}) => slot !== adversarialImageId)
}

function DrawnPicture({url, slots, images, onPut}) {
  const {t} = useTranslation()
  return (
    <Box mt={2}>
      <Box as="img" src={url} alt="" maxW="220px" borderRadius="md" />
      <Wrap spacing={2} mt={2}>
        {slots.map(({slot, place}) => (
          <Button
            key={slot}
            size="xs"
            variant="outline"
            onClick={() => onPut(slot, url)}
          >
            {images[slot]
              ? t('Replace picture {{n}}', {n: place + 1})
              : t('Put it in picture {{n}}', {n: place + 1})}
          </Button>
        ))}
      </Wrap>
    </Box>
  )
}

/**
 * The images step (B-236, B-268): every prompt of the stories written for these keywords, to edit, copy, or draw
 * with an agent whose service draws pictures ("Make the image"; Alone with the pictures asked: each is drawn as the
 * step opens). The person puts the pictures they like into the slots (`onImage(slot, url)`), in their order.
 */
export function FlipStoryPrompts({
  keywords,
  story: saved,
  images = [],
  originalOrder,
  adversarialImageId,
  onImage,
  onStory,
}) {
  const {t} = useTranslation()
  const {list} = useAgents()
  const [, setDrawnCount] = React.useState(0)
  const [drawing, setDrawing] = React.useState(null)
  const [error, setError] = React.useState(null)
  // Leaving the step stops the drawing: no picture is asked for, or shown, after that.
  const alive = React.useRef(true)
  React.useEffect(
    () => () => {
      alive.current = false
    },
    []
  )
  // The prompts come from the draft (an agent's story, B-258: maybe written by another agent's run); the pictures
  // from the agent holding Make the pictures.
  const painter = pictureAgentOf(list)
  const agent = storyAgentOf(list) || painter
  const words = storyWords(keywords)
  const kept = storyForKeywords(saved, words)
  const all = promptsOf(kept)
  const canDraw = Boolean(painter) && Boolean(onImage)
  const slots = freeSlots(originalOrder, adversarialImageId)

  const draw = React.useCallback(
    async (prompt) => {
      if (!painter) return
      setError(null)
      setDrawing(prompt)
      try {
        const frame = await asFrame(await drawStoryPicture(painter.id, prompt))
        if (!alive.current) return
        drawn.set(prompt, frame)
        setDrawnCount((n) => n + 1)
      } catch (e) {
        if (alive.current) setError(agentErrorText(e))
      } finally {
        if (alive.current) setDrawing(null)
      }
    },
    // The agent object is new at each read of the list: its id says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [painter && painter.id]
  )

  // Alone, the pictures asked: the agent's prompts drawn once each, one after the other, as the step opens (one loop:
  // a prompt the person edits afterwards is drawn by their click, never on its own).
  const isAlone = painter && painter.actions.flipPictures.level === 'alone'
  const wantsPictures = Boolean(kept && kept.parts.includes('images'))
  const opening = React.useRef(all)
  if (!opening.current.length) opening.current = all
  const started = React.useRef(false)
  React.useEffect(() => {
    if (!canDraw || !isAlone || !wantsPictures || started.current) return
    started.current = true
    ;(async () => {
      for (const {prompt} of opening.current) {
        if (!alive.current) break
        if (!drawn.has(prompt) && !drawnAlone.has(prompt)) {
          drawnAlone.add(prompt)
          // One after the other: each shows as soon as it is drawn.
          // eslint-disable-next-line no-await-in-loop
          await draw(prompt)
        }
      }
    })()
    // Once, when the agent list has come: the prompts are the ones the step opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDraw, isAlone, wantsPictures])

  if (!agent || !kept || !all.length) return null
  return (
    <Box borderWidth={1} borderRadius="md" p={4} mt={6}>
      <Text fontWeight={500}>
        {t('The prompts of {{name}}', {name: agent.name})}
      </Text>
      {error && (
        <Text color="red.500" fontSize="sm" mt={2}>
          {error}
        </Text>
      )}
      <Stack spacing={6} mt={4}>
        {kept.stories.map((one, s) =>
          one.prompts.length ? (
            // eslint-disable-next-line react/no-array-index-key
            <Stack key={s} spacing={4}>
              {one.title && <Text fontWeight={500}>{one.title}</Text>}
              {one.prompts.map((prompt, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <Box key={i}>
                  <PromptBox
                    label={t('Prompt {{n}}', {n: i + 1})}
                    prompt={prompt}
                    isDisabled={drawing === prompt || !onStory}
                    onSave={(text) =>
                      onStory && onStory(withPrompt(kept, s, i, text))
                    }
                  />
                  {canDraw && (
                    <SecondaryButton
                      size="sm"
                      mt={2}
                      isLoading={drawing === prompt}
                      isDisabled={drawing !== null && drawing !== prompt}
                      onClick={() => draw(prompt)}
                    >
                      {drawn.has(prompt)
                        ? t('Make it again')
                        : t('Make the image')}
                    </SecondaryButton>
                  )}
                  {drawn.has(prompt) && (
                    <DrawnPicture
                      url={drawn.get(prompt)}
                      slots={slots}
                      images={images}
                      onPut={onImage}
                    />
                  )}
                </Box>
              ))}
            </Stack>
          ) : null
        )}
      </Stack>
    </Box>
  )
}
