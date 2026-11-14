/* eslint-disable react/prop-types */
import * as React from 'react'
import {Flex, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {HDivider, Select} from '../../../shared/components/components'
import {SettingsSection} from '../components'
import {REPORT_REASONS} from '../../validation/practice'

// "When to report": the confidence each report reason needs before the agent reports a flip
// (main/agent/settings.js reportThresholds, from 50% to 100%). They depend on the model: the practice test's
// results show its confidences flip by flip.

const STEPS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]

/** A saved threshold as one of the steps' values ("0.7"); a value between two steps shows as it is. */
const optionValue = (threshold) => String(Math.round(threshold * 100) / 100)

export function ReportRulesSection({settings, onChange}) {
  const {t} = useTranslation()
  const thresholds = settings.reportThresholds || {}

  return (
    <SettingsSection title={t('When to report')}>
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
          const current = value === undefined ? undefined : optionValue(value)
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
    </SettingsSection>
  )
}
