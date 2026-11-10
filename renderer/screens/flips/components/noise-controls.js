/* eslint-disable react/prop-types */
import React from 'react'
import {
  Flex,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {NOISE_LIMITS, noiseEffects} from '../noise'

// The Protect step's control for each effect of the adversarial noise on the picture shown (B-213). They start at
// what the automatic noise chose; each change makes the picture's noise again with the new values (on release for a
// slider), and the controls wait for it. `onChange` resolves to false when the picture did not change: the controls
// go back to its effects. Grain and colour shift start at the noise always sent (20% and 20 degrees, owner 2026-11-10,
// B-217); the brightness is the picture editor's.
export function NoiseControls({effects, isDisabled, onChange}) {
  const {t} = useTranslation()
  const [values, setValues] = React.useState(() => noiseEffects(effects))
  const [isBusy, setIsBusy] = React.useState(false)

  React.useEffect(() => {
    setValues(noiseEffects(effects))
  }, [effects])

  const commit = async (next) => {
    const current = noiseEffects(effects)
    if (Object.keys(next).every((key) => next[key] === current[key])) {
      setValues(current)
      return
    }
    setValues(next)
    setIsBusy(true)
    try {
      if (!(await onChange(next))) setValues(noiseEffects(effects))
    } finally {
      setIsBusy(false)
    }
  }
  const disabled = isDisabled || isBusy

  const slider = (key, label, unit) => (
    <Flex align="center" key={key}>
      <Text fontSize="sm" color="muted" w={28} flexShrink={0}>
        {label}
      </Text>
      <Slider
        aria-label={label}
        min={NOISE_LIMITS[key].min}
        max={NOISE_LIMITS[key].max}
        step={1}
        value={values[key]}
        isDisabled={disabled}
        focusThumbOnChange={false}
        onChange={(value) => setValues((v) => ({...v, [key]: value}))}
        onChangeEnd={(value) => commit({...values, [key]: value})}
      >
        <SliderTrack>
          <SliderFilledTrack />
        </SliderTrack>
        <SliderThumb />
      </Slider>
      <Text fontSize="sm" color="muted" w={12} textAlign="right" ml={3}>
        {values[key]}
        {unit}
      </Text>
    </Flex>
  )

  return (
    <Stack spacing={2} mt={3} w="440px">
      <Flex align="center">
        <Text fontSize="sm" color="muted" w={28} flexShrink={0}>
          {t('Mirror')}
        </Text>
        <Switch
          aria-label={t('Mirror')}
          isChecked={values.mirror}
          isDisabled={disabled}
          onChange={(e) => commit({...values, mirror: e.target.checked})}
        />
      </Flex>
      {slider('grain', t('Grain'), '%')}
      {slider('hue', t('Color shift'), '°')}
    </Stack>
  )
}
