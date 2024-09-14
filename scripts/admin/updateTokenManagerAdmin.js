const { deployContract, sendTxn, contractAt } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  // replace this newAdmin value to the account address of new admin
  const newAdmin = addresses.newAdmin
  const tokenManager = await contractAt("TokenManager", addresses.tokenManager)

  // signalSetAdmin
  await sendTxn(
    tokenManager.signalSetAdmin(addresses.tokenManager, newAdmin),
    `tokenManager.signalSetAdmin(tokenManager, ${newAdmin})`
  )

  console.log('----> tokenManager SetAdmin nonce:', (await tokenManager.actionsNonce()).toString())

  // // assign nonces: replace this value with the printed one in the above statement
  // const tokenManagerNonce = "3"

  // // signSetAdmin
  // await sendTxn(
  //   tokenManager.signSetAdmin(addresses.tokenManager, newAdmin, tokenManagerNonce),
  //   `tokenManager.signSetAdmin(tokenManager, ${newAdmin}, ${tokenManagerNonce})`
  // )

  // // setAdmin
  // await sendTxn(
  //   tokenManager.setAdmin(addresses.tokenManager, newAdmin, tokenManagerNonce),
  //   `tokenManager.setAdmin(tokenManager, ${newAdmin}, ${tokenManagerNonce})`
  // )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
