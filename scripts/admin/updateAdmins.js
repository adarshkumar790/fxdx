const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network]

async function main() {
  const newAdmin = addresses.newAdmin;

  const usdf = await contractAt("USDF", addresses.usdf)
  await sendTxn(usdf.setGov(newAdmin), `usdf.setGov(${newAdmin})`)

  const router = await contractAt("Router", addresses.router)
  await sendTxn(router.setGov(newAdmin), `router.setGov(${newAdmin})`)

  const flp = await contractAt("FLP", addresses.flp)
  await sendTxn(flp.setGov(newAdmin), `flp.setGov(${newAdmin})`)

  const flpManager = await contractAt("FlpManager", addresses.flpManager)
  await sendTxn(flpManager.setGov(newAdmin), `flpManager.setGov(${newAdmin})`)

  const vaultErrorController = await contractAt("VaultErrorController", addresses.vaultErrorController)
  await sendTxn(vaultErrorController.setGov(newAdmin), `vaultErrorController.setGov(${newAdmin})`)

  const vaultUtils = await contractAt("VaultUtils", addresses.vaultUtils)
  await sendTxn(vaultUtils.setGov(newAdmin), `vaultUtils.setGov(${newAdmin})`)

  const orderBook = await contractAt("OrderBook", addresses.orderBook)
  await sendTxn(orderBook.setGov(newAdmin), `orderBook.setGov(${newAdmin})`)

  const swapRouter = await contractAt("SwapRouter", addresses.swapRouter)
  await sendTxn(swapRouter.setAdmin(newAdmin), `swapRouter.setAdmin(${newAdmin})`)
  await sendTxn(swapRouter.setGov(newAdmin), `swapRouter.setGov(${newAdmin})`)

  const positionManager = await contractAt("PositionManager", addresses.positionManager)
  await sendTxn(positionManager.setAdmin(newAdmin), `positionManager.setAdmin(${newAdmin})`)
  await sendTxn(positionManager.setGov(newAdmin), `positionManager.setGov(${newAdmin})`)

  const positionRouter = await contractAt("PositionRouter", addresses.positionRouter)
  await sendTxn(positionRouter.setAdmin(newAdmin), `positionRouter.setAdmin(${newAdmin})`)
  await sendTxn(positionRouter.setGov(newAdmin), `positionRouter.setGov(${newAdmin})`)

  const fxdx = await contractAt("FXDX", addresses.fxdx)
  await sendTxn(fxdx.setGov(newAdmin), `fxdx.setGov(${newAdmin})`)

  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)
  await sendTxn(esFxdx.setGov(newAdmin), `esFxdx.setGov(${newAdmin})`)

  const liquidityRouter = await contractAt("LiquidityRouter", addresses.liquidityRouter)
  await sendTxn(liquidityRouter.setAdmin(newAdmin), `liquidityRouter.setAdmin(${newAdmin})`)
  await sendTxn(liquidityRouter.setGov(newAdmin), `liquidityRouter.setGov(${newAdmin})`)

  const batchSender = await contractAt("BatchSender", addresses.batchSender)
  await sendTxn(batchSender.setGov(newAdmin), `batchSender.setGov(${newAdmin})`)

  const reader = await contractAt("Reader", addresses.reader)
  await sendTxn(reader.setGov(newAdmin), `reader.setGov(${newAdmin})`)

  const bnFxdx = await contractAt("MintableBaseToken", addresses.bnFxdx)
  await sendTxn(bnFxdx.setGov(newAdmin), `bnFxdx.setGov(${newAdmin})`)

  const stakedFxdxTracker = await contractAt("RewardTracker", addresses.stakedFxdxTracker)
  await sendTxn(stakedFxdxTracker.setGov(newAdmin), `stakedFxdxTracker.setGov(${newAdmin})`)

  const stakedFxdxDistributor = await contractAt("RewardDistributor", addresses.stakedFxdxDistributor)
  await sendTxn(stakedFxdxDistributor.setAdmin(newAdmin), `stakedFxdxDistributor.setAdmin(${newAdmin})`)
  await sendTxn(stakedFxdxDistributor.setGov(newAdmin), `stakedFxdxDistributor.setGov(${newAdmin})`)

  const bonusFxdxTracker = await contractAt("RewardTracker", addresses.bonusFxdxTracker)
  await sendTxn(bonusFxdxTracker.setGov(newAdmin), `bonusFxdxTracker.setGov(${newAdmin})`)

  const bonusFxdxDistributor = await contractAt("BonusDistributor", addresses.bonusFxdxDistributor)
  await sendTxn(bonusFxdxDistributor.setAdmin(newAdmin), `bonusFxdxDistributor.setAdmin(${newAdmin})`)
  await sendTxn(bonusFxdxDistributor.setGov(newAdmin), `bonusFxdxDistributor.setGov(${newAdmin})`)

  const feeFxdxTracker = await contractAt("RewardTracker", addresses.feeFxdxTracker)
  await sendTxn(feeFxdxTracker.setGov(newAdmin), `feeFxdxTracker.setGov(${newAdmin})`)

  const feeFxdxDistributor = await contractAt("RewardDistributor", addresses.feeFxdxDistributor)
  await sendTxn(feeFxdxDistributor.setAdmin(newAdmin), `feeFxdxDistributor.setAdmin(${newAdmin})`)
  await sendTxn(feeFxdxDistributor.setGov(newAdmin), `feeFxdxDistributor.setGov(${newAdmin})`)

  const feeFlpTracker = await contractAt("RewardTracker", addresses.feeFlpTracker)
  await sendTxn(feeFlpTracker.setGov(newAdmin), `feeFlpTracker.setGov(${newAdmin})`)

  const feeFlpDistributor = await contractAt("RewardDistributor", addresses.feeFlpDistributor)
  await sendTxn(feeFlpDistributor.setAdmin(newAdmin), `feeFlpDistributor.setAdmin(${newAdmin})`)
  await sendTxn(feeFlpDistributor.setGov(newAdmin), `feeFlpDistributor.setGov(${newAdmin})`)

  const stakedFlpTracker = await contractAt("RewardTracker", addresses.stakedFlpTracker)
  await sendTxn(stakedFlpTracker.setGov(newAdmin), `stakedFlpTracker.setGov(${newAdmin})`)

  const stakedFlpDistributor = await contractAt("RewardDistributor", addresses.stakedFlpDistributor)
  await sendTxn(stakedFlpDistributor.setAdmin(newAdmin), `stakedFlpDistributor.setAdmin(${newAdmin})`)
  await sendTxn(stakedFlpDistributor.setGov(newAdmin), `stakedFlpDistributor.setGov(${newAdmin})`)

  const fxdxVester = await contractAt("Vester", addresses.fxdxVester)
  await sendTxn(fxdxVester.setGov(newAdmin), `fxdxVester.setGov(${newAdmin})`)

  const flpVester = await contractAt("Vester", addresses.flpVester)
  await sendTxn(flpVester.setGov(newAdmin), `flpVester.setGov(${newAdmin})`)

  const rewardRouterV2 = await contractAt("RewardRouterV2", addresses.rewardRouterV2)
  await sendTxn(rewardRouterV2.setGov(newAdmin), `rewardRouterV2.setGov(${newAdmin})`)

  const stakeManager = await contractAt("StakeManager", addresses.stakeManager)
  await sendTxn(stakeManager.setGov(newAdmin), `stakeManager.setGov(${newAdmin})`)

  const fastPriceEvents = await contractAt("FastPriceEvents", addresses.fastPriceEvents)
  await sendTxn(fastPriceEvents.setGov(newAdmin), `fastPriceEvents.setGov(${newAdmin})`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
