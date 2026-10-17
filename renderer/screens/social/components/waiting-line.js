/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {Stack, Text} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../../shared/components/components'
import {SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {LINK} from './theme'

/**
 * Under Social's title while profile calls wait for their block (sending.js, inFlight): "2 actions waiting for a
 * block"; a click lists them. Nothing while none waits.
 */
export function WaitingLine() {
  const {t} = useTranslation()
  const {sending} = useSocial()
  const [isOpen, setIsOpen] = React.useState(false)
  const {inFlight} = sending
  if (inFlight.length === 0) return null
  return (
    <>
      <Text
        as="button"
        textAlign="left"
        fontSize="sm"
        color={LINK}
        onClick={() => setIsOpen(true)}
      >
        {inFlight.length === 1
          ? t('1 action waiting for a block')
          : t('{{count}} actions waiting for a block', {
              count: inFlight.length,
            })}
      </Text>
      {isOpen && (
        <Dialog
          title={t('Waiting for a block')}
          isOpen
          onClose={() => setIsOpen(false)}
        >
          <DialogBody>
            <Stack spacing={2}>
              {inFlight.map(({hash, what}) => (
                <Text key={hash}>
                  {t('{{what}} · sent, waiting for its block ({{hash}}…)', {
                    what,
                    hash: String(hash).slice(0, 10),
                  })}
                </Text>
              ))}
              <SmallText>
                {t(
                  'A block comes about every 20 seconds; the same action cannot be sent again meanwhile.'
                )}
              </SmallText>
            </Stack>
          </DialogBody>
          <DialogFooter>
            <SecondaryButton onClick={() => setIsOpen(false)}>
              {t('Close')}
            </SecondaryButton>
          </DialogFooter>
        </Dialog>
      )}
    </>
  )
}
