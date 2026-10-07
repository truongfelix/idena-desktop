// idena.social's contracts. The current one takes the posts since its deployment; each older one, the posts of the
// blocks before the next one was deployed, as idena.social-ui reads them (`breakingChanges` in
// src/logic/asyncUtils.ts). Older posts are read only: their ids get the prefix the web app gives them, so that
// they never meet the current contract's ids.

import {SOCIAL_CONTRACT, SOCIAL_FIRST_BLOCK, isTestContract} from './contract'

/**
 * A contract version: its name, address, the blocks from..to-1 where its calls count (`to` null for the current
 * one), the prefix of its post ids, and the format of its calls: 'v1' (v1 and v5: sendTip takes the post id as
 * plain text and tips what is sent; a reply's target may be written as hex), 'v9' (v9 and v10: sendTip
 * {postId} tips what is sent), 'v12' (v11 and v12: sendTip {postId, tipAmount} in whole iDNA).
 */
export const CURRENT_VERSION = {
  name: 'v12',
  address: SOCIAL_CONTRACT,
  from: SOCIAL_FIRST_BLOCK,
  to: null,
  prefix: '',
  format: 'v12',
}

const OLDER_VERSIONS = [
  {
    name: 'v11',
    address: '0x18b0a55eb99AcA113f50eEBbdeAf6f96E789277f',
    from: 10727655,
    to: SOCIAL_FIRST_BLOCK,
    prefix: 'preV12:',
    format: 'v12',
  },
  {
    name: 'v10',
    address: '0xa1c5c1A8c6a1Af596078A5c9653F24c216fE1cb2',
    from: 10627018,
    to: 10727655,
    prefix: 'preV11:',
    format: 'v9',
  },
  {
    name: 'v9',
    address: '0xc0324f3Cf8158D6E27dc0A07c221636056174718',
    from: 10604687,
    to: 10627018,
    prefix: 'preV10:',
    format: 'v9',
  },
  {
    name: 'v5',
    address: '0xC5B35B4Dc4359Cc050D502564E789A374f634fA9',
    from: 10219188,
    to: 10604687,
    prefix: 'preV9:',
    format: 'v1',
  },
  {
    name: 'v1',
    address: '0x8d318630eB62A032d2f8073d74f05cbF7c6C87Ae',
    from: 10135621,
    to: 10219188,
    prefix: 'preV5:',
    format: 'v1',
  },
]

/** The versions, newest first. A test network has only its own contract. */
export const SOCIAL_VERSIONS = isTestContract
  ? [CURRENT_VERSION]
  : [CURRENT_VERSION, ...OLDER_VERSIONS]

/** The first block of idena.social's history. */
export const HISTORY_START = SOCIAL_VERSIONS[SOCIAL_VERSIONS.length - 1].from

/** The version whose calls count at `height`, or null before the history. */
export const versionAt = (height) =>
  SOCIAL_VERSIONS.find((version) => height >= version.from) || null

/** The version named `name`; a call or post without one is the current version's. */
export const versionNamed = (name) =>
  SOCIAL_VERSIONS.find((version) => version.name === name) || CURRENT_VERSION
