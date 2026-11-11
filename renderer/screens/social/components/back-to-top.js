/* eslint-disable react/prop-types */
import React from 'react'
import {useTranslation} from 'react-i18next'
import {IconButton, Text} from '@chakra-ui/react'

/**
 * Whether the ↑ button shows: once the page is scrolled down more than one screen (its visible height), so a short
 * scroll keeps the view clear (owner 2026-10-31, B-175).
 */
export const showsBackToTop = ({scrollTop, clientHeight}) =>
  clientHeight > 0 && scrollTop > clientHeight

/**
 * A round ↑ in the bottom-right corner that scrolls `area` (the page's scrolling element, given by `areaOf()` once
 * the page is drawn) back to its top; shown only while `showsBackToTop` holds.
 */
export function BackToTop({areaOf}) {
  const {t} = useTranslation()
  const [area, setArea] = React.useState(null)
  const [shown, setShown] = React.useState(false)

  React.useEffect(() => {
    setArea(areaOf())
  }, [areaOf])

  React.useEffect(() => {
    if (!area) return undefined
    const update = () => setShown(showsBackToTop(area))
    update()
    area.addEventListener('scroll', update, {passive: true})
    window.addEventListener('resize', update)
    return () => {
      area.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [area])

  if (!shown) return null
  const label = t('Back to the top')
  return (
    <IconButton
      position="fixed"
      right={8}
      bottom={8}
      zIndex={3}
      isRound
      size="lg"
      bg="surface"
      borderWidth={1}
      borderColor="gray.100"
      boxShadow="md"
      aria-label={label}
      title={label}
      icon={
        <Text fontSize="xl" fontWeight={700} lineHeight={1}>
          ↑
        </Text>
      }
      onClick={() => area.scrollTo({top: 0, behavior: 'smooth'})}
    />
  )
}
