/* eslint-disable react/prop-types */
import * as React from 'react'
import {
  Button,
  ButtonGroup,
  Flex,
  Heading,
  Stack,
  Text,
  Wrap,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider} from '../../shared/components/components'
import {SecondaryButton} from '../../shared/components/button'
import {InfoTip} from '../../shared/components/info-tip'
import {SettingsSection} from '../settings/components'
import {AREAS, LEVELS, areaNames, heldBy, levelLabel} from './catalog'
import {LimitFields} from './limit-fields'
import {ReadRow} from './read-row'
import {nothingToActOn} from './page-sections'

/**
 * "What it may do": the agent's actions by area (Q-64), each Off, Ask me or Alone with its limit a day, and the
 * catalog to add them from; the list of actions to add stays open, so several are added in a row. An action one
 * other agent holds (the validation's answers) cannot be added.
 */
export function ActionsSection({agent, agents, catalog, onChange}) {
  const {t} = useTranslation()
  const [isAdding, setIsAdding] = React.useState(false)
  const names = areaNames(t)
  const rows = catalog.filter(({id}) => agent.actions[id])
  const addable = catalog.filter(({id}) => !agent.actions[id])

  const setActions = (change) =>
    onChange((a) => ({...a, actions: change(a.actions)}))

  return (
    <SettingsSection
      title={t('What it may do')}
      foldId="agent.actions"
      info={t(
        'The only actions this agent may take, by area of the app. Off: never. Ask me: each one waits in To approve for your click. Alone: it acts by itself, within its limit a day and its budget. Every action shows in Activity.',
        {nsSeparator: '!!'}
      )}
      summary={
        rows.length
          ? rows
              .map(({id, label, kind}) => {
                const {level} = agent.actions[id]
                // A read is on or off (B-262).
                if (kind === 'read')
                  return `${label}: ${level === 'off' ? t('Off') : t('On')}`
                return `${label}: ${levelLabel(level, t)}`
              })
              .join(', ')
          : t('Nothing', {nsSeparator: '!!'})
      }
    >
      <Stack spacing={4}>
        <Flex>
          <SecondaryButton
            aria-expanded={isAdding}
            isDisabled={!isAdding && addable.length === 0}
            onClick={() => setIsAdding(!isAdding)}
          >
            {isAdding ? t('Done') : t('Add actions')}
          </SecondaryButton>
        </Flex>
        {isAdding && (
          <Stack borderWidth={1} borderRadius="md" p={4} spacing={3}>
            {addable.length === 0 && (
              <Text color="muted">{t('Every action is in its list.')}</Text>
            )}
            {AREAS.map((area) => {
              const inArea = addable.filter((row) => row.area === area)
              if (!inArea.length) return null
              return (
                <Stack key={area} spacing={2}>
                  <Text fontWeight={500}>{names[area]}</Text>
                  <Wrap spacing={2}>
                    {inArea.map(({id, label, defaults}) => {
                      const holder = heldBy(id, agent, agents)
                      return (
                        <Button
                          key={id}
                          variant="outline"
                          isDisabled={Boolean(holder)}
                          title={holder ? heldText(id, holder, t) : undefined}
                          onClick={() =>
                            setActions((actions) => ({
                              ...actions,
                              [id]: defaults || {level: 'off'},
                            }))
                          }
                        >
                          {`+ ${label}`}
                        </Button>
                      )
                    })}
                  </Wrap>
                </Stack>
              )
            })}
          </Stack>
        )}
        {nothingToActOn(agent) && (
          <Text color="orange.500">
            {t(
              'Its actions on Social have nothing to act on: give it something to read.',
              {nsSeparator: '!!'}
            )}
          </Text>
        )}
        {rows.length === 0 ? (
          <Text color="muted">
            {t('No action yet: it can do nothing.', {nsSeparator: '!!'})}
          </Text>
        ) : (
          AREAS.map((area) => {
            const inArea = rows.filter((row) => row.area === area)
            if (!inArea.length) return null
            return (
              <Stack key={area} spacing={0}>
                <Heading as="h3" fontSize="md" fontWeight={500} mb={1}>
                  {names[area]}
                </Heading>
                {inArea.map(({id, label, info, perDay, kind}) =>
                  kind === 'read' ? (
                    <ReadRow
                      key={id}
                      id={id}
                      label={label}
                      info={info}
                      row={agent.actions[id]}
                      setActions={setActions}
                    />
                  ) : (
                    <ActionRow
                      key={id}
                      id={id}
                      label={label}
                      info={info}
                      perDay={perDay}
                      row={agent.actions[id]}
                      setActions={setActions}
                    />
                  )
                )}
              </Stack>
            )
          })
        )}
      </Stack>
    </SettingsSection>
  )
}

/** Who already holds an action only one agent may hold. */
function heldText(id, name, t) {
  return id === 'report'
    ? t('{{name}} already reports in the validation', {name})
    : t('{{name}} already answers the validation', {name})
}

function ActionRow({id, label, info, perDay, row, setActions}) {
  const {t} = useTranslation()
  return (
    <>
      <HDivider />
      <Flex py={3} gap={4} align="center" justify="space-between" wrap="wrap">
        <Stack spacing={2} flex="1 1 260px" minW={0}>
          <Flex align="center" gap={2}>
            <Text fontWeight={500}>{label}</Text>
            <InfoTip label={label}>{info}</InfoTip>
          </Flex>
          {perDay && (
            <LimitFields
              kind={perDay}
              row={row}
              onChange={(change) =>
                setActions((actions) => ({
                  ...actions,
                  [id]: {...actions[id], ...change},
                }))
              }
            />
          )}
        </Stack>
        <ButtonGroup isAttached size="sm" role="radiogroup" aria-label={label}>
          {LEVELS.map((level) => {
            const isOn = row.level === level
            return (
              <Button
                key={level}
                role="radio"
                aria-checked={isOn}
                variant={isOn ? 'solid' : 'outline'}
                colorScheme={isOn ? 'blue' : 'gray'}
                onClick={() =>
                  !isOn &&
                  setActions((actions) => ({
                    ...actions,
                    [id]: {...actions[id], level},
                  }))
                }
              >
                {levelLabel(level, t)}
              </Button>
            )
          })}
        </ButtonGroup>
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
