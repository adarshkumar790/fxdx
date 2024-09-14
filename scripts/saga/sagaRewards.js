const path = require("path")

const { contractAt, sendTxn, processBatch } = require("../shared/helpers")
const { bigNumberify } = require("../../test/shared/utilities");

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

const { AddressZero } = ethers.constants

async function getOptimismGoerliValues() {
  let optimismGoerliFile
  if (process.env.OPTIMISM_GOERLI_FILE) {
    optimismGoerliFile = path.join(process.env.PWD, process.env.OPTIMISM_GOERLI_FILE)
  } else {
    optimismGoerliFile = path.join(__dirname, "../../saga-distribution-data-optimismGoerli.json")
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
    optimismFile = path.join(__dirname, "../../saga-distribution-data-optimism.json")
  }
  console.log("Optimism file: %s", optimismFile)
  const optimismData = require(optimismFile)

  return { data: optimismData }
}

async function sendSagaRewards({ shouldSendTxn, values }) {
  const batchSender = await contractAt("BatchSender", addresses.batchSender)
  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)
  const { data } = values

  const usersData = data.users

  console.log("rewarded users length:", usersData.length)

  const sagaRewardsTypeId = 4

  const esFxdxAccounts = []
  const esFxdxAmounts = []

  for (let i = 0; i < usersData.length; i++) {
    const { account, eligibleRewards } = usersData[i]
    if (account === AddressZero) { continue }

    esFxdxAccounts.push(account)
    esFxdxAmounts.push(eligibleRewards)
  }

  usersData.sort((a, b) => {
    if (bigNumberify(a.eligibleRewards).gt(b.eligibleRewards)) {
      return -1;
    }
    if (bigNumberify(a.eligibleRewards).lt(b.eligibleRewards)) {
      return 1;
    }

    return 0;
  })

  console.log("user with top eligible rewards", usersData[0].account, usersData[0].eligibleRewards)

  console.log(`total rewards (esFXDX)`, ethers.utils.formatUnits(data.totalRewards, 18))
  console.log(`total distributed rewards (esFXDX)`, ethers.utils.formatUnits(data.totalDistributedRewards, 18))
  console.log(`total eligible rewards (esFXDX)`, ethers.utils.formatUnits(data.totalEligibleRewards, 18))

  const totalEligibleRewards = data.totalEligibleRewards

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

    await sendTxn(esFxdx.approve(batchSender.address, totalEligibleRewards), "esFxdx.approve")

    await processBatch([esFxdxAccounts, esFxdxAmounts], batchSize, async (currentBatch) => {
      printBatch(currentBatch)

      const accounts = currentBatch.map((item) => item[0])
      const amounts = currentBatch.map((item) => item[1])

      await sendTxn(batchSender.sendAndEmit(esFxdx.address, accounts, amounts, sagaRewardsTypeId), "batchSender.sendAndEmit(esFxdx, esFxdx saga rewards)")
    })
  }
}

module.exports = {
  getOptimismValues,
  getOptimismGoerliValues,
  sendSagaRewards
}
