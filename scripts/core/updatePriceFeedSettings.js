const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  // const positionManager = await contractAt("PositionManager", addresses.positionManager)
  const positionRouter = await contractAt("PositionRouter", addresses.positionRouter)
  const swapRouter = await contractAt("SwapRouter", addresses.swapRouter)
  const liquidityRouter = await contractAt("LiquidityRouter", addresses.liquidityRouter)

  const fastPriceEvents = await contractAt("FastPriceEvents", addresses.fastPriceEvents)

  // await sendTxn(positionManager.setFastPriceFeed(addresses.fastPriceFeed), "positionManager.setFastPriceFeed")

  const isActive = false;

  await sendTxn(positionRouter.setPositionKeeper(addresses.fastPriceFeed, isActive), "positionRouter.setPositionKeeper(secondaryPriceFeed)")
  await sendTxn(swapRouter.setRequestKeeper(addresses.fastPriceFeed, isActive), "swapRouter.setRequestKeeper(secondaryPriceFeed)")
  await sendTxn(liquidityRouter.setRequestKeeper(addresses.fastPriceFeed, isActive), "liquidityRouter.setRequestKeeper(secondaryPriceFeed)")

  await sendTxn(fastPriceEvents.setIsPriceFeed(addresses.fastPriceFeed, isActive), "fastPriceEvents.setIsPriceFeed")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
