const { sendTxn, contractAt } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  // replace this signerAddress value to the account address of the signer
  const signerAddress = addresses.signer2
  const isSigner = false
  const tokenManager = await contractAt("TokenManager", addresses.tokenManager)

  // signalSetSigner
  await sendTxn(
    tokenManager.signalSetSigner(signerAddress, isSigner),
    `tokenManager.signalSetSigner(${signerAddress}, ${isSigner})`
  )

  console.log('----> tokenManager SetSigner nonce:', (await tokenManager.actionsNonce()).toString())

  // // assign nonces: replace this value with the printed one in the above statement
  // const tokenManagerNonce = "10"

  // // signSetSigner
  // await sendTxn(
  //   tokenManager.signSetSigner(signerAddress, isSigner, tokenManagerNonce),
  //   `tokenManager.signSetSigner(${signerAddress}, ${isSigner}, ${tokenManagerNonce})`
  // )

  // // setSigner
  // await sendTxn(
  //   tokenManager.setSigner(signerAddress, isSigner, tokenManagerNonce),
  //   `tokenManager.setSigner(${signerAddress}, ${isSigner}, ${tokenManagerNonce})`
  // )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
