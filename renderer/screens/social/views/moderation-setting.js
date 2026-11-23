import {useTranslation} from 'react-i18next'
import {useRouter} from 'next/router'
import {Radio, RadioGroup, Stack} from '@chakra-ui/react'
import {SecondaryButton} from '../../../shared/components/button'
import {useModerator} from '../components/moderator-actions'
import {SmallText} from '../../../shared/components/components'
import {MODERATION_FIRST_BLOCK} from '../moderation'
import {useSocial} from '../provider'

/**
 * The Social setting "Community moderation" (B-308), off unless turned on: with it on, the app follows the decisions
 * of the community moderators recorded by the idena.social moderation contract, as the idena.social website does.
 */
export function CommunityModerationSetting() {
  const {t} = useTranslation()
  const {communityModeration, setCommunityModeration, moderation} = useSocial()
  const {role} = useModerator()
  const router = useRouter()
  return (
    <Stack spacing={2}>
      <RadioGroup
        value={communityModeration ? 'on' : 'off'}
        onChange={(value) => setCommunityModeration(value === 'on')}
      >
        <Stack spacing={2}>
          <Radio value="off">
            {t('Off: show everything', {nsSeparator: '|'})}
          </Radio>
          <Radio value="on">
            {t('On: follow the community moderators', {nsSeparator: '|'})}
          </Radio>
        </Stack>
      </RadioGroup>
      <SmallText>
        {t(
          'The community moderators record on the blockchain which accounts are banned and which posts are hidden, as on the Idena Social website. A moderator is an identity with at least 1,000,000 iDNA staked, or an account such an identity vouched for.'
        )}
      </SmallText>
      <SmallText>
        {t(
          "With it on, a post made while its author is banned is not shown. An older post of theirs, or a post hidden by the moderators, shows as a line while replies under it are shown, and goes otherwise; its text and pictures are not downloaded. Likes, tips and messages still count. Your node reads the moderators' decisions: nothing is sent.",
          {nsSeparator: '|'}
        )}
      </SmallText>
      {communityModeration && moderation.error && (
        <SmallText color="red.500">
          {t('Cannot read the moderation decisions: {{message}}', {
            message: moderation.error.message,
            nsSeparator: '|',
          })}
        </SmallText>
      )}
      {communityModeration &&
        !moderation.error &&
        moderation.high >= MODERATION_FIRST_BLOCK && (
          <SmallText>
            {t('Decisions read through block {{block}}.', {
              block: moderation.high.toLocaleString(),
            })}
          </SmallText>
        )}
      {role && (
        <SecondaryButton
          alignSelf="flex-start"
          onClick={() =>
            router.push({pathname: '/social', query: {view: 'moderation'}})
          }
        >
          {t('Open the moderation page')}
        </SecondaryButton>
      )}
    </Stack>
  )
}
