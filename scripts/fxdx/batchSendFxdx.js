const { contractAt, sendTxn, processBatch } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities");

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const batchSender = await contractAt("BatchSender", addresses.batchSender)
  const fxdx = await contractAt("Token", addresses.fxdxV2)

const fxdxAccounts = [
   "0xF341F33564571B9B4B4C408A73f08ad944ad640D",
   "0x877d582fc6073057BC45E599f7B68a942d9F38bd",
]

const fxdxAmounts = [
     expandDecimals(50, 18),
     expandDecimals(50, 18),
]
  
  const batchSize = 150

  const totalFxdx = expandDecimals(100, 18)

  const printBatch = (currentBatch) => {
    for (let i = 0; i < currentBatch.length; i++) {
      const item = currentBatch[i]
      const account = item[0]
      const amount = item[1]
      console.log(account, ethers.utils.formatUnits(amount, 18))
    }
  }

  await sendTxn(fxdx.approve(batchSender.address, totalFxdx), "esFxdx.approve")

  await processBatch([fxdxAccounts, fxdxAmounts], batchSize, async (currentBatch) => {
    printBatch(currentBatch)

    const accounts = currentBatch.map((item) => item[0])
    const amounts = currentBatch.map((item) => item[1])

    await sendTxn(batchSender.send(fxdx.address, accounts, amounts), "batchSender.send(fxdx, fxdx rewards)")
  })
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
