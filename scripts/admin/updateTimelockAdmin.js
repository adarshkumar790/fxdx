const { deployContract, sendTxn, contractAt } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  // replace this newAdmin value to the account address of new admin
  const newAdmin = addresses.newAdmin
  const tokenManager = await contractAt("TokenManager", addresses.tokenManager)

  // signalSetAdmin
  await sendTxn(
    tokenManager.signalSetAdmin(addresses.timelock, newAdmin),
    `tokenManager.signalSetAdmin(timelock, ${newAdmin})`
  )

  console.log('----> timelock SetAdmin nonce:', (await tokenManager.actionsNonce()).toString())

  // // assign nonce: replace the following value with the printed one in the above statement
  // const timelockNonce = "1"

  // // signSetAdmin
  // await sendTxn(
  //   tokenManager.signSetAdmin(addresses.timelock, newAdmin, timelockNonce),
  //   `tokenManager.signSetAdmin(timelock, ${newAdmin}, ${timelockNonce})`
  // )

  // // setAdmin
  // await sendTxn(
  //   tokenManager.setAdmin(addresses.timelock, newAdmin, timelockNonce),
  //   `tokenManager.setAdmin(timelock, ${newAdmin}, ${timelockNonce})`
  // )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
