/* eslint-disable react/prop-types */
import * as React from 'react'
import {Flex, Input, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'

// An action's limit a day, under its levels (B-239, B-240): how many a day (posts, replies, likes, messages), or a
// tip's amount and the iDNA it may tip a day. Read when the field loses focus or on Enter; a number it cannot read
// puts the saved one back.

/** The number in `text`, or null when it is not one that fits (`whole`: a whole number; `min`: the least). */
export function readNumber(text, {whole = true, min = 0} = {}) {
  const value = String(text ?? '').trim()
  if (value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < min) return null
  if (whole && !Number.isInteger(number)) return null
  return number
}

function NumberField({label, value, min, onSave}) {
  const [draft, setDraft] = React.useState(String(value ?? ''))
  React.useEffect(() => setDraft(String(value ?? '')), [value])
  const save = (e) => {
    const next = e.currentTarget.validity.badInput
      ? null
      : readNumber(e.currentTarget.value, {min})
    if (next === null) setDraft(String(value ?? ''))
    else if (next !== value) onSave(next)
  }
  return (
    <Flex align="center" gap={2}>
      <Input
        type="number"
        size="sm"
        w="80px"
        min={min}
        step={1}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save(e)}
      />
      <Text fontSize="sm" color="muted">
        {label}
      </Text>
    </Flex>
  )
}

/** The fields of one action's row: `kind` is 'count' or 'idna' (a tip's), `onChange(change)` changes the row. */
export function LimitFields({kind, row, onChange}) {
  const {t} = useTranslation()
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
          label={t('iDNA at most a day')}
          value={row.limit}
          min={0}
          onSave={(limit) => onChange({limit})}
        />
      </Flex>
    )
  return (
    <NumberField
      label={t('at most a day')}
      value={row.limit}
      min={0}
      onSave={(limit) => onChange({limit})}
    />
  )
}
