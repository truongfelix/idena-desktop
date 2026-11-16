/* eslint-disable react/prop-types */
import * as React from 'react'
import {Box, Button, Flex, Grid, Heading, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider} from '../../shared/components/components'
import {InfoTip} from '../../shared/components/info-tip'
import {useAppTexts} from './app-texts'
import {SettingsSection} from '../settings/components'
import {
  AREAS,
  SINGLE_HOLDER,
  areaNames,
  heldBy,
  levelLabel,
  spendingActions,
} from './catalog'
import {NumberField} from './limit-fields'
import {drawsPictures} from './flip-story'
import {READ_COLS, ReadRow} from './read-row'
import {DO_COLS, DoRow} from './do-row'
import {nothingToActOn} from './page-sections'
import {
  areaCount,
  firstArea,
  flipStarts,
  isOn,
  rowOf,
  withLevels,
  withRow,
} from './rights'

/**
 * "What it may do": the agent's rights as one table per area of the app (Q-64, B-280). Every right of an area is a
 * row, Off until given: what it reads (on or off, whose, how many) and what it does (Off, Ask me or Alone, its limit
 * a day, on what). An action one other agent holds (the validation's answers) cannot be given.
 */
export function ActionsSection({agent, agents, catalog, onChange}) {
  const {t} = useTranslation()
  const texts = useAppTexts(
    ['post', 'reply', 'like', 'message', 'tip'].filter((id) => isOn(agent, id))
  )
  const [area, setArea] = React.useState(() => firstArea(agent, catalog, AREAS))
  const names = areaNames(t)
  const held = catalog.filter(({id}) => isOn(agent, id))
  const inArea = catalog.filter((entry) => entry.area === area)
  const reads = inArea.filter(({kind}) => kind === 'read')
  const does = inArea.filter(({kind}) => kind !== 'read')
  // What the area's actions need, for an area whose reads are not rights of their own.
  const needs = [
    ...new Set(
      does.filter(({id}) => isOn(agent, id)).flatMap((entry) => entry.reads)
    ),
  ]

  const setActions = (change) =>
    onChange((a) => ({...a, actions: change(a.actions)}))
  const changeRow = (entry) => (patch) =>
    setActions((actions) => withRow(actions, entry, patch))

  return (
    <SettingsSection
      title={t('What it may do')}
      foldId="agent.actions"
      info={t(
        'The only actions this agent may take, by area of the app. Off: never. Ask me: each one waits in To approve for your click. Alone: it acts by itself, within its limit a day and its budget. Every action shows in Activity.',
        {nsSeparator: '!!'}
      )}
      summary={
        held.length
          ? held
              .map(({id, label, kind}) =>
                // A read is on or off (B-262).
                kind === 'read'
                  ? label
                  : `${label}: ${levelLabel(agent.actions[id].level, t)}`
              )
              .join(', ')
          : t('Nothing', {nsSeparator: '!!'})
      }
    >
      <Stack spacing={5}>
        <Flex role="tablist" aria-label={t('Areas')} gap={2} wrap="wrap">
          {AREAS.map((one) => {
            const isPicked = one === area
            return (
              <Button
                key={one}
                role="tab"
                aria-selected={isPicked}
                size="sm"
                variant={isPicked ? 'solid' : 'outline'}
                colorScheme={isPicked ? 'blue' : 'gray'}
                onClick={() => setArea(one)}
              >
                {names[one]}
                <Text as="span" fontWeight={400} ml={2}>
                  {t('{{on}} of {{of}}', areaCount(agent, catalog, one))}
                </Text>
              </Button>
            )
          })}
        </Flex>
        {area === 'flips' && (
          <Flex gap={2} align="center" wrap="wrap">
            <Text color="muted">{t('Start from')}</Text>
            {flipStarts(t).map(({id, label, levels}) => (
              <Button
                key={id}
                size="sm"
                variant="outline"
                onClick={() =>
                  setActions((actions) => withLevels(actions, catalog, levels))
                }
              >
                {label}
              </Button>
            ))}
          </Flex>
        )}
        {area === 'social' && nothingToActOn(agent) && (
          <Text color="orange.500">
            {t(
              'Its actions on Social have nothing to act on: give it something to read.',
              {nsSeparator: '!!'}
            )}
          </Text>
        )}
        <Box overflowX="auto">
          <Stack spacing={6} minW="760px" role="tabpanel">
            <Box>
              <Heading as="h3" fontSize="md" fontWeight={500} mb={2}>
                {t('It reads')}
              </Heading>
              {reads.length > 0 ? (
                <>
                  <ColumnNames
                    cols={READ_COLS}
                    names={[
                      t('Read'),
                      t('What'),
                      t('Only these'),
                      t('How many'),
                    ]}
                  />
                  {reads.map((entry) => (
                    <ReadRow
                      key={entry.id}
                      entry={entry}
                      row={rowOf(agent, entry)}
                      change={changeRow(entry)}
                    />
                  ))}
                </>
              ) : (
                <Text color="muted">
                  {needs.length
                    ? needs.join(' · ')
                    : t('Nothing, while its actions here are Off.')}
                </Text>
              )}
            </Box>
            <Box>
              <Heading as="h3" fontSize="md" fontWeight={500} mb={2}>
                {t('It does')}
              </Heading>
              <ColumnNames
                cols={DO_COLS}
                names={[t('What'), t('Who decides'), t('Limit'), t('Only on')]}
              />
              {does.map((entry) => {
                const holder = heldBy(entry.id, agent, agents)
                const saved = agent.actions[entry.id]
                return (
                  <DoRow
                    key={entry.id}
                    entry={entry}
                    row={rowOf(agent, entry)}
                    sent={texts && texts.sent[entry.id]}
                    holder={holder ? heldText(entry.id, holder, t) : null}
                    // Make the pictures needs a service that draws (B-258): the row says so.
                    note={
                      entry.id === 'flipPictures' && !drawsPictures(agent)
                        ? t(
                            'Its service draws no pictures: choose an image model in its connection, on a service that has one.',
                            {nsSeparator: '!!'}
                          )
                        : null
                    }
                    change={changeRow(entry)}
                    // Kept Off by an older file: no other agent can be given it until it is taken out.
                    onFree={
                      SINGLE_HOLDER.includes(entry.id) &&
                      saved &&
                      saved.level === 'off'
                        ? () =>
                            setActions((actions) => {
                              const next = {...actions}
                              delete next[entry.id]
                              return next
                            })
                        : null
                    }
                  />
                )
              })}
            </Box>
          </Stack>
        </Box>
        <OverallLimit agent={agent} catalog={catalog} onChange={onChange} />
      </Stack>
    </SettingsSection>
  )
}

/** The names of a table's columns, over its rows. */
function ColumnNames({cols, names}) {
  return (
    <Grid templateColumns={cols} gap={4} pb={2}>
      {names.map((name) => (
        <Text key={name} fontSize="sm" color="muted">
          {name}
        </Text>
      ))}
    </Grid>
  )
}

/**
 * The optional limit of all its actions together (B-269): the most iDNA a day it spends alone, fees included, beside
 * each action's own. Only for an agent with an action that spends iDNA.
 */
function OverallLimit({agent, catalog, onChange}) {
  const {t} = useTranslation()
  if (!spendingActions(agent, catalog).length) return null
  return (
    <>
      <HDivider />
      <Flex align="center" gap={2} pt={3} wrap="wrap">
        <Text fontWeight={500}>{t('All actions together')}</Text>
        <InfoTip label={t('All actions together')}>
          {t(
            'Optional: the most iDNA a day its actions spend alone together, fees included, beside each action’s own. An action spends alone only within a limit, its own or this one; with none, it waits for you. The model’s own service bills apart.',
            {nsSeparator: '!!'}
          )}
        </InfoTip>
        <NumberField
          label={t('iDNA at most a day, fees included')}
          value={agent.budgetPerDay}
          min={0}
          whole={false}
          optional
          placeholder={t('None', {nsSeparator: '!!'})}
          onSave={(budgetPerDay) => onChange((a) => ({...a, budgetPerDay}))}
        />
      </Flex>
    </>
  )
}

/** Who already holds an action only one agent may hold. */
function heldText(id, name, t) {
  return id === 'report'
    ? t('{{name}} already reports in the validation', {name})
    : t('{{name}} already answers the validation', {name})
}
