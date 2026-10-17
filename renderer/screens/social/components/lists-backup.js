/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {HStack, Stack, Text} from '@chakra-ui/react'
import {SmallText} from '../../../shared/components/components'
import {useSocial} from '../provider'
import {mergeLists, socialListsFromJson, socialListsToJson} from '../lists'
import {Chip} from './chips'

const MAX_IMPORT_BYTES = 2000000

/**
 * Export and import of the names, the people followed, muted and blocked, the topics followed and blocked, the hidden
 * words and the posts hidden, as one file (the phone app's format): an import adds to the lists, never removes.
 */
export function ListsBackup() {
  const {t} = useTranslation()
  const {
    people,
    setPeople,
    followedTopics,
    setFollowedTopics,
    hiddenWords,
    setHiddenWords,
    hiddenPosts,
    setHiddenPosts,
    blockedTopics,
    setBlockedTopics,
  } = useSocial()
  const [note, setNote] = React.useState(null)
  const fileRef = React.useRef()
  const lists = {
    people,
    topics: followedTopics,
    words: hiddenWords,
    hiddenPosts,
    blockedTopics,
  }
  const isEmpty =
    Object.keys(people).length === 0 &&
    [followedTopics, hiddenWords, hiddenPosts, blockedTopics].every(
      (list) => list.length === 0
    )

  const exportLists = () => {
    const json = socialListsToJson(lists)
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'idena-social-lists.json'
    link.click()
    // The app asks where to save it, as a download.
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    setNote(null)
  }

  const importLists = async (file) => {
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error(t('the file is too large'))
      const imported = socialListsFromJson(JSON.parse(await file.text()))
      if (!imported) throw new Error(t('this is not an exported list'))
      const result = mergeLists(lists, imported)
      setPeople(result.lists.people)
      setFollowedTopics(result.lists.topics)
      setHiddenWords(result.lists.words)
      setHiddenPosts(result.lists.hiddenPosts)
      setBlockedTopics(result.lists.blockedTopics)
      setNote(
        t(
          'Imported: {{added}} people added, {{changed}} changed; {{topics}} topics, {{words}} hidden words and {{others}} hidden posts or blocked topics added.',
          {
            added: result.added,
            changed: result.changed,
            topics: result.topicsAdded,
            words: result.wordsAdded,
            others: result.othersAdded,
            nsSeparator: '|',
          }
        )
      )
    } catch (error) {
      setNote(t('Import failed ({{message}}).', {message: error.message}))
    }
  }

  return (
    <Stack spacing={2}>
      <Text fontWeight={500}>{t('Your lists')}</Text>
      <SmallText>
        {t(
          'The names you gave, the people and the topics you follow, the accounts you muted, the accounts and topics you blocked, the hidden words and posts: kept on this computer only. Export saves them to a file; Import adds a file (from this computer or the phone app) without removing anything.',
          {nsSeparator: '|'}
        )}
      </SmallText>
      <HStack spacing={2}>
        <Chip isDisabled={isEmpty} onClick={exportLists}>
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
            if (file) importLists(file)
            e.target.value = ''
          }}
        />
      </HStack>
      {note && (
        <Text fontSize="sm" color="blue.500">
          {note}
        </Text>
      )}
    </Stack>
  )
}
