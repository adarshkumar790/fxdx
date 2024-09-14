const path = require("path")

const { contractAt, sendTxn, processBatch } = require("../shared/helpers")
const { bigNumberify } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function getOptimismGoerliValues() {
  let optimismGoerliFile
  if (process.env.OPTIMISM_GOERLI_FILE) {
    optimismGoerliFile = path.join(process.env.PWD, process.env.OPTIMISM_GOERLI_FILE)
  } else {
    optimismGoerliFile = path.join(__dirname, "../../booster-session1-rewards-data-optimismGoerli.json")
  }
  console.log("Optimism Goerli file: %s", optimismGoerliFile)
  const optimismGoerliData = require(optimismGoerliFile)

  return { data: optimismGoerliData }
}

async function getOptimismValues() {
  let optimismFile
  if (process.env.OPTIMISM_FILE) {
    optimismFile = path.join(process.env.PWD, process.env.OPTIMISM_FILE)
  } else {
    optimismFile = path.join(__dirname, "../../booster-session1-rewards-data-optimism.json")
  }
  console.log("Optimism file: %s", optimismFile)
  const optimismData = require(optimismFile)

  return { data: optimismData }
}

async function sendLiquidityRewards({ shouldSendTxn, values }) {
  const batchSender = await contractAt("BatchSender", addresses.batchSender)
  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)
  const { data } = values

  const usersData = data.users

  console.log("qualified users count:", usersData.length)

  const liquidityRewardsTypeId = 6

  let totalEsFxdxAmount = bigNumberify(0)
  const esFxdxAccounts = []
  const esFxdxAmounts = []

  for (let i = 0; i < usersData.length; i++) {
    const { account, rewards } = usersData[i]

    esFxdxAccounts.push(account)
    esFxdxAmounts.push(rewards)
    totalEsFxdxAmount = totalEsFxdxAmount.add(rewards)
  }

  usersData.sort((a, b) => {
    if (bigNumberify(a.flpBalance).gt(b.flpBalance)) {
      return -1;
    }
    if (bigNumberify(a.flpBalance).lt(b.flpBalance)) {
      return 1;
    }

    return 0;
  })

  console.log("top LP holder", usersData[0].account, usersData[0].flpBalance)
  console.log(`total esFxdx`, ethers.utils.formatUnits(totalEsFxdxAmount, 18))

  const batchSize = 150

  if (shouldSendTxn) {
    const printBatch = (currentBatch) => {
      for (let i = 0; i < currentBatch.length; i++) {
        const item = currentBatch[i]
        const account = item[0]
        const amount = item[1]
        console.log(account, ethers.utils.formatUnits(amount, 18))
      }
    }

    await sendTxn(esFxdx.approve(batchSender.address, totalEsFxdxAmount), "esFxdx.approve")

    await processBatch([esFxdxAccounts, esFxdxAmounts], batchSize, async (currentBatch) => {
      printBatch(currentBatch)

      const accounts = currentBatch.map((item) => item[0])
      const amounts = currentBatch.map((item) => item[1])

      await sendTxn(batchSender.sendAndEmit(esFxdx.address, accounts, amounts, liquidityRewardsTypeId), "batchSender.sendAndEmit(esFxdx, esFxdx liquidity booster session1 rewards)")
    })
  }
}

module.exports = {
  getOptimismValues,
  getOptimismGoerliValues,
  sendLiquidityRewards
}
