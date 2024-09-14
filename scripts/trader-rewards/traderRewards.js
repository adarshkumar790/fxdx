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
    optimismGoerliFile = path.join(__dirname, "../../trader-rewards-data-optimismGoerli.json")
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
    optimismFile = path.join(__dirname, "../../trader-rewards-data-optimism.json")
  }
  console.log("Optimism file: %s", optimismFile)
  const optimismData = require(optimismFile)

  return { data: optimismData }
}

async function sendTraderRewards({ shouldSendTxn, values }) {
  const batchSender = await contractAt("BatchSender", addresses.batchSender)
  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)
  const { data } = values

  const tradersData = data.traders

  console.log("traders count:", tradersData.length)

  const traderRewardsTypeId = 5

  let totalEsFxdxAmount = bigNumberify(0)
  const esFxdxAccounts = []
  const esFxdxAmounts = []

  for (let i = 0; i < tradersData.length; i++) {
    const { account, actualEsfxdxRewards } = tradersData[i]

    esFxdxAccounts.push(account)
    esFxdxAmounts.push(actualEsfxdxRewards)
    totalEsFxdxAmount = totalEsFxdxAmount.add(actualEsfxdxRewards)
  }

  tradersData.sort((a, b) => {
    if (bigNumberify(a.tradeFees).gt(b.tradeFees)) {
      return -1;
    }
    if (bigNumberify(a.tradeFees).lt(b.tradeFees)) {
      return 1;
    }

    return 0;
  })

  console.log("top trader", tradersData[0].account, tradersData[0].tradeFees)
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

      await sendTxn(batchSender.sendAndEmit(esFxdx.address, accounts, amounts, traderRewardsTypeId), "batchSender.sendAndEmit(esFxdx, esFxdx referrer trade rewards)")
    })
  }
}

module.exports = {
  getOptimismValues,
  getOptimismGoerliValues,
  sendTraderRewards
}
