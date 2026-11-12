/* eslint-disable react/prop-types */
import * as React from 'react'
import {Button, ButtonGroup, Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider} from '../../../shared/components/components'
import {SettingsSection} from '../components'

// The rows of "What the agent may do". The first version acts in the validation only: the other actions
// (main/agent/settings.js ACTIONS) get their rows with their tools.

function useRows() {
  const {t} = useTranslation()
  return [
    {
      id: 'answerFlip',
      area: t('Validation'),
      label: t('Answer the flips'),
      limit: t(
        'Alone = Autopilot, Ask me = Suggest (its pick is highlighted, you click). A flip it cannot answer in time stays unanswered.'
      ),
    },
    {
      id: 'report',
      area: t('Validation'),
      label: t('Report flips'),
      limit: t('Only when it is at least 90% sure the flip breaks the rules'),
    },
  ]
}

export function PermissionsSection({settings, onChange}) {
  const {t} = useTranslation()
  const rows = useRows()
  const levels = [
    {id: 'off', label: t('Off')},
    {id: 'ask', label: t('Ask me')},
    {id: 'alone', label: t('Alone')},
  ]

  return (
    <SettingsSection title={t('What the agent may do')}>
      <Text color="muted" mb={3}>
        {t(
          'Off: never. Ask me: it prepares the action and you approve it. Alone: it acts within the limit, and every action shows in Activity.',
          {nsSeparator: '!!'}
        )}
      </Text>
      <Stack spacing={0}>
        {rows.map(({id, area, label, limit}) => (
          <React.Fragment key={id}>
            <HDivider />
            <Flex
              py={4}
              gap={4}
              align="center"
              justify="space-between"
              wrap="wrap"
            >
              <Stack spacing={1} flex="1 1 280px" minW={0}>
                <Text fontSize="sm" color="muted" textTransform="uppercase">
                  {area}
                </Text>
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
                {levels.map((level) => {
                  const isOn = settings.permissions[id].level === level.id
                  return (
                    <Button
                      key={level.id}
                      role="radio"
                      aria-checked={isOn}
                      variant={isOn ? 'solid' : 'outline'}
                      colorScheme={isOn ? 'blue' : 'gray'}
                      onClick={() =>
                        !isOn &&
                        onChange((s) => ({
                          ...s,
                          permissions: {
                            ...s.permissions,
                            [id]: {...s.permissions[id], level: level.id},
                          },
                        }))
                      }
                    >
                      {level.label}
                    </Button>
                  )
                })}
              </ButtonGroup>
            </Flex>
          </React.Fragment>
        ))}
      </Stack>
    </SettingsSection>
  )
}
