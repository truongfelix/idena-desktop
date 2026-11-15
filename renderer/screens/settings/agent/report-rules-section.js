/* eslint-disable react/prop-types */
import * as React from 'react'
import {Button, Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider, Select} from '../../../shared/components/components'
import {SettingsSection} from '../components'
import {REPORT_REASONS} from '../../validation/practice'

// "When to report": the confidence each report reason needs before the agent reports a flip
// (main/agent/settings.js reportThresholds, from 50% to 100%). They depend on the model: the practice test's
// results show its confidences flip by flip.

const STEPS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]

/** The number of reasons a summary names one by one at most: past this, "Custom thresholds". */
const MAX_GROUPS = 3

/**
 * The thresholds in one line (B-234): the reasons in runs of the same threshold ("Reasons 1-4 at 70%, 5-9 at 90%",
 * "All reasons at 70%"), or "Custom thresholds" when they make more than three runs.
 */
export function thresholdsSummary(thresholds, t) {
  const reasons = Object.keys(REPORT_REASONS)
    .map(Number)
    .sort((a, b) => a - b)
  const runs = []
  reasons.forEach((reason) => {
    const value = thresholds[reason]
    const last = runs[runs.length - 1]
    if (last && last.value === value) last.to = reason
    else runs.push({from: reason, to: reason, value})
  })
  const percent = (value) =>
    value === undefined ? '?' : `${Math.round(value * 100)}%`
  if (runs.length === 1)
    return t('All reasons at {{percent}}', {percent: percent(runs[0].value)})
  if (runs.length > MAX_GROUPS) return t('Custom thresholds')
  return t('Reasons {{runs}}', {
    runs: runs
      .map(({from, to, value}) =>
        from === to
          ? t('{{reason}} at {{percent}}', {
              reason: from,
              percent: percent(value),
            })
          : t('{{from}}-{{to}} at {{percent}}', {
              from,
              to,
              percent: percent(value),
            })
      )
      .join(', '),
  })
}

// Whether the person left the thresholds open: remembered on this computer (a convenience; none = folded).
const OPEN_KEY = 'agent.reportRulesOpen'
function readOpen() {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}
function writeOpen(open) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // Not kept: the section opens folded next time.
  }
}

/** A saved threshold as one of the steps' values ("0.7"); a value between two steps shows as it is. */
const optionValue = (threshold) => String(Math.round(threshold * 100) / 100)

export function ReportRulesSection({settings, onChange}) {
  const {t} = useTranslation()
  const thresholds = settings.reportThresholds || {}
  const [isOpen, setIsOpen] = React.useState(readOpen)
  const toggle = () => {
    writeOpen(!isOpen)
    setIsOpen(!isOpen)
  }

  return (
    <SettingsSection title={t('When to report')}>
      <Flex justify="space-between" align="center" gap={4} mb={isOpen ? 3 : 0}>
        <Text fontWeight={500}>{thresholdsSummary(thresholds, t)}</Text>
        <Button
          size="sm"
          variant="link"
          colorScheme="blue"
          aria-expanded={isOpen}
          onClick={toggle}
        >
          {isOpen ? t('Fold') : t('Change')}
        </Button>
      </Flex>
      {isOpen && (
        <>
          <Text color="muted" mb={3}>
            {t(
              'The agent reports a flip when it is at least this sure that the flip breaks one of these rules. The right values depend on the model: the practice test shows how sure it was, flip by flip.',
              {nsSeparator: '!!'}
            )}
          </Text>
          <Stack spacing={0}>
            {Object.keys(REPORT_REASONS).map((reason) => {
              const value = thresholds[reason]
              const steps = STEPS.map((step) => optionValue(step / 100))
              const current =
                value === undefined ? undefined : optionValue(value)
              return (
                <React.Fragment key={reason}>
                  <HDivider />
                  <Flex py={3} gap={4} align="center" justify="space-between">
                    <Text flex="1 1 auto" minW={0}>
                      {t(REPORT_REASONS[reason])}
                    </Text>
                    <Select
                      aria-label={t(REPORT_REASONS[reason])}
                      w={24}
                      flexShrink={0}
                      value={current}
                      isDisabled={value === undefined}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        onChange((s) => ({
                          ...s,
                          reportThresholds: {
                            ...s.reportThresholds,
                            [reason]: next,
                          },
                        }))
                      }}
                    >
                      {current !== undefined && !steps.includes(current) && (
                        <option value={current}>{`${Math.round(
                          value * 100
                        )}%`}</option>
                      )}
                      {STEPS.map((step) => (
                        <option key={step} value={optionValue(step / 100)}>
                          {`${step}%`}
                        </option>
                      ))}
                    </Select>
                  </Flex>
                </React.Fragment>
              )
            })}
          </Stack>
        </>
      )}
    </SettingsSection>
  )
}
