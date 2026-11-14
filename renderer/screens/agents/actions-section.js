/* eslint-disable react/prop-types */
import * as React from 'react'
import {Button, ButtonGroup, Flex, Stack, Text, Wrap} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider} from '../../shared/components/components'
import {SecondaryButton} from '../../shared/components/button'
import {SettingsSection} from '../settings/components'
import {LEVELS, heldBy, levelLabel} from './catalog'

/**
 * "What it may do": the agent's actions, each Off, Ask me or Alone, and the catalog to add one from. The list starts
 * empty; an added action starts Off. An action one other agent holds (the validation's answers) cannot be added.
 */
export function ActionsSection({agent, agents, catalog, onChange}) {
  const {t} = useTranslation()
  const [isAdding, setIsAdding] = React.useState(false)
  const rows = catalog.filter(({id}) => agent.actions[id])
  const addable = catalog.filter(
    ({id, needs}) => !agent.actions[id] && (!needs || agent.actions[needs])
  )

  const setActions = (change) =>
    onChange((a) => ({...a, actions: change(a.actions)}))

  return (
    <SettingsSection title={t('What it may do')}>
      <Flex justify="space-between" align="flex-start" gap={4} mb={3}>
        <Text color="muted">
          {t(
            'Only the actions listed here; anything else it asks for is refused. Off: never. Ask me: you approve each one. Alone: it acts within the limit, and every action shows in Activity.',
            {nsSeparator: '!!'}
          )}
        </Text>
        <SecondaryButton
          flexShrink={0}
          aria-expanded={isAdding}
          isDisabled={addable.length === 0}
          onClick={() => setIsAdding(!isAdding)}
        >
          {t('Add an action')}
        </SecondaryButton>
      </Flex>
      {isAdding && (
        <Stack
          borderWidth={1}
          borderColor="blue.050"
          bg="blue.010"
          borderRadius="md"
          p={3}
          mb={2}
          spacing={2}
        >
          <Wrap spacing={2}>
            {addable.map(({id, label, defaults}) => {
              const holder = heldBy(id, agent, agents)
              return (
                <Button
                  key={id}
                  size="sm"
                  variant="outline"
                  bg="white"
                  isDisabled={Boolean(holder)}
                  title={
                    holder
                      ? t('{{name}} already answers the validation', {
                          name: holder,
                        })
                      : undefined
                  }
                  onClick={() => {
                    setIsAdding(false)
                    setActions((actions) => ({
                      ...actions,
                      [id]: defaults || {level: 'off'},
                    }))
                  }}
                >
                  {label}
                </Button>
              )
            })}
          </Wrap>
          {addable.some(({id}) => heldBy(id, agent, agents)) && (
            <Text fontSize="sm" color="muted">
              {t('Only one agent answers the validation: {{name}}.', {
                name: addable
                  .map(({id}) => heldBy(id, agent, agents))
                  .find(Boolean),
                nsSeparator: '!!',
              })}
            </Text>
          )}
        </Stack>
      )}
      {rows.length === 0 ? (
        <Text color="muted">
          {t('No action yet: it can do nothing.', {nsSeparator: '!!'})}
        </Text>
      ) : (
        <Stack spacing={0}>
          {rows.map(({id, label, limit}) => {
            const row = agent.actions[id]
            return (
              <React.Fragment key={id}>
                <HDivider />
                <Flex
                  py={4}
                  gap={4}
                  align="center"
                  justify="space-between"
                  wrap="wrap"
                >
                  <Stack spacing={1} flex="1 1 260px" minW={0}>
                    <Text fontWeight={500}>{label}</Text>
                    <Text fontSize="sm" color="muted">
                      {limit}
                    </Text>
                  </Stack>
                  <ButtonGroup
                    isAttached
                    size="sm"
                    role="radiogroup"
                    aria-label={label}
                  >
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
                        // An action that needs this one goes with it (reports need the answers).
                        catalog
                          .filter(({needs}) => needs === id)
                          .forEach(({id: other}) => delete next[other])
                        return next
                      })
                    }
                  >
                    {t('Remove')}
                  </Button>
                </Flex>
              </React.Fragment>
            )
          })}
        </Stack>
      )}
    </SettingsSection>
  )
}
