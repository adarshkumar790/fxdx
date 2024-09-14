const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];
const tokens = require('./tokens')[network];

async function main() {
  // const { btc, eth, feth, wld, op, usdc, usdt } = tokens
  // const tokenArr = [btc, eth, feth, wld, op, usdc, usdt]
  // const { btc, eth, wld, op, usdc, usdt } = tokens
  // const tokenArr = [btc, eth, wld, op, usdc, usdt]
  // const { eth, cbeth, usdbc, dai } = tokens
  // const tokenArr = [eth, cbeth, usdbc, dai]
  const { usdc } = tokens
  const tokenArr = [usdc]

  const vault = await contractAt("Vault", addresses.vault);
  const timelock = await contractAt("Timelock", await vault.gov())

  for (const token of tokenArr) {
    await sendTxn(timelock.setTokenFeeFactorsV2(
      addresses.feeUtilsV2,
      token.address,
      token.taxBasisPoints,
      token.mintBurnFeeBasisPoints,
      token.swapFeeBasisPoints,
      token.rolloverRateFactor,
      token.relativePnlList,
      token.positionFeeBpsList,
      token.profitFeeBpsList
    ), `feeUtilsV2.setTokenFeeFactors - (${token.name})`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
