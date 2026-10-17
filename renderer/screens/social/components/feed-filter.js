/* eslint-disable react/prop-types */
import {useTranslation} from 'react-i18next'
import {
  Box,
  HStack,
  IconButton,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Stack,
  Text,
} from '@chakra-ui/react'
import {FeedPeriod, FeedSort} from '../feed'
import {
  DEFAULT_FEED_FILTER,
  filterSummary,
  isDefaultFilter,
  isFollowed,
  isRanked,
} from '../feed-filter'
import {Chip} from './chips'
import {LINK} from './theme'

// The feed's filter at the end of the search bar, as the phone app's (feed-filter.js): each choice applies at once.

/** The texts of the filter's choices. */
export function useFilterLabels() {
  const {t} = useTranslation()
  return {
    people: t('People I follow'),
    topics: t('Topics I follow'),
    both: t('People and topics I follow'),
    sorts: {
      [FeedSort.Activity]: t('Latest activity'),
      [FeedSort.Newest]: t('Newest posts'),
      [FeedSort.Likes]: t('Most liked'),
      [FeedSort.Comments]: t('Most commented'),
      [FeedSort.Tips]: t('Most tipped'),
    },
    periods: {
      [FeedPeriod.Epoch]: t('This epoch'),
      [FeedPeriod.Week]: t('7 days'),
      [FeedPeriod.All]: t('All'),
    },
  }
}

/** The filter list icon (three lines, shorter each), with a dot while the filter is not the default. */
function FilterIcon({isDefault}) {
  return (
    <Box position="relative" w={5} h={5}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
      </svg>
      {!isDefault && (
        <Box
          position="absolute"
          top="-1px"
          right="-2px"
          w={2}
          h={2}
          rounded="full"
          bg={LINK}
        />
      )}
    </Box>
  )
}

function Section({title, children}) {
  return (
    <Stack spacing={2}>
      <Text fontWeight={600}>{title}</Text>
      <HStack spacing={2} flexWrap="wrap" rowGap={2}>
        {children}
      </HStack>
    </Stack>
  )
}

/**
 * The filter's button and its panel. Show: All, People I follow, Topics I follow (the two together show both),
 * › opens that list (`openList('people' | 'topics')`); Sort; the Period of a ranked sort.
 */
export function FeedFilterButton({
  filter,
  onChange,
  peopleCount,
  topicsCount,
  openList,
}) {
  const {t} = useTranslation()
  const labels = useFilterLabels()
  const isDefault = isDefaultFilter(filter)
  const followed = (key, label, count) => (
    <HStack spacing={0}>
      <Chip
        isSelected={filter[key]}
        onClick={() => onChange({...filter, [key]: !filter[key]})}
      >
        {`${label} ${count}`}
      </Chip>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label={t('Open the list')}
        title={t('Open the list')}
        icon={<Text fontSize="lg">›</Text>}
        onClick={() => openList(key)}
      />
    </HStack>
  )
  return (
    <Popover placement="bottom-end" isLazy>
      <PopoverTrigger>
        <IconButton
          variant="ghost"
          size="sm"
          rounded="full"
          color={isDefault ? 'gray.600' : LINK}
          aria-label={t('Filter the feed')}
          title={t('Filter the feed')}
          icon={<FilterIcon isDefault={isDefault} />}
        />
      </PopoverTrigger>
      <PopoverContent w="sm">
        <PopoverBody p={4}>
          <Stack spacing={4}>
            <Section title={t('Show')}>
              <Chip
                isSelected={!isFollowed(filter)}
                onClick={() =>
                  onChange({...filter, people: false, topics: false})
                }
              >
                {t('All')}
              </Chip>
              {followed('people', labels.people, peopleCount)}
              {followed('topics', labels.topics, topicsCount)}
            </Section>
            <Section title={t('Sort')}>
              {Object.values(FeedSort).map((sort) => (
                <Chip
                  key={sort}
                  isSelected={filter.sort === sort}
                  onClick={() => onChange({...filter, sort})}
                >
                  {labels.sorts[sort]}
                </Chip>
              ))}
            </Section>
            {isRanked(filter.sort) && (
              <Section title={t('Period')}>
                {Object.values(FeedPeriod).map((period) => (
                  <Chip
                    key={period}
                    isSelected={filter.period === period}
                    onClick={() => onChange({...filter, period})}
                  >
                    {labels.periods[period]}
                  </Chip>
                ))}
              </Section>
            )}
          </Stack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}

/** The line under the search naming a filter that is not the default; ✕ resets it. */
export function FeedFilterLine({filter, onChange}) {
  const {t} = useTranslation()
  const summary = filterSummary(filter, useFilterLabels())
  if (summary === null) return null
  return (
    <HStack spacing={1}>
      <Text fontWeight={500} color={LINK} flex={1} noOfLines={1}>
        {summary}
      </Text>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label={t('Show all posts')}
        title={t('Show all posts')}
        icon={<Text>✕</Text>}
        onClick={() => onChange(DEFAULT_FEED_FILTER)}
      />
    </HStack>
  )
}
