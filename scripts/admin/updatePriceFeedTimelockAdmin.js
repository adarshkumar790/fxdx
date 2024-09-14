const { deployContract, sendTxn, contractAt } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  // replace this newAdmin value to the account address of new admin
  const newAdmin = addresses.newAdmin
  const tokenManager = await contractAt("TokenManager", addresses.tokenManager)

  // signalSetAdmin
  await sendTxn(
    tokenManager.signalSetAdmin(addresses.priceFeedTimelock, newAdmin),
    `tokenManager.signalSetAdmin(priceFeedTimelock, ${newAdmin})`
  )

  console.log('----> priceFeedTimelock SetAdmin nonce:', (await tokenManager.actionsNonce()).toString())

  // // assign nonces: replace the following value with the printed one in the above statement
  // const priceFeedTimelockNonce = "2"

  // await sendTxn(
  //   tokenManager.signSetAdmin(addresses.priceFeedTimelock, newAdmin, priceFeedTimelockNonce),
  //   `tokenManager.signSetAdmin(priceFeedTimelock, ${newAdmin}, ${priceFeedTimelockNonce})`
  // )

  // await sendTxn(
  //   tokenManager.setAdmin(addresses.priceFeedTimelock, newAdmin, priceFeedTimelockNonce),
  //   `tokenManager.setAdmin(priceFeedTimelock, ${newAdmin}, ${priceFeedTimelockNonce})`
  // )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
