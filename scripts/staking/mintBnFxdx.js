const { expandDecimals } = require("../../test/shared/utilities");
const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const bnFxdx = await contractAt("MintableBaseToken", addresses.bnFxdx)

  // set admin account to bnFxdx minter
  await sendTxn(bnFxdx.setMinter(addresses.admin, true), "bnFxdx.setMinter")

  // mint bnFxdx for distributor
  await sendTxn(bnFxdx.mint(
    addresses.bonusFxdxDistributor,
    expandDecimals(250 * 1000, 18)
  ), "bnFxdx.mint(bonusFxdxDistributor)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
