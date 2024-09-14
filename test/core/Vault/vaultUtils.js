const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./helpers")

describe("VaultUtils", function () {
  const provider = waffle.provider
  const [wallet, user0] = provider.getWallets()
  let vault
  let vaultUtils
  let vaultPriceFeed
  let usdf
  let router
  let bnb

  beforeEach(async () => {
    bnb = await deployContract("Token", [])

    vault = await deployContract("Vault", [])
    usdf = await deployContract("USDF", [vault.address])
    router = await deployContract("Router", [vault.address, usdf.address, bnb.address])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])

    const _ = await initVault(vault, router, usdf, vaultPriceFeed)
    vaultUtils = _.vaultUtils
  })
})
