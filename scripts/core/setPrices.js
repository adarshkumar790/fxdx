const { deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals, bigNumberify } = require("../../test/shared/utilities")
const { toUsd } = require("../../test/shared/units")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const secondaryPriceFeed = await contractAt("FastPriceFeed", addresses.fastPriceFeed)
  const vaultPriceFeed = await contractAt("VaultPriceFeed", addresses.vaultPriceFeed)

  // await sendTxn(vaultPriceFeed.setIsAmmEnabled(false), "vaultPriceFeed.setIsAmmEnabled")
  console.log("vaultPriceFeed.isSecondaryPriceEnabled", await vaultPriceFeed.isSecondaryPriceEnabled())

  await sendTxn(secondaryPriceFeed.setPrices(
    [tokens.btc.address, tokens.eth.address, tokens.usdc.address, tokens.usdt.address],
    [expandDecimals(25873, 30), expandDecimals(1739, 30), expandDecimals(1, 30), expandDecimals(1, 30)],
    // [tokens.eth.address, tokens.cbeth.address, tokens.usdbc.address, tokens.dai.address],
    // [expandDecimals(1848, 30), expandDecimals(1937, 30), expandDecimals(1, 30), expandDecimals(1, 30)],
    // [tokens.wld.address, tokens.op.address],
    // [expandDecimals(213, 28), expandDecimals(168, 28)],
    Math.floor(Date.now() / 1000),
  ), "secondaryPriceFeed.setPrices")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
