import {mergePeople, peopleFromJson, peopleToJson, sortedPeople} from './people'
import {cleanTopics} from './topics'
import {MAX_HIDDEN_WORDS, cleanHiddenWord, txHashOf} from './hiding'

// What Social keeps on this computer for the user alone: the names given to people, the people followed, muted and
// blocked, the topics followed and blocked, the hidden words and the posts hidden. Exported and imported as one file
// (Social's ⓘ), to keep it or move it to another computer or to the phone app: the phone's format (SocialLists.kt).
// Version 1 files (the Contacts export: names and people only), version 2 (no blocks nor hidden things) and version
// 3 (nobody muted) still import. The "Pictures in posts" setting is not in the file: it is this computer's.

const LISTS_VERSION = 4

/** The people followed, in name order. */
export const followedPeople = (people) =>
  sortedPeople(people).filter(({following}) => following)

/** Each valid entry of a list once, sorted: `clean` gives it, or null. */
const cleanList = (list, clean) =>
  [
    ...new Set((Array.isArray(list) ? list : []).map(clean).filter(Boolean)),
  ].sort()

/** The hidden words as kept: valid ones only, sorted, each once. */
export const cleanHiddenWords = (list) => cleanList(list, cleanHiddenWord)

/** The posts hidden as kept: transaction hashes, lowercase, sorted, each once. */
export const cleanHiddenPosts = (list) => cleanList(list, txHashOf)

/**
 * The export file: the people (peopleToJson), the topics followed, the hidden words, the posts hidden and the topics
 * blocked, sorted.
 */
export const socialListsToJson = ({
  people,
  topics,
  words = [],
  hiddenPosts = [],
  blockedTopics = [],
}) => ({
  ...peopleToJson(people),
  version: LISTS_VERSION,
  topics: cleanTopics(topics),
  hiddenWords: cleanHiddenWords(words),
  hiddenPosts: cleanHiddenPosts(hiddenPosts),
  blockedTopics: cleanTopics(blockedTopics),
})

/**
 * A file's lists {people, topics, words, hiddenPosts, blockedTopics}; entries that are not valid are left out.
 * Null when it is not an export.
 */
export function socialListsFromJson(json) {
  if (!Array.isArray(json?.people)) return null
  return {
    people: peopleFromJson(json),
    topics: cleanTopics(json.topics),
    words: cleanHiddenWords(json.hiddenWords),
    hiddenPosts: cleanHiddenPosts(json.hiddenPosts),
    blockedTopics: cleanTopics(json.blockedTopics),
  }
}

/**
 * `current` with `imported` merged in, without losing anything (mergePeople; a topic followed, a word hidden, a post
 * hidden or a topic blocked on either side stays, up to MAX_HIDDEN_WORDS words): {added, changed, topicsAdded,
 * wordsAdded, othersAdded (posts hidden and topics blocked), lists}.
 */
export function mergeLists(current, imported) {
  const {added, changed, people} = mergePeople(current.people, imported.people)
  const merged = (key, clean) =>
    clean([...(current[key] || []), ...(imported[key] || [])])
  const topics = merged('topics', cleanTopics)
  const words = cleanHiddenWords(current.words)
  const newWords = cleanHiddenWords(imported.words).filter(
    (word) => !words.includes(word)
  )
  const allWords = cleanHiddenWords([
    ...words,
    ...newWords.slice(0, Math.max(0, MAX_HIDDEN_WORDS - words.length)),
  ])
  const hiddenPosts = merged('hiddenPosts', cleanHiddenPosts)
  const blockedTopics = merged('blockedTopics', cleanTopics)
  const count = (key, clean) => clean(current[key]).length
  return {
    added,
    changed,
    topicsAdded: topics.length - count('topics', cleanTopics),
    wordsAdded: allWords.length - words.length,
    othersAdded:
      hiddenPosts.length -
      count('hiddenPosts', cleanHiddenPosts) +
      blockedTopics.length -
      count('blockedTopics', cleanTopics),
    lists: {people, topics, words: allWords, hiddenPosts, blockedTopics},
  }
}
