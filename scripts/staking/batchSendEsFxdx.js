const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { DISTRIBUTION_LIST } = require("../../data/DistributionList1")

async function main() {
  const wallet = { address: "0x5F799f365Fa8A2B60ac0429C48B153cA5a6f0Cf8" }
  const esFxdx = await contractAt("EsFXDX", "0x6d9A610b8D6b7F021bb7b92431093288d49b413E")
  const batchSender = await contractAt("BatchSender", "0x5a84E18c3610f08f27eE39920011043BeA9E2a35")
  const distributionList = DISTRIBUTION_LIST

  await sendTxn(esFxdx.approve(batchSender.address, expandDecimals(100 * 1000, 18)), "esFxdx.approve")
  console.log("processing list", distributionList.length)

  const batchSize = 15
  
  let accounts = []
  let amounts = []

  for (let i = 0; i < distributionList.length; i++) {
    const [account, amount] = distributionList[i]
    accounts.push(account)
    amounts.push(ethers.utils.parseUnits(amount, 18))

    if (accounts.length === batchSize) {
      console.log("accounts", accounts)
      console.log("amounts", amounts.map(amount => amount.toString()))
      console.log("sending batch", i, accounts.length, amounts.length)
      await sendTxn(batchSender.send(esFxdx.address,  accounts, amounts), "batchSender.send")

      accounts = []
      amounts = []
    }
  }

  if (accounts.length > 0) {
    console.log("sending final batch", distributionList.length, accounts.length, amounts.length)
    await sendTxn(batchSender.send(esFxdx.address,  accounts, amounts), "batchSender.send")
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
