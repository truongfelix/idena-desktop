/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Flex, Switch, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider, Input, Select} from '../../shared/components/components'
import {InfoTip} from '../../shared/components/info-tip'
import {NumberField, readNumber} from './limit-fields'
import {useDraft} from './page-sections'
import {CriteriaEditor, CriteriaSummary} from './criteria-fields'

// The reads of what others wrote: whose, by criteria (B-266).
export const WHO_READS = [
  'readPosts',
  'readNotifications',
  'readMessages',
  'readTags',
]

/**
 * The columns of the reads' table (B-280): its switch, what, only these, how many. One grid for the whole table: a
 * row is four cells of it, under a line across.
 */
export const READ_COLS =
  'max-content minmax(0, 1.3fr) minmax(0, 1.5fr) minmax(0, 1.2fr)'

/** The line over a row, across the table. */
export function RowLine() {
  return (
    <Box gridColumn="1 / -1">
      <HDivider />
    </Box>
  )
}

/** The most posts "the last N" reads (main/agent/profiles.js MAX_POSTS_READ). */
const MAX_POSTS_READ = 50

/** A cell with nothing to set. */
export function NoCell() {
  return (
    <Text color="muted" aria-hidden>
      —
    </Text>
  )
}

/** Read all Social posts: the last 24 hours, or the last N posts. */
function PostsWindow({row, onChange}) {
  const {t} = useTranslation()
  const [count, setCount] = useDraft(String(row.count))
  return (
    <Flex align="center" gap={3} wrap="wrap">
      <Select
        w="auto"
        aria-label={t('Which posts')}
        value={row.window}
        onChange={(e) => onChange({window: e.target.value})}
      >
        <option value="day">{t('The last 24 hours')}</option>
        <option value="count">{t('The last posts')}</option>
      </Select>
      {row.window === 'count' && (
        <Input
          type="number"
          w="80px"
          min={1}
          max={MAX_POSTS_READ}
          aria-label={t('How many posts')}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          onBlur={(e) => {
            const next = readNumber(e.currentTarget.value, {min: 1})
            if (next === null || next > MAX_POSTS_READ)
              setCount(String(row.count))
            else if (next !== row.count) onChange({count: next})
          }}
        />
      )}
    </Flex>
  )
}

/**
 * One read of an area (B-262, B-280): on or off, never Ask me (reading spends nothing); whose it reads, and how many.
 * `row` is the agent's own or the catalog's defaults set to Off (rights.js), `change(patch)` changes it.
 */
export function ReadRow({entry, row, change}) {
  const {t} = useTranslation()
  const [open, setOpen] = React.useState(false)
  const {id, label, info, scope} = entry
  const isOn = row.level !== 'off'
  const hasWho = WHO_READS.includes(id)
  return (
    <>
      <RowLine />
      <Box py={3}>
        <Switch
          aria-label={label}
          isChecked={isOn}
          onChange={(e) => change({level: e.target.checked ? 'alone' : 'off'})}
        />
      </Box>
      <Flex align="center" gap={2} py={3}>
        <Text fontWeight={500}>{label}</Text>
        <InfoTip label={label}>{info}</InfoTip>
      </Flex>
      <Box py={3} opacity={isOn ? 1 : 0.5}>
        {hasWho && (
          <CriteriaSummary
            label={t('Only these')}
            value={row.who || null}
            open={open}
            onToggle={() => setOpen((now) => !now)}
          />
        )}
        {!hasWho && (scope ? <Text>{scope}</Text> : <NoCell />)}
      </Box>
      <Box py={3} opacity={isOn ? 1 : 0.5}>
        {id === 'readPosts' && <PostsWindow row={row} onChange={change} />}
        {id === 'readTags' && (
          // Its questions of the day (B-264): empty, no limit.
          <NumberField
            label={t('posts at most a day (a day in UTC)')}
            value={typeof row.limit === 'number' ? row.limit : null}
            min={0}
            optional
            placeholder={t('None', {nsSeparator: '!!'})}
            onSave={(limit) => change({limit})}
          />
        )}
        {id !== 'readPosts' && id !== 'readTags' && <NoCell />}
      </Box>
      {hasWho && open && (
        <Box gridColumn="1 / -1" pb={4} maxW="xl">
          <CriteriaEditor
            value={row.who || null}
            withWords
            onChange={(who) => change({who})}
          />
        </Box>
      )}
    </>
  )
}
