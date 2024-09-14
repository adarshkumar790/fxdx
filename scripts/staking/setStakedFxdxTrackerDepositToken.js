const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const token = addresses.fxdxV2
  const isDepositToken = true

  const stakedFxdxTracker = await contractAt("RewardTracker", addresses.stakedFxdxTracker)

  await sendTxn(
    stakedFxdxTracker.setDepositToken(token, isDepositToken),
    `stakedFxdxTracker.setDepositToken(${token}, ${isDepositToken})`
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
