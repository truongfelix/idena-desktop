/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Button,
  Divider,
  HStack,
  Stack,
  Text,
  IconButton,
} from '@chakra-ui/react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  SmallText,
} from '../../../shared/components/components'
import {SecondaryButton} from '../../../shared/components/button'
import {useSocial} from '../provider'
import {
  mergePeople,
  peopleFromJson,
  peopleToJson,
  sortedPeople,
} from '../people'
import {NotifyKind} from '../activity'
import {ActivityCard, notifyKindLabels} from '../components/activity'
import {Chip} from '../components/chips'
import {ContactRow, PAGE_SIZE, ShowMore} from './common'

const MAX_IMPORT_BYTES = 2000000

export const InboxView = {Notifications: 'notifications', Contacts: 'contacts'}

function Notifications({now, openThread, openProfile}) {
  const {t} = useTranslation()
  const {
    activity,
    highlightAfter,
    markSeen,
    notifyKinds,
    setNotifyKinds,
    setInboxOpen,
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

function Contacts({openProfile, onRename}) {
  const {t} = useTranslation()
  const {people, setPeople} = useSocial()
  const [note, setNote] = React.useState(null)
  const [isInfoOpen, setIsInfoOpen] = React.useState(false)
  const fileRef = React.useRef()
  const list = sortedPeople(people)

  const exportList = () => {
    const blob = new Blob([JSON.stringify(peopleToJson(people), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'idena-contacts.json'
    link.click()
    // The app asks where to save it, as a download.
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    setNote(null)
  }

  const importList = async (file) => {
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error(t('the file is too large'))
      const json = JSON.parse(await file.text())
      if (!Array.isArray(json?.people))
        throw new Error(t('this is not an exported contact list'))
      const result = mergePeople(people, peopleFromJson(json))
      setPeople(result.people)
      setNote(
        t('Imported {{added}} contacts added, {{changed}} changed.', {
          added: result.added,
          changed: result.changed,
        })
      )
    } catch (error) {
      setNote(t('Import failed ({{message}}).', {message: error.message}))
    }
  }

  return (
    <Stack spacing={3} w="full">
      <HStack spacing={2}>
        <Chip isDisabled={list.length === 0} onClick={exportList}>
          {t('Export')}
        </Chip>
        <Chip onClick={() => fileRef.current?.click()}>{t('Import')}</Chip>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const [file] = e.target.files || []
            if (file) importList(file)
            e.target.value = ''
          }}
        />
        <Box flex={1} />
        <Button variant="ghost" size="sm" onClick={() => setIsInfoOpen(true)}>
          ⓘ
        </Button>
      </HStack>
      {note && (
        <Text fontSize="sm" color="blue.500">
          {note}
        </Text>
      )}
      {list.length === 0 && <SmallText>{t('No contacts yet.')}</SmallText>}
      {list.map((contact) => (
        <ContactRow
          key={contact.address}
          contact={contact}
          onProfile={openProfile}
          onRename={onRename}
        />
      ))}
      {isInfoOpen && (
        <Dialog
          title={t('Contacts')}
          isOpen
          onClose={() => setIsInfoOpen(false)}
        >
          <DialogBody>
            <Stack spacing={3} color="muted">
              <Text>
                {t(
                  'Names and follows stay on this computer: nobody else sees them. A name shows instead of the address in the Social tab; the posts of the people you follow make the Following feed.',
                  {nsSeparator: '|'}
                )}
              </Text>
              <Text>
                {t(
                  'To add someone, open a profile and select ✎ or Follow. Export saves the list to a file; Import merges a file in (from this computer or the phone app) without removing anything.'
                )}
              </Text>
            </Stack>
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

export function Inbox({view, setView, now, openThread, openProfile, onRename}) {
  const {t} = useTranslation()
  const {unread} = useSocial()
  return (
    <Stack spacing={3} w="full">
      <HStack spacing={2}>
        <Chip
          isSelected={view === InboxView.Notifications}
          onClick={() => setView(InboxView.Notifications)}
        >
          {unread.length > 0
            ? t('Notifications · {{count}} new', {count: unread.length})
            : t('Notifications')}
        </Chip>
        <Chip
          isSelected={view === InboxView.Contacts}
          onClick={() => setView(InboxView.Contacts)}
        >
          {t('Contacts')}
        </Chip>
      </HStack>
      <Divider />
      {view === InboxView.Contacts ? (
        <Contacts openProfile={openProfile} onRename={onRename} />
      ) : (
        <Notifications
          now={now}
          openThread={openThread}
          openProfile={openProfile}
        />
      )}
    </Stack>
  )
}
