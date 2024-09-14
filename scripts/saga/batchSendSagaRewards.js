const { getOptimismGoerliValues, getOptimismValues, sendSagaRewards } = require("./sagaRewards")

const shouldSendTxn = false

const network = (process.env.HARDHAT_NETWORK || 'mainnet');

async function getValues() {
  if (network === "optimismGoerli") {
    return getOptimismGoerliValues()
  }

  if (network === "optimism") {
    return getOptimismValues()
  }
}

async function main() {
  const values = await getValues()
  await sendSagaRewards({ shouldSendTxn, values })
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
