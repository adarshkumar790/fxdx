const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const minter = addresses.fxdxConverter
  const isActive = true

  const fxdx = await contractAt("FXDX", addresses.fxdx)

  await sendTxn(fxdx.setMinter(minter, isActive), `fxdx.setMinter(${minter}, ${isActive})`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
