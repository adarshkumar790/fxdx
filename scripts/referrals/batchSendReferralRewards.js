const path = require("path")

const { expandDecimals } = require("../../test/shared/utilities")
const { getOptimismGoerliValues, getOptimismValues, getBaseValues, sendReferralRewards } = require("./referralRewards")

const fxdxPrice = expandDecimals("5", 29)

const feeRewardTokenPrice = expandDecimals(1, 30)

const shouldSendTxn = true

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];
const feeRewardToken = network === 'base' ? tokens.usdbc : tokens.usdc

async function getValues() {
  if (network === "optimismGoerli") {
    return getOptimismGoerliValues()
  } else if (network === "optimism") {
    return getOptimismValues()
  } else if (network === "base") {
    return getBaseValues()
  }
}

async function main() {
  const values = await getValues()
  await sendReferralRewards({ shouldSendTxn, feeRewardToken, feeRewardTokenPrice, fxdxPrice, values })
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
