/* eslint-disable react/prop-types */
import * as React from 'react'
import {Button, Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  Dialog,
  DialogBody,
  DialogFooter,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {levelLabel} from './catalog'
import {flipStarts} from './rights'

/**
 * The starting points of the Flips area (B-280): each sets the level of every step at once, so it asks first
 * (owner 2026-11-16), naming each step and the level it takes. `onPick(levels)` applies it.
 */
export function FlipStarts({catalog, onPick}) {
  const {t} = useTranslation()
  const [asked, setAsked] = React.useState(null)
  return (
    <Flex gap={2} align="center" wrap="wrap">
      <Text color="muted">{t('Start from')}</Text>
      {flipStarts(t).map((start) => (
        <Button
          key={start.id}
          size="sm"
          variant="outline"
          onClick={() => setAsked(start)}
        >
          {start.label}
        </Button>
      ))}
      <Dialog
        title={t('Set every step of Flips?')}
        isOpen={Boolean(asked)}
        onClose={() => setAsked(null)}
      >
        <DialogBody>
          <Stack spacing={3}>
            <Text>
              {t(
                'Each step takes the level below, in place of the one it has now. Their limits a day stay.'
              )}
            </Text>
            <Stack spacing={1}>
              {asked &&
                catalog
                  .filter(({id}) => asked.levels[id])
                  .map(({id, label}) => (
                    <Flex key={id} justify="space-between" gap={4}>
                      <Text>{label}</Text>
                      <Text fontWeight={500}>
                        {levelLabel(asked.levels[id], t)}
                      </Text>
                    </Flex>
                  ))}
            </Stack>
          </Stack>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton onClick={() => setAsked(null)}>
            {t('Cancel')}
          </SecondaryButton>
          <PrimaryButton
            onClick={() => {
              onPick(asked.levels)
              setAsked(null)
            }}
          >
            {t('Set the steps')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
    </Flex>
  )
}
