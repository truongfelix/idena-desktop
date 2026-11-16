/* eslint-disable react/prop-types */
import * as React from 'react'
import {
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Flex,
  Stack,
  Text,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {Select} from '../../shared/components/components'
import {InfoTip} from '../../shared/components/info-tip'
import {ActionInfo} from './app-texts'
import {LEVELS, levelLabel} from './catalog'
import {LimitFields} from './limit-fields'
import {CriteriaEditor, CriteriaSummary} from './criteria-fields'
import {NoCell, RowLine} from './read-row'

// The actions on others: only to whom the person's criteria pick (B-266).
export const ONLY_TO = ['reply', 'like', 'message', 'tip']

/** The columns of the actions' table (B-280): what, who decides, its limit, only on. One grid, as the reads'. */
export const DO_COLS =
  'minmax(0, 1.2fr) max-content minmax(0, 1fr) minmax(0, 1.2fr)'

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
      <RowLine />
      <Stack spacing={1} minW={0} py={3}>
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
      <Box py={3}>
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
      </Box>
      <Box py={3} opacity={isOn ? 1 : 0.5}>
        {perDay ? (
          <LimitFields kind={perDay} row={row} onChange={change} />
        ) : (
          <NoCell />
        )}
      </Box>
      <Stack spacing={1} py={3} opacity={isOn ? 1 : 0.5} align="flex-start">
        {scope && <Text>{scope}</Text>}
        {hasOnlyTo && (
          <CriteriaSummary
            label={t('Only to')}
            value={row.onlyTo || null}
            extra={[
              row.perAuthor === 'day' && t('once per author a day'),
              row.perAuthor === 'week' && t('once per author a week'),
              row.onlyAnswers === true && t('only who wrote to it first'),
            ].filter(Boolean)}
            open={open}
            onToggle={() => setOpen((now) => !now)}
          />
        )}
        {!scope && !hasOnlyTo && <NoCell />}
      </Stack>
      {hasOnlyTo && open && (
        <Stack gridColumn="1 / -1" pb={4} maxW="xl" spacing={3}>
          <CriteriaEditor
            value={row.onlyTo || null}
            onChange={(onlyTo) => change({onlyTo})}
          />
          {/* Once per author, and who wrote first (B-281): the row's own rules, beside its criteria. */}
          <Stack spacing={3} pl={3} borderLeftWidth={2} borderColor="gray.100">
            <Select
              w="auto"
              aria-label={t('How often for one author')}
              value={row.perAuthor || ''}
              onChange={(e) => change({perAuthor: e.target.value || null})}
            >
              <option value="">{t('No limit for one author')}</option>
              <option value="day">{t('Once per author a day')}</option>
              <option value="week">{t('Once per author a week')}</option>
            </Select>
            {id === 'message' && (
              <Checkbox
                isChecked={row.onlyAnswers === true}
                onChange={(e) => change({onlyAnswers: e.target.checked})}
              >
                {t('Only to who wrote to it first')}
              </Checkbox>
            )}
          </Stack>
        </Stack>
      )}
    </>
  )
}
