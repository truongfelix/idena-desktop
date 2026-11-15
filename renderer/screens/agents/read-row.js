/* eslint-disable react/prop-types */
import * as React from 'react'
import {Button, Flex, Stack, Switch, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider, Input, Select} from '../../shared/components/components'
import {InfoTip} from '../../shared/components/info-tip'
import {readNumber} from './limit-fields'

/** The most posts "the last N" reads (main/agent/profiles.js MAX_POSTS_READ). */
const MAX_POSTS_READ = 50

/** Read all Social posts: the last 24 hours, or the last N posts. */
function PostsWindow({row, onChange}) {
  const {t} = useTranslation()
  const [count, setCount] = React.useState(String(row.count))
  React.useEffect(() => setCount(String(row.count)), [row.count])
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
 * One read the agent is given (B-262): on or off, never Ask me (reading spends nothing); Read all Social posts with
 * its window.
 */
export function ReadRow({id, label, info, row, setActions}) {
  const {t} = useTranslation()
  const isOn = row.level !== 'off'
  const change = (patch) =>
    setActions((actions) => ({...actions, [id]: {...actions[id], ...patch}}))
  return (
    <>
      <HDivider />
      <Flex py={3} gap={4} align="center" justify="space-between" wrap="wrap">
        <Stack spacing={2} flex="1 1 260px" minW={0}>
          <Flex align="center" gap={2}>
            <Text fontWeight={500}>{label}</Text>
            <InfoTip label={label}>{info}</InfoTip>
          </Flex>
          {id === 'readPosts' && isOn && (
            <PostsWindow row={row} onChange={change} />
          )}
        </Stack>
        <Switch
          aria-label={label}
          isChecked={isOn}
          onChange={(e) => change({level: e.target.checked ? 'alone' : 'off'})}
        />
        <Button
          size="sm"
          variant="link"
          aria-label={t('Remove {{action}}', {action: label})}
          onClick={() =>
            setActions((actions) => {
              const next = {...actions}
              delete next[id]
              return next
            })
          }
        >
          {t('Remove')}
        </Button>
      </Flex>
    </>
  )
}
