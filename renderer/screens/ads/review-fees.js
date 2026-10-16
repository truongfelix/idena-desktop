/* global BigInt */
import {TxType} from '../../shared/types'
import {buildContractDeploymentArgs} from '../oracles/utils'
import {ContractRpcMode} from '../oracles/types'
import {fromWei, storeToIpfsPayload, toHex, toWei} from '../social/posting'
import {AD_MEDIA_SIZE, buildAdReviewVoting, compressAdImage} from './utils'

/**
 * The ad's pictures as its review stores them: the thumbnail 80x80 and the picture AD_MEDIA_SIZE, each in its own
 * type (with the thumbnail's, a PNG thumbnail made the photo a PNG, several times larger and dearer to store).
 */
export async function compressAdPictures({thumb, media}) {
  const compress = async (file, size) =>
    new Uint8Array(
      await compressAdImage(await file.arrayBuffer(), {
        width: size,
        height: size,
        type: file.type,
      })
    )
  return {
    thumb: await compress(thumb, 80),
    media: await compress(media, AD_MEDIA_SIZE),
  }
}

/** The ad as its review stores it on IPFS (hex, `encodeAd` of the profile encoder), with the voting it asks for. */
export const reviewAdHex = (ad, encodeAd) =>
  encodeAd({
    ...ad,
    version: 0,
    votingParams: buildAdReviewVoting({title: ad.title}),
  })

const sum = (...amounts) =>
  amounts.reduce((a, b) => a + toWei(b ?? '0'), BigInt(0))

/**
 * The network fees of reviewing the ad `adHex` from `from`, from the node's estimates: storing the ad on IPFS and
 * deploying its review contract with `stake`; in iDNA as text, rounded up to 6 places. Starting the voting costs a
 * small fee more, only known once the contract exists. `call(method, params)` asks the node.
 */
export async function estimateReviewFees(call, {from, adHex, title, stake}) {
  const cid = await call('ipfs_cid', [`0x${adHex.replace(/^0x/, '')}`])
  const size = adHex.replace(/^0x/, '').length / 2
  const [store, deploy] = await Promise.all([
    call('bcn_estimateTx', [
      {
        type: TxType.StoreToIpfsTx,
        from,
        payload: toHex(storeToIpfsPayload(cid, size)),
      },
    ]),
    call('contract_estimateDeploy', [
      buildContractDeploymentArgs(
        {...buildAdReviewVoting({title}), adCid: cid},
        {from, stake},
        ContractRpcMode.Estimate
      ),
    ]),
  ])
  if (deploy?.error) throw new Error(deploy.error)
  const storeFee = sum(store?.txFee)
  const deployFee = sum(deploy?.txFee, deploy?.gasCost)
  return {
    storeFee: fromWei(storeFee, 6, true),
    deployFee: fromWei(deployFee, 6, true),
    total: fromWei(storeFee + deployFee, 6, true),
  }
}
