const { expandDecimals } = require("../../test/shared/utilities");
const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const mintReceiver = addresses.flpVester
  const mintAmount = expandDecimals(1000000, 18)
  const fxdx = await contractAt("FXDX", addresses.fxdx)

  await sendTxn(fxdx.setMinter(
    addresses.admin,
    true
  ), "fxdx.setMinter(admin, true)")

  await sendTxn(fxdx.mint(
    mintReceiver, // liquidationFeeUsd
    mintAmount
  ), "fxdx.mint")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
