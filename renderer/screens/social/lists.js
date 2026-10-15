import {mergePeople, peopleFromJson, peopleToJson, sortedPeople} from './people'
import {cleanTopics} from './topics'

// What Social keeps on this computer for the user alone: the names given to people, the people followed and the
// topics followed. Exported and imported as one file (Social's ⓘ), to keep it or move it to another computer or to
// the phone app: the phone's format (SocialLists.kt). Version 1 files (the Contacts export: names and people only)
// still import.

const LISTS_VERSION = 2

/** The people followed, in name order. */
export const followedPeople = (people) =>
  sortedPeople(people).filter(({following}) => following)

/** The export file: the people (peopleToJson) and the topics, sorted. */
export const socialListsToJson = ({people, topics}) => ({
  ...peopleToJson(people),
  version: LISTS_VERSION,
  topics: cleanTopics(topics),
})

/** A file's lists {people, topics}; entries that are not valid are left out. Null when it is not an export. */
export function socialListsFromJson(json) {
  if (!Array.isArray(json?.people)) return null
  return {people: peopleFromJson(json), topics: cleanTopics(json.topics)}
}

/**
 * `current` with `imported` merged in, without losing anything (mergePeople; a topic followed on either side
 * stays): {added, changed, topicsAdded, lists}.
 */
export function mergeLists(current, imported) {
  const {added, changed, people} = mergePeople(current.people, imported.people)
  const topics = cleanTopics([...current.topics, ...imported.topics])
  return {
    added,
    changed,
    topicsAdded: topics.length - cleanTopics(current.topics).length,
    lists: {people, topics},
  }
}
