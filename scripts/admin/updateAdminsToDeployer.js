const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network]

async function main() {
  const newAdmin = addresses.deployer;

  const router = await contractAt("Router", addresses.router)
  await sendTxn(router.setGov(newAdmin), `router.setGov(${newAdmin})`)

  const swapRouter = await contractAt("SwapRouter", addresses.swapRouter)
  await sendTxn(swapRouter.setAdmin(newAdmin), `swapRouter.setAdmin(${newAdmin})`)
  await sendTxn(swapRouter.setGov(newAdmin), `swapRouter.setGov(${newAdmin})`)

  const positionRouter = await contractAt("PositionRouter", addresses.positionRouter)
  await sendTxn(positionRouter.setAdmin(newAdmin), `positionRouter.setAdmin(${newAdmin})`)
  await sendTxn(positionRouter.setGov(newAdmin), `positionRouter.setGov(${newAdmin})`)

  const referralStorage = await contractAt("ReferralStorage", addresses.referralStorage)
  await sendTxn(referralStorage.setGov(newAdmin), `referralStorage.setGov(${newAdmin})`)

  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)
  await sendTxn(esFxdx.setGov(newAdmin), `esFxdx.setGov(${newAdmin})`)

  const rewardRouterV2 = await contractAt("RewardRouterV2", addresses.rewardRouterV2)
  await sendTxn(rewardRouterV2.setGov(newAdmin), `rewardRouterV2.setGov(${newAdmin})`)

  const fastPriceEvents = await contractAt("FastPriceEvents", addresses.fastPriceEvents)
  await sendTxn(fastPriceEvents.setGov(newAdmin), `fastPriceEvents.setGov(${newAdmin})`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
