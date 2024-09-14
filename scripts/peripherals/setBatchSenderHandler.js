const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet')
const addresses = require("../core/addresses")[network]

async function main() {
  const batchSender = await contractAt("BatchSender", addresses.batchSender)

  await sendTxn(batchSender.setHandler(addresses.admin, true), "batchSender.setHandler(admin, true)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
