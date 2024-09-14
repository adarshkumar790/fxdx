const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const fastPriceFeed = await contractAt("FastPriceFeed", addresses.fastPriceFeed)
  const priceFeedGov = await fastPriceFeed.gov()
  const priceFeedTimelock = await contractAt("PriceFeedTimelock", priceFeedGov)

  await sendTxn(
    priceFeedTimelock.setPriceDuration(addresses.fastPriceFeed, 2 * 60),
    `priceFeedTimelock.setPriceDuration(fastPriceFeed, ${2 * 60})`
  )

  await sendTxn(
    priceFeedTimelock.setMaxPriceUpdateDelay(addresses.fastPriceFeed, 13 * 60 * 60),
    `priceFeedTimelock.setMaxPriceUpdateDelay(fastPriceFeed, ${13 * 60 * 60})`
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
