/* eslint-disable react/prop-types */
import * as React from 'react'
import {Flex, Input, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'

// An action's limits a day, under its levels (B-239, B-240, B-269): how many a day and the most iDNA a day, fees
// included (posts, replies, likes, messages); a tip's amount and the iDNA it may tip a day; a story agent's pictures
// a day. Read when the field loses focus or on Enter; a number it cannot read puts the saved one back.

/** The number in `text`, or null when it is not one that fits (`whole`: a whole number; `min`: the least). */
export function readNumber(text, {whole = true, min = 0} = {}) {
  const value = String(text ?? '').trim()
  if (value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < min) return null
  if (whole && !Number.isInteger(number)) return null
  if (whole) return number
  // To the hundredth; an amount that would round to 0 is refused, never saved as 0 (a 0 limit blocks every action).
  const rounded = Math.round(number * 100) / 100
  return number > 0 && rounded === 0 ? null : rounded
}

/**
 * A number field saved on blur or Enter. `whole`: whole numbers only (else to the hundredth); `optional`: an empty
 * field saves null (none), shown with `placeholder`.
 */
export function NumberField({
  label,
  value,
  min,
  onSave,
  whole = true,
  optional = false,
  placeholder,
}) {
  const [draft, setDraft] = React.useState(String(value ?? ''))
  React.useEffect(() => setDraft(String(value ?? '')), [value])
  const save = (e) => {
    const text = e.currentTarget.value.trim()
    if (optional && text === '' && !e.currentTarget.validity.badInput) {
      if (value !== null) onSave(null)
      return
    }
    const next = e.currentTarget.validity.badInput
      ? null
      : readNumber(text, {min, whole})
    if (next === null) setDraft(String(value ?? ''))
    else {
      // The field shows what is kept (rounded to the hundredth).
      setDraft(String(next))
      if (next !== value) onSave(next)
    }
  }
  return (
    <Flex align="center" gap={2}>
      <Input
        type="number"
        size="sm"
        w="80px"
        min={min}
        step={whole ? 1 : 0.01}
        placeholder={placeholder}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save(e)}
      />
      <Text color="muted">{label}</Text>
    </Flex>
  )
}

/** An action's own iDNA a day, fees included (B-269): empty, none of its own. */
function SpendField({row, onChange}) {
  const {t} = useTranslation()
  return (
    <NumberField
      label={t('iDNA at most a day, fees included')}
      value={row.spendPerDay ?? null}
      min={0}
      whole={false}
      optional
      placeholder={t('None', {nsSeparator: '!!'})}
      onSave={(spendPerDay) => onChange({spendPerDay})}
    />
  )
}

/**
 * The fields of one action's row: `kind` is 'count', 'idna' (a tip's) or 'pictures' (a story agent that draws),
 * `onChange(change)` changes the row.
 */
export function LimitFields({kind, row, onChange}) {
  const {t} = useTranslation()
  if (kind === 'pictures')
    return (
      <NumberField
        label={t('pictures at most a day')}
        value={row.picturesPerDay ?? null}
        min={0}
        optional
        placeholder={t('None', {nsSeparator: '!!'})}
        onSave={(picturesPerDay) => onChange({picturesPerDay})}
      />
    )
  if (kind === 'idna')
    return (
      <Flex gap={4} wrap="wrap">
        <NumberField
          label={t('iDNA a tip')}
          value={row.amount}
          min={1}
          onSave={(amount) => onChange({amount})}
        />
        <NumberField
          label={t('iDNA tipped at most a day')}
          value={row.limit}
          min={0}
          onSave={(limit) => onChange({limit})}
        />
        <SpendField row={row} onChange={onChange} />
      </Flex>
    )
  return (
    <Flex gap={4} wrap="wrap">
      <NumberField
        label={t('at most a day')}
        value={row.limit}
        min={0}
        onSave={(limit) => onChange({limit})}
      />
      <SpendField row={row} onChange={onChange} />
    </Flex>
  )
}
