/* eslint-disable react/prop-types */
import * as React from 'react'
import {
  Box,
  Button,
  ButtonGroup,
  Flex,
  Grid,
  Stack,
  Text,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider} from '../../shared/components/components'
import {InfoTip} from '../../shared/components/info-tip'
import {ActionInfo} from './app-texts'
import {LEVELS, levelLabel} from './catalog'
import {LimitFields} from './limit-fields'
import {CriteriaEditor, CriteriaSummary} from './criteria-fields'
import {NoCell} from './read-row'

// The actions on others: only to whom the person's criteria pick (B-266).
export const ONLY_TO = ['reply', 'like', 'message', 'tip']

/** The columns of an action's row (B-280): what, who decides, its limit, only on. */
export const DO_COLS =
  'minmax(0, 1.3fr) 200px minmax(0, 1.2fr) minmax(0, 1.3fr)'

/**
 * One action of an area (B-280): Off, Ask me or Alone, its limit a day, and what it acts on. `row` is the agent's
 * own or the catalog's defaults set to Off (rights.js), `change(patch)` changes it. `holder`: the other agent that
 * holds it, for an action only one agent may hold. `onFree`: takes the row out, for one kept Off by an older file.
 */
export function DoRow({entry, row, sent, note, holder, change, onFree}) {
  const {t} = useTranslation()
  const [open, setOpen] = React.useState(false)
  const {id, label, info, perDay, scope} = entry
  const isOn = row.level !== 'off'
  const hasOnlyTo = ONLY_TO.includes(id)
  return (
    <>
      <HDivider />
      <Grid templateColumns={DO_COLS} gap={4} py={3} alignItems="start">
        <Stack spacing={1} minW={0}>
          <Flex align="center" gap={2}>
            <Text fontWeight={500}>{label}</Text>
            <InfoTip label={label}>
              <ActionInfo info={info} sent={sent} />
            </InfoTip>
          </Flex>
          {(holder || note) && (
            <Text fontSize="sm" color="muted">
              {holder || note}
            </Text>
          )}
          {onFree && (
            <Flex>
              <Button
                size="sm"
                variant="link"
                aria-label={t('Remove {{action}}', {action: label})}
                onClick={onFree}
              >
                {t('Remove')}
              </Button>
            </Flex>
          )}
        </Stack>
        <ButtonGroup
          isAttached
          size="sm"
          role="radiogroup"
          aria-label={label}
          isDisabled={Boolean(holder)}
        >
          {LEVELS.map((level) => {
            const isPicked = row.level === level
            return (
              <Button
                key={level}
                role="radio"
                aria-checked={isPicked}
                variant={isPicked ? 'solid' : 'outline'}
                colorScheme={isPicked ? 'blue' : 'gray'}
                onClick={() => !isPicked && change({level})}
              >
                {levelLabel(level, t)}
              </Button>
            )
          })}
        </ButtonGroup>
        <Box opacity={isOn ? 1 : 0.5}>
          {perDay ? (
            <LimitFields kind={perDay} row={row} onChange={change} />
          ) : (
            <NoCell />
          )}
        </Box>
        <Stack spacing={1} opacity={isOn ? 1 : 0.5} align="flex-start">
          {scope && <Text>{scope}</Text>}
          {hasOnlyTo && (
            <CriteriaSummary
              label={t('Only to')}
              value={row.onlyTo || null}
              open={open}
              onToggle={() => setOpen((now) => !now)}
            />
          )}
          {!scope && !hasOnlyTo && <NoCell />}
        </Stack>
      </Grid>
      {hasOnlyTo && open && (
        <Box pb={4} maxW="xl">
          <CriteriaEditor
            value={row.onlyTo || null}
            onChange={(onlyTo) => change({onlyTo})}
          />
        </Box>
      )}
    </>
  )
}
