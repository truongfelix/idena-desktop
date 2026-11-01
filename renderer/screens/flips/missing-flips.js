// The keyword pair of each flip the node knows and this computer has no draft of ("Missing on client", B-180). The
// node answers each own flip's pair (dna_identity `flipsWithPair`: {hash, pair}). Without it the flip gets no words
// rather than a guess: an earlier version handed the used pairs out in order and could show another flip's words,
// so a flip looked submitted twice.

/** [{hash, pair}] for `hashes`: pair is the keyword pair ({id, words}) of that flip, or null when unknown. */
export function missingFlipPairs(hashes, flipsWithPair, keywordPairs) {
  const pairOf = new Map(
    (Array.isArray(flipsWithPair) ? flipsWithPair : []).map(({hash, pair}) => [
      hash,
      pair,
    ])
  )
  const pairs = Array.isArray(keywordPairs) ? keywordPairs : []
  return hashes.map((hash) => {
    const id = pairOf.get(hash)
    const pair =
      id === undefined ? null : pairs.find((p) => p.id === id) ?? null
    return {hash, pair}
  })
}
