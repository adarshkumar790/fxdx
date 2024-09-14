const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const account = addresses.admin
  const liquidityRouter = await contractAt("LiquidityRouter", addresses.liquidityRouterOld)

  await sendTxn(liquidityRouter.setRequestKeeper(addresses.admin, true), "liquidityRouter.setRequestKeeper(admin, true)")

  let key = await liquidityRouter.addLiquidityRequestKeys(168)
  await sendTxn(liquidityRouter.cancelAddLiquidity(key, account), "liquidityRouter.cancelAddLiquidity")

  key = await liquidityRouter.addLiquidityRequestKeys(169)
  await sendTxn(liquidityRouter.cancelAddLiquidity(key, account), "liquidityRouter.cancelAddLiquidity")

  await sendTxn(liquidityRouter.setRequestKeysStartValues(170, 126), "liquidityRouter.setRequestKeysStartValues")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
