/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {HStack, Stack, Text, IconButton} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../../shared/components/components'
import {SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {NotifyKind} from '../activity'
import {ActivityCard, notifyKindLabels} from '../components/activity'
import {Chip} from '../components/chips'
import {PAGE_SIZE, ShowMore} from './common'
import {OfferReceivedCard} from '../components/profile-vouch'

/** The Notifications tab: the vouch offers waiting for an answer, then the likes, answers and tips on your posts. */
export function Notifications({now, openThread, openProfile}) {
  const {t} = useTranslation()
  const {
    activity,
    highlightAfter,
    markSeen,
    notifyKinds,
    setNotifyKinds,
    setInboxOpen,
    offersTo,
  } = useSocial()
  const [isInfoOpen, setIsInfoOpen] = React.useState(false)
  const [shown, setShown] = React.useState(PAGE_SIZE)
  React.useEffect(() => {
    setInboxOpen(true)
    return () => setInboxOpen(false)
  }, [setInboxOpen])
  // What arrives while the list is open is seen too.
  React.useEffect(() => {
    markSeen()
  }, [activity, markSeen])
  const labels = notifyKindLabels(t)
  return (
    <Stack spacing={3} w="full">
      <HStack spacing={2}>
        {Object.values(NotifyKind).map((kind) => (
          <Chip
            key={kind}
            isSelected={notifyKinds.includes(kind)}
            onClick={() =>
              setNotifyKinds(
                notifyKinds.includes(kind)
                  ? notifyKinds.filter((k) => k !== kind)
                  : notifyKinds.concat(kind)
              )
            }
          >
            {labels[kind]}
          </Chip>
        ))}
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={t('Notifications')}
          title={t('Notifications')}
          icon={<Text>🔔</Text>}
          onClick={() => setIsInfoOpen(true)}
        />
      </HStack>
      {offersTo.map(({voucher}) => (
        <OfferReceivedCard
          key={voucher}
          voucher={voucher}
          onProfile={openProfile}
        />
      ))}
      {activity.length === 0 && (
        <SmallText>
          {t('No likes, answers or tips on your posts yet.')}
        </SmallText>
      )}
      {activity.slice(0, shown).map((item) => (
        <ActivityCard
          key={`${item.kind}-${item.height}-${item.index}-${item.focusId}`}
          item={item}
          now={now}
          isNew={highlightAfter !== null && item.height > highlightAfter}
          onOpen={() => openThread(item.threadId, item.focusId)}
          onProfile={openProfile}
        />
      ))}
      <ShowMore
        shown={shown}
        total={activity.length}
        onMore={() => setShown(shown + PAGE_SIZE)}
      />
      {isInfoOpen && (
        <Dialog
          title={t('Notifications')}
          isOpen
          onClose={() => setIsInfoOpen(false)}
        >
          <DialogBody>
            <Text color="muted">
              {t(
                'A notice comes for each new like, comment or tip on your posts, of the kinds selected. All of them are listed here.'
              )}
            </Text>
          </DialogBody>
          <DialogFooter>
            <SecondaryButton onClick={() => setIsInfoOpen(false)}>
              {t('Close')}
            </SecondaryButton>
          </DialogFooter>
        </Dialog>
      )}
    </Stack>
  )
}
