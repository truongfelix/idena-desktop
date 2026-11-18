/* eslint-disable react/prop-types */
import * as React from 'react'
import {SimpleGrid, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {
  FormControlWithLabel,
  Input,
  Select,
  Textarea,
} from '../../../shared/components/components'

// An agent's internet (B-294): Off, Search, Search and pages; the sites it may or may not use (one list); the searches
// in one answer and a day. The main process checks every field (main/agent/internet.js) and the page shows what it
// kept.

/** The most searches in one answer (main/agent/internet.js MAX_PER_ANSWER). */
const MAX_PER_ANSWER = 10

/** A whole number from `min`, or null for an empty field or one it cannot read. */
function readWhole(text, min) {
  const number = Number(String(text).replace(/[\s,._]/gu, ''))
  return String(text).trim() && Number.isInteger(number) && number >= min
    ? number
    : null
}

/** A number's field, saved on leaving it (or on Enter); it shows what was saved after. */
function WholeInput({value, onSave, min, ...props}) {
  const shown = value === null || value === undefined ? '' : String(value)
  const [draft, setDraft] = React.useState(shown)
  React.useEffect(() => setDraft(shown), [shown])
  return (
    <Input
      value={draft}
      inputMode="numeric"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const next = readWhole(e.currentTarget.value, min)
        setDraft(next === null ? '' : String(next))
        if (next !== (value ?? null)) onSave(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      {...props}
    />
  )
}

/** The sites' list, one per line, saved on leaving it. */
function SitesInput({value, onSave}) {
  const shown = (value || []).join('\n')
  const [draft, setDraft] = React.useState(shown)
  React.useEffect(() => setDraft(shown), [shown])
  return (
    <Textarea
      value={draft}
      rows={3}
      placeholder="wikipedia.org"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const list = draft
          .split(/[\s,]+/u)
          .map((site) => site.trim())
          .filter(Boolean)
        if (list.join('\n') !== shown) onSave(list)
      }}
    />
  )
}

export function InternetFields({settings, onChange}) {
  const {t} = useTranslation()
  const internet = settings.internet || {mode: 'off'}
  const set = (change) =>
    onChange((s) => ({...s, internet: {...(s.internet || {}), ...change}}))
  const onAnthropic = settings.provider === 'anthropic'
  return (
    <Stack spacing={3}>
      <FormControlWithLabel label={t('Internet')}>
        <Select
          value={internet.mode}
          onChange={(e) => set({mode: e.target.value})}
        >
          <option value="off">{t('Off')}</option>
          <option value="search">{t('Search the web')}</option>
          <option value="pages">{t('Search the web and open pages')}</option>
        </Select>
      </FormControlWithLabel>
      {internet.mode !== 'off' && !onAnthropic && (
        <Text color="muted" fontSize="sm">
          {t(
            'The internet works only with the Anthropic API: this service is sent no web tools, and the agent answers without them.',
            {nsSeparator: '!!'}
          )}
        </Text>
      )}
      {internet.mode !== 'off' && onAnthropic && (
        <>
          <SimpleGrid columns={[1, 2]} spacing={4}>
            <FormControlWithLabel label={t('Searches in one answer')}>
              <WholeInput
                value={internet.perAnswer}
                min={1}
                placeholder="3"
                onSave={(perAnswer) =>
                  set({
                    perAnswer:
                      perAnswer === null
                        ? null
                        : Math.min(perAnswer, MAX_PER_ANSWER),
                  })
                }
              />
            </FormControlWithLabel>
            <FormControlWithLabel label={t('Searches a day')}>
              <WholeInput
                value={internet.perDay}
                min={0}
                placeholder={t('No limit')}
                onSave={(perDay) => set({perDay})}
              />
            </FormControlWithLabel>
          </SimpleGrid>
          <FormControlWithLabel label={t('Sites')}>
            <Stack spacing={2}>
              <Select
                value={internet.sites || 'block'}
                onChange={(e) => set({sites: e.target.value})}
              >
                <option value="block">{t('Every site but these')}</option>
                <option value="allow">{t('Only these sites')}</option>
              </Select>
              <SitesInput
                value={internet.list}
                onSave={(list) => set({list})}
              />
            </Stack>
          </FormControlWithLabel>
          <Text color="muted" fontSize="sm">
            {t(
              'The searches run at Anthropic, not from this computer: what the agent searches for is sent there. Each search is billed by Anthropic (10 USD per 1,000 searches), and what the agent reads on the web is billed as input. One site per line, as example.com or example.com/blog; an empty list: every site.',
              {nsSeparator: '!!'}
            )}
          </Text>
        </>
      )}
    </Stack>
  )
}
