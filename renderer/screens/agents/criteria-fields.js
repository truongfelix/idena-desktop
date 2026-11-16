/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Button, Checkbox, Flex, Stack, Text, Wrap} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {Textarea} from '../../shared/components/components'
import {NumberField} from './limit-fields'
import {TOPIC_NAME} from '../social/contract'

// The criteria of a read of others (`who`) or of an action on others (`onlyTo`), B-266: folded under a line that says
// them, unfolded to change them. Saved whole at each change; the main process checks each field (criteria.js).

/** The identity states, in the order the editor shows them; Verified is "Validated" on screen, as the app says it. */
export const CRITERIA_STATES = [
  'Human',
  'Verified',
  'Newbie',
  'Candidate',
  'Vouched',
  'Suspended',
  'Zombie',
]

// One list for a read without topics: a new one at each render would reset the field while it is typed in.
const NO_TOPICS = []

const EMPTY = {
  only: [],
  except: [],
  states: [],
  trustAbove: null,
  minAge: null,
  minStake: null,
  mustWords: [],
  notWords: [],
}

/** The addresses of a text (one or several per line), as the field keeps them. */
export const addressList = (text) =>
  String(text || '')
    .split(/[\s,;]+/u)
    .map((one) => one.trim())
    .filter(Boolean)

/** The words of a text, separated by commas. */
export const wordList = (text) =>
  String(text || '')
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean)

/** The criteria in words, for the folded line: "everyone" without any. */
export function criteriaLine(criteria, t, stateName) {
  if (!criteria) return t('Everyone')
  const parts = []
  if (criteria.only.length)
    parts.push(t('only {{count}} chosen', {count: criteria.only.length}))
  if (criteria.except.length)
    parts.push(t('not {{count}} chosen', {count: criteria.except.length}))
  if (criteria.states.length)
    parts.push(criteria.states.map(stateName).join(', '))
  if (criteria.trustAbove !== null)
    parts.push(t('Trust above {{n}}', {n: criteria.trustAbove}))
  if (criteria.minAge !== null)
    parts.push(t('age {{n}}+', {n: criteria.minAge}))
  if (criteria.minStake !== null)
    parts.push(t('stake {{n}}+ iDNA', {n: criteria.minStake}))
  if (criteria.mustWords && criteria.mustWords.length)
    parts.push(t('with “{{words}}”', {words: criteria.mustWords.join(', ')}))
  if (criteria.notWords && criteria.notWords.length)
    parts.push(t('without “{{words}}”', {words: criteria.notWords.join(', ')}))
  // B-281: a claimed profile name, the posts' topics.
  if (criteria.named === true) parts.push(t('with a profile name'))
  if (criteria.topics && criteria.topics.length)
    parts.push(
      t('in {{topics}}', {
        topics: criteria.topics.map((one) => `r/${one}`).join(', '),
      })
    )
  return parts.join(' · ') || t('Everyone')
}

/** The topics of a text, separated by commas: lower case, without the "r/" a person may type. */
export const topicList = (text) =>
  wordList(text).map((one) => one.toLowerCase().replace(/^r\//u, ''))

/** Whether a token is an address (0x and 40 hex digits). */
const isAddress = (one) => /^0x[0-9a-fA-F]{40}$/u.test(one)

function ListField({
  label,
  value,
  onSave,
  parse,
  join,
  placeholder,
  addresses = false,
  topics = false,
}) {
  const {t} = useTranslation()
  const [draft, setDraft] = React.useState(join(value))
  // The lines that are not addresses, found when the field is left.
  const [wrong, setWrong] = React.useState([])
  // The saved list shown again when it changes, but never over a refused text the person is still to fix.
  const refused = React.useRef(false)
  refused.current = wrong.length > 0
  React.useEffect(() => {
    if (!refused.current) setDraft(join(value))
  }, [value, join])
  return (
    <Box>
      <Text fontSize="sm" color="muted" mb={1}>
        {label}
      </Text>
      <Textarea
        aria-label={label}
        fontSize="sm"
        rows={2}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          const next = parse(e.currentTarget.value)
          // A list with a line that is not an address is not saved: the text stays, said wrong, until fixed (a
          // mistyped address must never empty "only these" into everyone).
          // A topic's name the same way (B-281): one Social would not take is refused, never dropped unsaid.
          let bad = []
          if (addresses) bad = next.filter((one) => !isAddress(one))
          if (topics) bad = next.filter((one) => !TOPIC_NAME.test(one))
          setWrong(bad)
          if (bad.length) return
          if (join(next) !== join(value)) onSave(next)
        }}
      />
      {wrong.length > 0 && (
        <Text fontSize="sm" color="red.500" mt={1}>
          {topics
            ? t('Not a topic name, nothing saved: {{list}}', {
                list: wrong.join(', '),
                nsSeparator: '!!',
              })
            : t('Not an address, nothing saved: {{list}}', {
                list: wrong.join(', '),
                nsSeparator: '!!',
              })}
        </Text>
      )}
    </Box>
  )
}

const joinLines = (list) => list.join('\n')
const joinWords = (list) => list.join(', ')

/** An identity state as the app says it (Verified is "Validated"). */
function useStateName() {
  const {t} = useTranslation()
  return (state) =>
    ({
      Human: t('Human'),
      Verified: t('Validated'),
      Newbie: t('Newbie'),
      Candidate: t('Candidate'),
      Vouched: t('Vouched'),
      Suspended: t('Suspended'),
      Zombie: t('Zombie'),
    }[state] || state)
}

/**
 * The criteria in one line, a button that opens their editor: `value` the saved criteria (null: none), `open` and
 * `onToggle` the editor's state, kept by the row (B-280: the line sits in a cell, the editor under the row).
 * `extra`: the row's other rules in words (B-281: once per author, who wrote first), said after the criteria.
 */
export function CriteriaSummary({label, value, extra = [], open, onToggle}) {
  const {t} = useTranslation()
  const stateName = useStateName()
  const line = [criteriaLine(value, t, stateName), ...extra].join(' · ')
  return (
    <Button
      size="sm"
      variant="link"
      colorScheme="blue"
      whiteSpace="normal"
      textAlign="left"
      aria-label={`${label}: ${line}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      {line}
    </Button>
  )
}

/**
 * The criteria editor: `value` the saved criteria (null: none), `withWords` for a read (the words its text must or
 * must not hold), `withTopics` for the posts (their topics, B-281), `onChange(criteria)` with the whole new criteria.
 */
export function CriteriaEditor({
  value,
  withWords = false,
  withTopics = false,
  onChange,
}) {
  const {t} = useTranslation()
  const stateName = useStateName()
  const criteria = {...EMPTY, ...(value || {})}
  const save = (patch) => onChange({...criteria, ...patch})
  return (
    <Stack spacing={3} pl={3} borderLeftWidth={2} borderColor="gray.100">
      <Box>
        <Text fontSize="sm" color="muted" mb={1}>
          {t('Identity states (none picked: any)', {nsSeparator: '!!'})}
        </Text>
        <Wrap spacing={4}>
          {CRITERIA_STATES.map((state) => (
            <Checkbox
              key={state}
              isChecked={criteria.states.includes(state)}
              onChange={(e) =>
                save({
                  states: e.target.checked
                    ? [...criteria.states, state]
                    : criteria.states.filter((one) => one !== state),
                })
              }
            >
              {stateName(state)}
            </Checkbox>
          ))}
        </Wrap>
      </Box>
      <Flex gap={4} wrap="wrap">
        <NumberField
          label={t('Trust above')}
          value={criteria.trustAbove}
          min={0}
          optional
          placeholder={t('Any', {nsSeparator: '!!'})}
          onSave={(trustAbove) => save({trustAbove})}
        />
        <NumberField
          label={t('epochs of age at least')}
          value={criteria.minAge}
          min={0}
          optional
          placeholder={t('Any', {nsSeparator: '!!'})}
          onSave={(minAge) => save({minAge})}
        />
        <NumberField
          label={t('iDNA of stake at least')}
          value={criteria.minStake}
          min={0}
          whole={false}
          optional
          placeholder={t('Any', {nsSeparator: '!!'})}
          onSave={(minStake) => save({minStake})}
        />
      </Flex>
      <Checkbox
        isChecked={criteria.named === true}
        onChange={(e) => save({named: e.target.checked})}
      >
        {t('Only authors with a profile name')}
      </Checkbox>
      <ListField
        label={t('Only these identities (addresses; none: everyone)', {
          nsSeparator: '!!',
        })}
        value={criteria.only}
        parse={addressList}
        join={joinLines}
        placeholder="0x…"
        addresses
        onSave={(only) => save({only})}
      />
      <ListField
        label={t('All but these identities (addresses)')}
        value={criteria.except}
        parse={addressList}
        join={joinLines}
        placeholder="0x…"
        addresses
        onSave={(except) => save({except})}
      />
      {withTopics && (
        <ListField
          label={t('Only posts in these topics (commas)')}
          value={criteria.topics || NO_TOPICS}
          parse={topicList}
          join={joinWords}
          placeholder="flips, validation"
          topics
          onSave={(topics) => save({topics})}
        />
      )}
      {withWords && (
        <>
          <ListField
            label={t('Its text holds one of these words (commas)')}
            value={criteria.mustWords}
            parse={wordList}
            join={joinWords}
            onSave={(mustWords) => save({mustWords})}
          />
          <ListField
            label={t('Its text holds none of these words (commas)')}
            value={criteria.notWords}
            parse={wordList}
            join={joinWords}
            onSave={(notWords) => save({notWords})}
          />
        </>
      )}
    </Stack>
  )
}
