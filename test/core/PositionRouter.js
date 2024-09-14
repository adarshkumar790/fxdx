const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./Vault/helpers")

use(solidity)

describe("PositionRouter", function () {
  const { AddressZero, HashZero } = ethers.constants
  const provider = waffle.provider
  const [wallet, positionKeeper, minter, user0, user1, user2, user3, user4, user5, tokenManager, mintReceiver, signer0, signer1, updater0, updater1] = provider.getWallets()
  const depositFee = 50
  const minExecutionFee = 4000
  let vault
  let feeUtils
  let timelock
  let usdf
  let router
  let positionRouter
  let swapRouter
  let liquidityRouter
  let referralStorage
  let vaultPriceFeed
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let eth
  let ethPriceFeed
  let dai
  let daiPriceFeed
  let busd
  let busdPriceFeed
  let distributor0
  let yieldTracker0
  let reader
  let fastPriceFeed
  let fastPriceEvents

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])
    await bnb.connect(minter).deposit({ value: expandDecimals(100, 18) })

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    busd = await deployContract("Token", [])
    busdPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    timelock = await deployContract("Timelock", [
      wallet.address,
      5 * 24 * 60 * 60,
      AddressZero,
      tokenManager.address,
      mintReceiver.address,
      expandDecimals(1000, 18)
    ])

    usdf = await deployContract("USDF", [vault.address])
    router = await deployContract("Router", [vault.address, usdf.address, bnb.address])
    positionRouter = await deployContract("PositionRouter", [vault.address, router.address, bnb.address, depositFee, minExecutionFee])
    referralStorage = await deployContract("ReferralStorage", [])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])
    await positionRouter.setReferralStorage(referralStorage.address)
    await referralStorage.setHandler(positionRouter.address, true)

    const initVaultResult = await initVault(vault, router, usdf, vaultPriceFeed)
    feeUtils = initVaultResult.feeUtils

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdf.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdf.setYieldTrackers([yieldTracker0.address])

    reader = await deployContract("Reader", [])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await vault.setIsLeverageEnabled(false)
    await vault.setGov(timelock.address)
    await feeUtils.setGov(timelock.address)

    const rewardRouter = await deployContract("RewardRouterV2", [])
    swapRouter = await deployContract("SwapRouter", [vault.address, router.address, bnb.address, minExecutionFee])
    liquidityRouter = await deployContract("LiquidityRouter", [vault.address, router.address, rewardRouter.address, bnb.address, minExecutionFee])

    fastPriceEvents = await deployContract("FastPriceEvents", [])
    fastPriceFeed = await deployContract("FastPriceFeed", [
      5 * 60, // _priceDuration
      120 * 60, // _maxPriceUpdateDelay
      2, // _minBlockInterval
      250, // _maxDeviationBasisPoints
      fastPriceEvents.address, // _fastPriceEvents
      tokenManager.address, // _tokenManager
      positionRouter.address, // _positionRouter
      swapRouter.address,
      liquidityRouter.address
    ])
    await fastPriceFeed.initialize(2, [signer0.address, signer1.address], [updater0.address, updater1.address])
    await fastPriceEvents.setIsPriceFeed(fastPriceFeed.address, true)

    await fastPriceFeed.setVaultPriceFeed(vaultPriceFeed.address)
    await vaultPriceFeed.setSecondaryPriceFeed(fastPriceFeed.address)
  })

  it("inits", async () => {
    expect(await positionRouter.vault()).eq(vault.address)
    expect(await positionRouter.router()).eq(router.address)
    expect(await positionRouter.weth()).eq(bnb.address)
    expect(await positionRouter.depositFee()).eq(depositFee)
    expect(await positionRouter.minExecutionFee()).eq(minExecutionFee)
    expect(await positionRouter.admin()).eq(wallet.address)
    expect(await positionRouter.gov()).eq(wallet.address)
  })

  it("setAdmin", async () => {
    await expect(positionRouter.connect(user0).setAdmin(user1.address))
      .to.be.revertedWith("Governable: forbidden")

    await positionRouter.setGov(user0.address)

    expect(await positionRouter.admin()).eq(wallet.address)
    await positionRouter.connect(user0).setAdmin(user1.address)
    expect(await positionRouter.admin()).eq(user1.address)
  })

  it("setDepositFee", async () => {
    await expect(positionRouter.connect(user0).setDepositFee(25))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.depositFee()).eq(depositFee)
    await positionRouter.connect(user0).setDepositFee(25)
    expect(await positionRouter.depositFee()).eq(25)
  })

  it("setIncreasePositionBufferBps", async () => {
    await expect(positionRouter.connect(user0).setIncreasePositionBufferBps(200))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.increasePositionBufferBps()).eq(100)
    await positionRouter.connect(user0).setIncreasePositionBufferBps(200)
    expect(await positionRouter.increasePositionBufferBps()).eq(200)
  })

  it("setReferralStorage", async () => {
    await expect(positionRouter.connect(user0).setReferralStorage(user1.address))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.referralStorage()).eq(referralStorage.address)
    await positionRouter.connect(user0).setReferralStorage(user1.address)
    expect(await positionRouter.referralStorage()).eq(user1.address)
  })

  it("setMaxGlobalSizes", async () => {
    const tokens = [bnb.address, btc.address, eth.address]
    const maxGlobalLongSizes = [7, 20, 15]
    const maxGlobalShortSizes = [3, 12, 8]

    await expect(positionRouter.connect(user0).setMaxGlobalSizes(tokens, maxGlobalLongSizes, maxGlobalShortSizes))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.maxGlobalLongSizes(bnb.address)).eq(0)
    expect(await positionRouter.maxGlobalLongSizes(btc.address)).eq(0)
    expect(await positionRouter.maxGlobalLongSizes(eth.address)).eq(0)

    expect(await positionRouter.maxGlobalShortSizes(bnb.address)).eq(0)
    expect(await positionRouter.maxGlobalShortSizes(btc.address)).eq(0)
    expect(await positionRouter.maxGlobalShortSizes(eth.address)).eq(0)

    await positionRouter.connect(user0).setMaxGlobalSizes(tokens, maxGlobalLongSizes, maxGlobalShortSizes)

    expect(await positionRouter.maxGlobalLongSizes(bnb.address)).eq(7)
    expect(await positionRouter.maxGlobalLongSizes(btc.address)).eq(20)
    expect(await positionRouter.maxGlobalLongSizes(eth.address)).eq(15)

    expect(await positionRouter.maxGlobalShortSizes(bnb.address)).eq(3)
    expect(await positionRouter.maxGlobalShortSizes(btc.address)).eq(12)
    expect(await positionRouter.maxGlobalShortSizes(eth.address)).eq(8)
  })

  it("withdrawFees", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(0), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ]

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    key = await positionRouter.getRequestKey(user0.address, 2)

    expect(await positionRouter.feeReserves(bnb.address)).eq(0)
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)
    expect(await positionRouter.feeReserves(dai.address)).eq(0)
    expect(await positionRouter.feeReserves(bnb.address)).eq("9970000000000000") // 0.00997

    await expect(positionRouter.connect(user2).withdrawFees(dai.address, user3.address))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user2.address)

    expect(await dai.balanceOf(user3.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(0)

    await positionRouter.connect(user2).withdrawFees(dai.address, user3.address)

    expect(await positionRouter.feeReserves(dai.address)).eq(0)
    expect(await positionRouter.feeReserves(bnb.address)).eq("9970000000000000") // 0.00997

    expect(await dai.balanceOf(user3.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(0)

    await positionRouter.connect(user2).withdrawFees(bnb.address, user3.address)

    expect(await dai.balanceOf(user3.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq("9970000000000000")

    expect(await positionRouter.feeReserves(dai.address)).eq(0)
    expect(await positionRouter.feeReserves(bnb.address)).eq(0)
  })


  it("approve", async () => {
    await expect(positionRouter.connect(user0).approve(bnb.address, user1.address, 100))
      .to.be.revertedWith("Governable: forbidden")

    await positionRouter.setGov(user0.address)

    expect(await bnb.allowance(positionRouter.address, user1.address)).eq(0)
    await positionRouter.connect(user0).approve(bnb.address, user1.address, 100)
    expect(await bnb.allowance(positionRouter.address, user1.address)).eq(100)
  })

  it("sendValue", async () => {
    await expect(positionRouter.connect(user0).sendValue(user1.address, 0))
      .to.be.revertedWith("Governable: forbidden")

    await positionRouter.setGov(user0.address)

    await positionRouter.connect(user0).sendValue(user1.address, 0)
  })

  it("setPositionKeeper", async () => {
    await expect(positionRouter.connect(user0).setPositionKeeper(user1.address, true))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.isPositionKeeper(user1.address)).eq(false)
    await positionRouter.connect(user0).setPositionKeeper(user1.address, true)
    expect(await positionRouter.isPositionKeeper(user1.address)).eq(true)

    await positionRouter.connect(user0).setPositionKeeper(user1.address, false)
    expect(await positionRouter.isPositionKeeper(user1.address)).eq(false)
  })

  it("setMinExecutionFee", async () => {
    await expect(positionRouter.connect(user0).setMinExecutionFee("7000"))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.minExecutionFee()).eq(minExecutionFee)
    await positionRouter.connect(user0).setMinExecutionFee("7000")
    expect(await positionRouter.minExecutionFee()).eq("7000")
  })

  it("setIsLeverageEnabled", async () => {
    await expect(positionRouter.connect(user0).setIsLeverageEnabled(false))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.isLeverageEnabled()).eq(true)
    await positionRouter.connect(user0).setIsLeverageEnabled(false)
    expect(await positionRouter.isLeverageEnabled()).eq(false)
  })

  it("setDelayValues", async () => {
    await expect(positionRouter.connect(user0).setDelayValues(7, 21, 600))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.minBlockDelayKeeper()).eq(0)
    expect(await positionRouter.minTimeDelayPublic()).eq(0)
    expect(await positionRouter.maxTimeDelay()).eq(0)

    await positionRouter.connect(user0).setDelayValues(7, 21, 600)

    expect(await positionRouter.minBlockDelayKeeper()).eq(7)
    expect(await positionRouter.minTimeDelayPublic()).eq(21)
    expect(await positionRouter.maxTimeDelay()).eq(600)
  })

  it("setRequestKeysStartValues", async () => {
    await expect(positionRouter.connect(user0).setRequestKeysStartValues(5, 8))
      .to.be.revertedWith("BasePositionManager: forbidden")

    await positionRouter.setAdmin(user0.address)

    expect(await positionRouter.increasePositionRequestKeysStart()).eq(0)
    expect(await positionRouter.decreasePositionRequestKeysStart()).eq(0)

    await positionRouter.connect(user0).setRequestKeysStartValues(5, 8)

    expect(await positionRouter.increasePositionRequestKeysStart()).eq(5)
    expect(await positionRouter.decreasePositionRequestKeysStart()).eq(8)
  })

  it("increasePosition acceptablePrice long", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(290), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: mark price higher than limit")
  })

  it("increasePosition minOut long", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(2, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: insufficient amountOut")
  })

  it("validateExecution", async () => {
    await positionRouter.setDelayValues(5, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    await expect(positionRouter.connect(user1).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: forbidden")

    await expect(positionRouter.connect(user0).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: min delay not yet passed")

    await increaseTime(provider, 200)
    await mineBlock(provider)

    await expect(positionRouter.connect(user0).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: min delay not yet passed")

    await increaseTime(provider, 110)
    await mineBlock(provider)

    let request = await positionRouter.increasePositionRequests(key)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)
    expect(request.account).eq(user0.address)

    await positionRouter.connect(user0).executeIncreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)
    expect(await vault.guaranteedUsd(bnb.address)).eq("5407800000000000000000000000000000")

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    await increaseTime(provider, 510)
    await mineBlock(provider)

    key = await positionRouter.getRequestKey(user0.address, 2)
    await expect(positionRouter.connect(user0).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: request has expired")
  })

  it("validateCancellation", async () => {
    await positionRouter.setDelayValues(5, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    await expect(positionRouter.connect(user1).cancelIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: forbidden")

    await expect(positionRouter.connect(user0).cancelIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: min delay not yet passed")

    await increaseTime(provider, 200)
    await mineBlock(provider)

    await expect(positionRouter.connect(user0).cancelIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: min delay not yet passed")

    await increaseTime(provider, 110)
    await mineBlock(provider)

    let request = await positionRouter.increasePositionRequests(key)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)
    expect(request.account).eq(user0.address)

    await positionRouter.connect(user0).cancelIncreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)
    expect(await vault.guaranteedUsd(bnb.address)).eq(0)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    await increaseTime(provider, 1000)
    await mineBlock(provider)

    key = await positionRouter.getRequestKey(user0.address, 2)

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(user0.address)

    await positionRouter.connect(user0).cancelIncreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(AddressZero)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)
  })

  it("maxGlobalLongSize", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)
    await positionRouter.setMaxGlobalSizes(
      [bnb.address, btc.address],
      [toUsd(5000), toUsd(10000)],
      [0, 0]
    )

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    let key = await positionRouter.getRequestKey(user0.address, 1)
    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: max global longs exceeded")

    await positionRouter.setMaxGlobalSizes(
      [bnb.address, btc.address],
      [toUsd(6000), toUsd(10000)],
      [0, 0]
    )

    expect(await vault.guaranteedUsd(bnb.address)).eq(0)
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    expect(await vault.guaranteedUsd(bnb.address)).eq("5407800000000000000000000000000000") // 5407.8
  })

  it("decreasePosition acceptablePrice long", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)

    let decreasePositionParams = [
      [bnb.address, dai.address], // _collateralToken
      bnb.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      true, // _isLong
      user1.address,  // _receiver
      toUsd(310),  // _acceptablePrice
      0 // _minOut
    ]

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false]), { value: 4000 })
    key = await positionRouter.getRequestKey(user0.address, 1)
    await expect(positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: mark price lower than limit")
  })

  it("decreasePosition minOut long", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)

    let decreasePositionParams = [
      [bnb.address, dai.address], // _collateralToken
      bnb.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      true, // _isLong
      user1.address,  // _receiver
      toUsd(290),  // _acceptablePrice
      expandDecimals(300, 18) // _minOut
    ]

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false]), { value: 4000 })
    key = await positionRouter.getRequestKey(user0.address, 1)
    await expect(positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: insufficient amountOut")
  })

  it("increasePosition acceptablePrice short", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await dai.mint(vault.address, expandDecimals(8000, 18))
    await vault.buyUSDF(dai.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [bnb.address, dai.address], // _path
      bnb.address, // _indexToken
      expandDecimals(2, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(310), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: mark price lower than limit")
  })

  it("maxGlobalShortSize", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await dai.mint(vault.address, expandDecimals(8000, 18))
    await vault.buyUSDF(dai.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    await positionRouter.setMaxGlobalSizes(
      [bnb.address, btc.address],
      [0, 0],
      [toUsd(5000), toUsd(10000)]
    )

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [bnb.address, dai.address], // _path
      bnb.address, // _indexToken
      expandDecimals(2, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(290), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: max global shorts exceeded")

    await positionRouter.setMaxGlobalSizes(
      [bnb.address, btc.address],
      [0, 0],
      [toUsd(6000), toUsd(10000)]
    )

    expect(await vault.globalShortSizes(bnb.address)).eq(0)
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    expect(await vault.globalShortSizes(bnb.address)).eq("6000000000000000000000000000000000") // 6000
  })

  it("decreasePosition acceptablePrice short", async () => {
    await positionRouter.setDelayValues(0, 300, 500)
    await dai.mint(vault.address, expandDecimals(8000, 18))
    await vault.buyUSDF(dai.address, user1.address)
    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    let params = [
      [bnb.address, dai.address], // _path
      bnb.address, // _indexToken
      expandDecimals(2, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(290), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)

    let decreasePositionParams = [
      [dai.address, bnb.address], // _collateralToken
      bnb.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      false, // _isLong
      user1.address,  // _receiver
      toUsd(290),  // _acceptablePrice
      0 // _minOut
    ]

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false]), { value: 4000 })
    key = await positionRouter.getRequestKey(user0.address, 1)
    await expect(positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: mark price higher than limit")
  })

  it("createIncreasePosition, executeIncreasePosition, cancelIncreasePosition", async () => {
    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    const params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ]

    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([3000, referralCode])))
      .to.be.revertedWith("PositionRouter: invalid executionFee")

    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode])))
      .to.be.revertedWith("PositionRouter: invalid msg.value")

    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 3000 }))
      .to.be.revertedWith("PositionRouter: invalid msg.value")

    params[0] = []
    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("PositionRouter: invalid _path length")

    params[0] = [dai.address, bnb.address, bnb.address]

    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("PositionRouter: invalid _path length")

    params[0] = [dai.address, bnb.address]

    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("Router: invalid plugin")

    await router.addPlugin(positionRouter.address)

    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("Router: plugin not approved")

    await router.connect(user0).approvePlugin(positionRouter.address)

    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance")

    await dai.mint(user0.address, expandDecimals(600, 18))

    await expect(positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")

    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)
    let request = await positionRouter.increasePositionRequests(key)

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(HashZero)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(0)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.sizeDelta).eq(0)
    expect(request.isLong).eq(false)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.hasCollateralInETH).eq(false)

    let queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)

    const tx0 = await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await reportGasUsed(provider, tx0, "createIncreasePosition gas used")

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(4000)
    expect(await dai.balanceOf(positionRouter.address)).eq(expandDecimals(600, 18))

    const blockNumber = await provider.getBlockNumber()
    const blockTime = await getBlockTime(provider)

    request = await positionRouter.increasePositionRequests(key)

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(referralCode)
    expect(await dai.balanceOf(positionRouter.address)).eq(expandDecimals(600, 18))
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(1)

    expect(request.account).eq(user0.address)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(bnb.address)
    expect(request.amountIn).eq(expandDecimals(600, 18))
    expect(request.minOut).eq(expandDecimals(1, 18))
    expect(request.sizeDelta).eq(toUsd(6000))
    expect(request.isLong).eq(true)
    expect(request.acceptablePrice).eq(toUsd(300))
    expect(request.executionFee).eq(4000)
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.hasCollateralInETH).eq(false)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.setDelayValues(5, 300, 500)

    const executionFeeReceiver = newWallet()
    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: forbidden")

    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    // executeIncreasePosition will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("Vault: poolAmount exceeded")

    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.setContractHandler(positionRouter.address, true)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("Vault: leverage not enabled")

    await timelock.setShouldToggleIsLeverageEnabled(true)

    let position = await vault.getPosition(user0.address, bnb.address, bnb.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(0) // lastIncreasedTime

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    const tx1 = await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx1, "executeIncreasePosition gas used")

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)

    request = await positionRouter.increasePositionRequests(key)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.sizeDelta).eq(0)
    expect(request.isLong).eq(false)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.hasCollateralInETH).eq(false)

    position = await vault.getPosition(user0.address, bnb.address, bnb.address, true)
    expect(position[0]).eq(toUsd(6000)) // size
    expect(position[1]).eq("592200000000000000000000000000000") // collateral, 592.2
    expect(position[2]).eq(toUsd(300)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(20, 18)) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await dai.mint(user1.address, expandDecimals(600, 18))
    await dai.connect(user1).approve(router.address, expandDecimals(600, 18))
    await router.connect(user1).approvePlugin(positionRouter.address)

    await positionRouter.connect(user1).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(4000)
    expect(await dai.balanceOf(positionRouter.address)).eq(expandDecimals(600, 18))
    expect(await dai.balanceOf(user1.address)).eq(0)

    key = await positionRouter.getRequestKey(user1.address, 1)
    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(user1.address)

    await positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address)
    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(user1.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    const tx2 = await positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx2, "cancelIncreasePosition gas used")

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(expandDecimals(600, 18))

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    await dai.mint(user2.address, expandDecimals(600, 18))
    await dai.connect(user2).approve(router.address, expandDecimals(600, 18))
    await router.connect(user2).approvePlugin(positionRouter.address)

    params[0] = [dai.address] // _path
    params[5] = false // _isLong

    const tx3 = await positionRouter.connect(user2).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await reportGasUsed(provider, tx3, "createIncreasePosition gas used")

    key = await positionRouter.getRequestKey(user2.address, 1)

    await mineBlock(provider)
    await mineBlock(provider)

    await dai.mint(vault.address, expandDecimals(7000, 18))
    await vault.buyUSDF(dai.address, user1.address)

    const tx4 = await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx4, "executeIncreasePosition gas used")

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(AddressZero)

    position = await vault.getPosition(user2.address, dai.address, bnb.address, false)
    expect(position[0]).eq(toUsd(6000)) // size
    expect(position[1]).eq("594000000000000000000000000000000") // collateral, 594
    expect(position[2]).eq(toUsd(300)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(6000, 18)) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(3) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length
  })

  it("createIncreasePositionETH, executeIncreasePosition, cancelIncreasePosition", async () => {
    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    const params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(290, 18), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(300), // _acceptablePrice
    ]

    await expect(positionRouter.connect(user0).createIncreasePositionETH(...params.concat([3000, referralCode])))
      .to.be.revertedWith("PositionRouter: invalid executionFee")

    await expect(positionRouter.connect(user0).createIncreasePositionETH(...params.concat([4000, referralCode])), { value: 3000 })
      .to.be.revertedWith("PositionRouter: invalid msg.value")

    await expect(positionRouter.connect(user0).createIncreasePositionETH(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("PositionRouter: invalid _path")

    params[0] = []
    await expect(positionRouter.connect(user0).createIncreasePositionETH(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("PositionRouter: invalid _path length")

    params[0] = [bnb.address, dai.address, dai.address]
    await expect(positionRouter.connect(user0).createIncreasePositionETH(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("PositionRouter: invalid _path length")

    params[0] = [bnb.address, dai.address]

    key = await positionRouter.getRequestKey(user0.address, 1)
    let request = await positionRouter.increasePositionRequests(key)

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(HashZero)
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(0)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.sizeDelta).eq(0)
    expect(request.isLong).eq(false)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.hasCollateralInETH).eq(false)

    let queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)

    const tx = await positionRouter.connect(user0).createIncreasePositionETH(...params.concat([4000, referralCode]), { value: expandDecimals(1, 18).add(4000) })
    await reportGasUsed(provider, tx, "createIncreasePositionETH gas used")

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(expandDecimals(1, 18).add(4000))
    expect(await dai.balanceOf(positionRouter.address)).eq(0)

    const blockNumber = await provider.getBlockNumber()
    const blockTime = await getBlockTime(provider)

    request = await positionRouter.increasePositionRequests(key)

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(referralCode)
    expect(await bnb.balanceOf(positionRouter.address)).eq(expandDecimals(1, 18).add(4000))
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(1)

    expect(request.account).eq(user0.address)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(bnb.address)
    expect(request.amountIn).eq(expandDecimals(1, 18))
    expect(request.minOut).eq(expandDecimals(290, 18))
    expect(request.sizeDelta).eq(toUsd(6000))
    expect(request.isLong).eq(false)
    expect(request.acceptablePrice).eq(toUsd(300))
    expect(request.executionFee).eq(4000)
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.hasCollateralInETH).eq(true)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.setDelayValues(5, 300, 500)

    const executionFeeReceiver = newWallet()
    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: forbidden")

    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    // executeIncreasePosition will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("Vault: poolAmount exceeded")

    await dai.mint(vault.address, expandDecimals(7000, 18))
    await vault.buyUSDF(dai.address, user1.address)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.setContractHandler(positionRouter.address, true)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("Router: invalid plugin")

    await router.addPlugin(positionRouter.address)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("Router: plugin not approved")

    await router.connect(user0).approvePlugin(positionRouter.address)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("Vault: leverage not enabled")

    await timelock.setShouldToggleIsLeverageEnabled(true)

    let position = await vault.getPosition(user0.address, bnb.address, bnb.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(0) // lastIncreasedTime

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    const tx1 = await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx1, "executeIncreasePosition gas used")

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)

    request = await positionRouter.increasePositionRequests(key)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.sizeDelta).eq(0)
    expect(request.isLong).eq(false)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.hasCollateralInETH).eq(false)

    position = await vault.getPosition(user0.address, dai.address, bnb.address, false)
    expect(position[0]).eq(toUsd(6000)) // size
    expect(position[1]).eq("293100000000000000000000000000000") // collateral, 293.1
    expect(position[2]).eq(toUsd(300)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(6000, 18)) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await router.connect(user1).approvePlugin(positionRouter.address)
    await positionRouter.connect(user1).createIncreasePositionETH(...params.concat([4000, referralCode]), { value: expandDecimals(1, 18).add(4000) })

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(expandDecimals(1, 18).add(4000))
    expect(await dai.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)

    key = await positionRouter.getRequestKey(user1.address, 1)
    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(user1.address)

    await positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address)
    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(user1.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    const balanceBefore = await provider.getBalance(user1.address)
    const tx2 = await positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx2, "cancelIncreasePosition gas used")

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect((await provider.getBalance(user1.address)).sub(balanceBefore)).eq(expandDecimals(1, 18))
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    await router.connect(user2).approvePlugin(positionRouter.address)

    params[0] = [bnb.address] // _path
    params[4] = true // _isLong

    const tx3 = await positionRouter.connect(user2).createIncreasePositionETH(...params.concat([4000, referralCode]), { value: expandDecimals(1, 18).add(4000) })
    await reportGasUsed(provider, tx3, "createIncreasePosition gas used")

    key = await positionRouter.getRequestKey(user2.address, 1)

    await mineBlock(provider)
    await mineBlock(provider)

    await bnb.mint(vault.address, expandDecimals(25, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    const tx4 = await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx4, "executeIncreasePosition gas used")

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(AddressZero)

    position = await vault.getPosition(user2.address, bnb.address, bnb.address, true)
    expect(position[0]).eq(toUsd(6000)) // size
    expect(position[1]).eq("294000000000000000000000000000000") // collateral, 294
    expect(position[2]).eq(toUsd(300)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(20, 18)) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(3) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length
  })

  it("createIncreasePosition, createDecreasePosition, executeDecreasePosition, cancelDecreasePosition", async () => {
    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    const params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await positionRouter.getRequestKey(user0.address, 1)
    let request = await positionRouter.increasePositionRequests(key)

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(HashZero)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(0)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.sizeDelta).eq(0)
    expect(request.isLong).eq(false)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.hasCollateralInETH).eq(false)

    let queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)

    const tx0 = await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await reportGasUsed(provider, tx0, "createIncreasePosition gas used")

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(4000)
    expect(await dai.balanceOf(positionRouter.address)).eq(expandDecimals(600, 18))

    let blockNumber = await provider.getBlockNumber()
    let blockTime = await getBlockTime(provider)

    request = await positionRouter.increasePositionRequests(key)

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(referralCode)
    expect(await dai.balanceOf(positionRouter.address)).eq(expandDecimals(600, 18))
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(1)

    expect(request.account).eq(user0.address)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(bnb.address)
    expect(request.amountIn).eq(expandDecimals(600, 18))
    expect(request.minOut).eq(expandDecimals(1, 18))
    expect(request.sizeDelta).eq(toUsd(6000))
    expect(request.isLong).eq(true)
    expect(request.acceptablePrice).eq(toUsd(300))
    expect(request.executionFee).eq(4000)
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.hasCollateralInETH).eq(false)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.setDelayValues(5, 300, 500)

    const executionFeeReceiver = newWallet()
    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    // executeIncreasePosition will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.increasePositionRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    await timelock.setContractHandler(positionRouter.address, true)

    await timelock.setShouldToggleIsLeverageEnabled(true)

    let position = await vault.getPosition(user0.address, bnb.address, bnb.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(0) // lastIncreasedTime

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    const tx1 = await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx1, "executeIncreasePosition gas used")

    expect(await provider.getBalance(positionRouter.address)).eq(0)
    expect(await bnb.balanceOf(positionRouter.address)).eq(0)
    expect(await dai.balanceOf(positionRouter.address)).eq(0)

    request = await positionRouter.increasePositionRequests(key)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.indexToken).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.sizeDelta).eq(0)
    expect(request.isLong).eq(false)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.hasCollateralInETH).eq(false)

    position = await vault.getPosition(user0.address, bnb.address, bnb.address, true)
    expect(position[0]).eq(toUsd(6000)) // size
    expect(position[1]).eq("592200000000000000000000000000000") // collateral, 592.2
    expect(position[2]).eq(toUsd(300)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(20, 18)) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    let decreasePositionParams = [
      [bnb.address, dai.address], // _collateralToken
      bnb.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      true, // _isLong
      user1.address,  // _receiver
      toUsd(290),  // _acceptablePrice
      0 // _minOut
    ]

    await expect(positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([3000, false])))
      .to.be.revertedWith("PositionRouter: invalid executionFee")

    await expect(positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false])))
      .to.be.revertedWith("PositionRouter: invalid msg.value")

    await expect(positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false]), { value: 3000 }))
      .to.be.revertedWith("PositionRouter: invalid msg.value")

    await expect(positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false]), { value: 3000 }))
      .to.be.revertedWith("PositionRouter: invalid msg.value")

    await expect(positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, true]), { value: 4000 }))
      .to.be.revertedWith("PositionRouter: invalid _path")

    decreasePositionParams[0] = []

    await expect(positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, true]), { value: 4000 }))
      .to.be.revertedWith("PositionRouter: invalid _path length")

    decreasePositionParams[0] = [bnb.address, dai.address, bnb.address]

    await expect(positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, true]), { value: 4000 }))
      .to.be.revertedWith("PositionRouter: invalid _path length")

    decreasePositionParams[0] = [bnb.address]

    const tx2 = await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false]), { value: 4000 })
    await reportGasUsed(provider, tx2, "createDecreasePosition gas used")

    blockNumber = await provider.getBlockNumber()
    blockTime = await getBlockTime(provider)

    key = await positionRouter.getRequestKey(user0.address, 1)
    request = await positionRouter.decreasePositionRequests(key)
    let decreaseRequestPath = await positionRouter.getDecreasePositionRequestPath(key)

    expect(request.account).eq(user0.address)
    expect(decreaseRequestPath.length).eq(1)
    expect(decreaseRequestPath[0]).eq(bnb.address)
    expect(request.indexToken).eq(bnb.address)
    expect(request.collateralDelta).eq(toUsd(300))
    expect(request.sizeDelta).eq(toUsd(1000))
    expect(request.isLong).eq(true)
    expect(request.receiver).eq(user1.address)
    expect(request.acceptablePrice).eq(toUsd(290))
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.withdrawETH).eq(false)

    await positionRouter.setPositionKeeper(positionKeeper.address, false)

    await expect(positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: forbidden")

    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    await positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.decreasePositionRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    expect(await bnb.balanceOf(user1.address)).eq(0)

    const tx3 = await positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx3, "executeDecreasePosition gas used")

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    request = await positionRouter.decreasePositionRequests(key)
    expect(request.account).eq(AddressZero)
    expect(request.indexToken).eq(AddressZero)

    position = await vault.getPosition(user0.address, bnb.address, bnb.address, true)

    expect(position[0]).eq(toUsd(5000)) // size
    expect(position[1]).eq("292200000000000000000000000000000") // collateral, 592.2
    expect(position[2]).eq(toUsd(300)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq("16666666666666666667") // reserveAmount, 16.666666666666666667
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit

    expect(await bnb.balanceOf(user1.address)).eq("996666666666666666") // 0.996666666666666666

    const collateralReceiver = newWallet()
    decreasePositionParams[2] = toUsd(150)
    decreasePositionParams[5] = collateralReceiver.address

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, true]), { value: 4000 })

    key = await positionRouter.getRequestKey(user0.address, 2)
    request = await positionRouter.decreasePositionRequests(key)

    expect(request.account).eq(user0.address)
    expect(request.indexToken).eq(bnb.address)
    expect(request.collateralDelta).eq(toUsd(150))
    expect(request.sizeDelta).eq(toUsd(1000))
    expect(request.isLong).eq(true)
    expect(request.receiver).eq(collateralReceiver.address)
    expect(request.acceptablePrice).eq(toUsd(290))
    expect(request.withdrawETH).eq(true)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    expect(await provider.getBalance(collateralReceiver.address)).eq(0)

    await positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(12000)

    request = await positionRouter.decreasePositionRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(collateralReceiver.address)).eq("496666666666666666") // 0.496666666666666666

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, true]), { value: 4000 })

    key = await positionRouter.getRequestKey(user0.address, 3)

    request = await positionRouter.decreasePositionRequests(key)
    expect(request.account).eq(user0.address)

    await positionRouter.connect(positionKeeper).cancelDecreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.decreasePositionRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await positionRouter.connect(positionKeeper).cancelDecreasePosition(key, executionFeeReceiver.address)

    request = await positionRouter.decreasePositionRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(16000)

    await positionRouter.connect(positionKeeper).cancelDecreasePosition(key, executionFeeReceiver.address)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(16000)

    decreasePositionParams = [
      [bnb.address, dai.address], // _collateralToken
      bnb.address, // _indexToken
      toUsd(50), // _collateralDelta
      toUsd(500), // _sizeDelta
      true, // _isLong
      user1.address,  // _receiver
      toUsd(290),  // _acceptablePrice
      expandDecimals(100, 18) // _minOut
    ]

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false]), { value: 4000 })
    key = await positionRouter.getRequestKey(user0.address, 4)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    expect(await dai.balanceOf(user1.address)).eq(0)

    await expect(positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address))
      .to.be.revertedWith("BasePositionManager: insufficient amountOut")

    decreasePositionParams[7] = expandDecimals(40, 18)

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, false]), { value: 4000 })
    key = await positionRouter.getRequestKey(user0.address, 5)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    const tx4 = await positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx4, "executeDecreasePosition gas used")

    expect(await dai.balanceOf(user1.address)).eq("49351500000000000000") // 49.3515

    let increasePositionParams = [
      [bnb.address, dai.address], // _path
      bnb.address, // _indexToken
      expandDecimals(2, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(300), // _acceptablePrice
    ]

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))
    await dai.mint(vault.address, expandDecimals(10000, 18))
    await vault.buyUSDF(dai.address, user1.address)

    await positionRouter.connect(user0).createIncreasePosition(...increasePositionParams.concat([4000, referralCode]), { value: 4000 })
    key = await positionRouter.getRequestKey(user0.address, 2)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address)

    position = await vault.getPosition(user0.address, dai.address, bnb.address, false)
    expect(position[0]).eq(toUsd(6000)) // size
    expect(position[1]).eq("592200000000000000000000000000000") // collateral, 592.2
    expect(position[2]).eq(toUsd(300)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(6000, 18)) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit

    const collateralReceiver1 = newWallet()

    decreasePositionParams = [
      [dai.address, bnb.address], // _collateralToken
      bnb.address, // _indexToken
      toUsd(150), // _collateralDelta
      toUsd(500), // _sizeDelta
      false, // _isLong
      collateralReceiver1.address,  // _receiver
      toUsd(310),  // _acceptablePrice
      "400000000000000000" // _minOut
    ]

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([4000, true]), { value: 4000 })
    key = await positionRouter.getRequestKey(user0.address, 6)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    expect(await provider.getBalance(collateralReceiver1.address)).eq(0)
    await positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address)
    expect(await provider.getBalance(collateralReceiver1.address)).eq("496838333333333333") // 0.496838333333333333
  })

  it("executeIncreasePositions, executeDecreasePositions", async () => {
    await positionRouter.setDelayValues(5, 300, 500)
    const executionFeeReceiver = newWallet()

    await bnb.mint(vault.address, expandDecimals(500, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    await router.addPlugin(positionRouter.address)
    await router.connect(user0).approvePlugin(positionRouter.address)
    await router.connect(user1).approvePlugin(positionRouter.address)
    await router.connect(user2).approvePlugin(positionRouter.address)

    await timelock.setContractHandler(positionRouter.address, true)
    await timelock.setShouldToggleIsLeverageEnabled(true)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePositions(100, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: forbidden")

    await expect(positionRouter.connect(positionKeeper).executeDecreasePositions(100, executionFeeReceiver.address))
      .to.be.revertedWith("PositionRouter: forbidden")

    await positionRouter.setPositionKeeper(positionKeeper.address, true)

    let queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(100, executionFeeReceiver.address)
    await positionRouter.connect(positionKeeper).executeDecreasePositions(100, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    const params = [
      [dai.address, bnb.address], // _path
      bnb.address, // _indexToken
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ]

    await router.addPlugin(positionRouter.address)

    await router.connect(user0).approvePlugin(positionRouter.address)
    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))
    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    let key0 = await positionRouter.getRequestKey(user0.address, 1)
    let request0 = await positionRouter.increasePositionRequests(key0)
    expect(request0.account).eq(user0.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await router.connect(user1).approvePlugin(positionRouter.address)
    await dai.mint(user1.address, expandDecimals(600, 18))
    await dai.connect(user1).approve(router.address, expandDecimals(600, 18))
    await positionRouter.connect(user1).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    let key1 = await positionRouter.getRequestKey(user1.address, 1)
    let request1 = await positionRouter.increasePositionRequests(key1)
    expect(request1.account).eq(user1.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(2) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await router.connect(user2).approvePlugin(positionRouter.address)
    await dai.mint(user2.address, expandDecimals(600, 18))
    await dai.connect(user2).approve(router.address, expandDecimals(600, 18))
    await positionRouter.connect(user2).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    let key2 = await positionRouter.getRequestKey(user2.address, 1)
    let request2 = await positionRouter.increasePositionRequests(key2)
    expect(request2.account).eq(user2.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(3) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    params[4] = toUsd(500000) // _sizeDelta

    await router.connect(user3).approvePlugin(positionRouter.address)
    await dai.mint(user3.address, expandDecimals(600, 18))
    await dai.connect(user3).approve(router.address, expandDecimals(600, 18))
    await positionRouter.connect(user3).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    let key3 = await positionRouter.getRequestKey(user3.address, 1)
    let request3 = await positionRouter.increasePositionRequests(key3)
    expect(request3.account).eq(user3.address)

    params[4] = toUsd(6000) // _sizeDelta

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(4) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await router.connect(user4).approvePlugin(positionRouter.address)
    await dai.mint(user4.address, expandDecimals(600, 18))
    await dai.connect(user4).approve(router.address, expandDecimals(600, 18))
    await positionRouter.connect(user4).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    let key4 = await positionRouter.getRequestKey(user4.address, 1)
    let request4 = await positionRouter.increasePositionRequests(key4)
    expect(request4.account).eq(user4.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePosition(key2, executionFeeReceiver.address)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    expect((await positionRouter.increasePositionRequests(key2)).account).eq(AddressZero)

    await expect(positionRouter.connect(positionKeeper).executeIncreasePosition(key3, executionFeeReceiver.address))
      .to.be.revertedWith("Vault: fees exceed collateral")

    // queue: request0, request1, request2 (executed), request3 (not executable), request4

    await positionRouter.connect(positionKeeper).executeIncreasePositions(0, executionFeeReceiver.address)
    expect((await positionRouter.increasePositionRequests(key0)).account).eq(user0.address)
    expect((await positionRouter.increasePositionRequests(key1)).account).eq(user1.address)
    expect((await positionRouter.increasePositionRequests(key2)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key3)).account).eq(user3.address)
    expect((await positionRouter.increasePositionRequests(key4)).account).eq(user4.address)

    expect(await positionRouter.increasePositionRequestKeys(0)).eq(key0)
    expect(await positionRouter.increasePositionRequestKeys(1)).eq(key1)
    expect(await positionRouter.increasePositionRequestKeys(2)).eq(key2)
    expect(await positionRouter.increasePositionRequestKeys(3)).eq(key3)
    expect(await positionRouter.increasePositionRequestKeys(4)).eq(key4)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(1, executionFeeReceiver.address)
    expect((await positionRouter.increasePositionRequests(key0)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key1)).account).eq(user1.address)
    expect((await positionRouter.increasePositionRequests(key2)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key3)).account).eq(user3.address)
    expect((await positionRouter.increasePositionRequests(key4)).account).eq(user4.address)

    expect(await positionRouter.increasePositionRequestKeys(0)).eq(HashZero)
    expect(await positionRouter.increasePositionRequestKeys(1)).eq(key1)
    expect(await positionRouter.increasePositionRequestKeys(2)).eq(key2)
    expect(await positionRouter.increasePositionRequestKeys(3)).eq(key3)
    expect(await positionRouter.increasePositionRequestKeys(4)).eq(key4)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(1) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(0, executionFeeReceiver.address)

    expect((await positionRouter.increasePositionRequests(key0)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key1)).account).eq(user1.address)
    expect((await positionRouter.increasePositionRequests(key2)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key3)).account).eq(user3.address)
    expect((await positionRouter.increasePositionRequests(key4)).account).eq(user4.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(1) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)
    expect(await dai.balanceOf(user2.address)).eq(0)
    expect(await dai.balanceOf(user3.address)).eq(0)
    expect(await dai.balanceOf(user4.address)).eq(0)

    await positionRouter.connect(positionKeeper).executeIncreasePositions(10, executionFeeReceiver.address)

    expect((await positionRouter.increasePositionRequests(key0)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key1)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key2)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key3)).account).eq(AddressZero)
    expect((await positionRouter.increasePositionRequests(key4)).account).eq(AddressZero)

    expect(await positionRouter.increasePositionRequestKeys(0)).eq(HashZero)
    expect(await positionRouter.increasePositionRequestKeys(1)).eq(HashZero)
    expect(await positionRouter.increasePositionRequestKeys(2)).eq(HashZero)
    expect(await positionRouter.increasePositionRequestKeys(3)).eq(HashZero)
    expect(await positionRouter.increasePositionRequestKeys(4)).eq(HashZero)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(20000)

    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)
    expect(await dai.balanceOf(user2.address)).eq(0)
    expect(await dai.balanceOf(user3.address)).eq(expandDecimals(600, 18)) // refunded
    expect(await dai.balanceOf(user4.address)).eq(0)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))
    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))
    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(10, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await mineBlock(provider)

    await positionRouter.connect(positionKeeper).executeIncreasePositions(6, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(6) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await positionRouter.connect(positionKeeper).executeIncreasePositions(6, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(6) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(10, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0) // decreasePositionRequestKeys.length

    let decreasePositionParams = [
      [bnb.address], // _path
      bnb.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      true // _isLong
    ]

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([user0.address, 0, toUsd(290), 4000, false]), { value: 4000 })
    let decreaseKey0 = await positionRouter.getRequestKey(user0.address, 1)
    expect((await positionRouter.decreasePositionRequests(decreaseKey0)).account).eq(user0.address)

    await positionRouter.connect(user1).createDecreasePosition(...decreasePositionParams.concat([user1.address, 0, toUsd(290), 4000, false]), { value: 4000 })
    let decreaseKey1 = await positionRouter.getRequestKey(user1.address, 1)
    expect((await positionRouter.decreasePositionRequests(decreaseKey1)).account).eq(user1.address)

    await positionRouter.connect(user2).createDecreasePosition(...decreasePositionParams.concat([user2.address, 0, toUsd(290), 4000, false]), { value: 4000 })
    let decreaseKey2 = await positionRouter.getRequestKey(user2.address, 1)
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(user2.address)

    await positionRouter.connect(user3).createDecreasePosition(...decreasePositionParams.concat([user3.address, 0, toUsd(290), 4000, false]), { value: 4000 })
    let decreaseKey3 = await positionRouter.getRequestKey(user3.address, 1)
    expect((await positionRouter.decreasePositionRequests(decreaseKey3)).account).eq(user3.address)

    await positionRouter.connect(user4).createDecreasePosition(...decreasePositionParams.concat([user4.address, 0, toUsd(290), 4000, false]), { value: 4000 })
    let decreaseKey4 = await positionRouter.getRequestKey(user4.address, 1)
    expect((await positionRouter.decreasePositionRequests(decreaseKey4)).account).eq(user4.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await bnb.balanceOf(user2.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(0)
    expect(await bnb.balanceOf(user4.address)).eq(0)

    await expect(positionRouter.connect(positionKeeper).executeDecreasePosition(decreaseKey3, executionFeeReceiver.address))
      .to.be.revertedWith("Vault: empty position")

    await positionRouter.connect(positionKeeper).executeDecreasePosition(decreaseKey2, executionFeeReceiver.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(AddressZero)

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await bnb.balanceOf(user2.address)).eq("996666666666666666")
    expect(await bnb.balanceOf(user3.address)).eq(0)
    expect(await bnb.balanceOf(user4.address)).eq(0)

    // queue: request0, request1, request2 (executed), request3 (not executable), request4

    await positionRouter.connect(positionKeeper).executeDecreasePositions(0, executionFeeReceiver.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey0)).account).eq(user0.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey1)).account).eq(user1.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(AddressZero)
    expect((await positionRouter.decreasePositionRequests(decreaseKey3)).account).eq(user3.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey4)).account).eq(user4.address)

    expect(await positionRouter.decreasePositionRequestKeys(0)).eq(decreaseKey0)
    expect(await positionRouter.decreasePositionRequestKeys(1)).eq(decreaseKey1)
    expect(await positionRouter.decreasePositionRequestKeys(2)).eq(decreaseKey2)
    expect(await positionRouter.decreasePositionRequestKeys(3)).eq(decreaseKey3)
    expect(await positionRouter.decreasePositionRequestKeys(4)).eq(decreaseKey4)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(5) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeDecreasePositions(1, executionFeeReceiver.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey0)).account).eq(AddressZero)
    expect((await positionRouter.decreasePositionRequests(decreaseKey1)).account).eq(user1.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(AddressZero)
    expect((await positionRouter.decreasePositionRequests(decreaseKey3)).account).eq(user3.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey4)).account).eq(user4.address)

    expect(await positionRouter.decreasePositionRequestKeys(0)).eq(HashZero)
    expect(await positionRouter.decreasePositionRequestKeys(1)).eq(decreaseKey1)
    expect(await positionRouter.decreasePositionRequestKeys(2)).eq(decreaseKey2)
    expect(await positionRouter.decreasePositionRequestKeys(3)).eq(decreaseKey3)
    expect(await positionRouter.decreasePositionRequestKeys(4)).eq(decreaseKey4)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(1) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(5) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeDecreasePositions(10, executionFeeReceiver.address)
    expect((await positionRouter.decreasePositionRequests(decreaseKey0)).account).eq(AddressZero)
    expect((await positionRouter.decreasePositionRequests(decreaseKey1)).account).eq(AddressZero)
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(AddressZero)
    expect((await positionRouter.decreasePositionRequests(decreaseKey3)).account).eq(AddressZero)
    expect((await positionRouter.decreasePositionRequests(decreaseKey4)).account).eq(AddressZero)

    expect(await positionRouter.decreasePositionRequestKeys(0)).eq(HashZero)
    expect(await positionRouter.decreasePositionRequestKeys(1)).eq(HashZero)
    expect(await positionRouter.decreasePositionRequestKeys(2)).eq(HashZero)
    expect(await positionRouter.decreasePositionRequestKeys(3)).eq(HashZero)
    expect(await positionRouter.decreasePositionRequestKeys(4)).eq(HashZero)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(5) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(5) // decreasePositionRequestKeys.length

    expect(await bnb.balanceOf(user0.address)).eq("996666666666666666")
    expect(await bnb.balanceOf(user1.address)).eq("996666666666666666")
    expect(await bnb.balanceOf(user2.address)).eq("996666666666666666")
    expect(await bnb.balanceOf(user3.address)).eq(0)
    expect(await bnb.balanceOf(user4.address)).eq("996666666666666666")

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([user0.address, toUsd(290), 0, 4000, false]), { value: 4000 })
    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([user0.address, toUsd(290), 0, 4000, false]), { value: 4000 })

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(5) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeDecreasePositions(10, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(5) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7) // decreasePositionRequestKeys.length

    await mineBlock(provider)
    await mineBlock(provider)

    await positionRouter.connect(positionKeeper).executeDecreasePositions(6, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(6) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7) // decreasePositionRequestKeys.length

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await positionRouter.connect(positionKeeper).executeDecreasePositions(6, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(6) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7) // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeDecreasePositions(10, executionFeeReceiver.address)

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(7) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7) // decreasePositionRequestKeys.length

    await dai.mint(user0.address, expandDecimals(1800, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(1800, 18))

    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })
    await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode]), { value: 4000 })

    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([user0.address, toUsd(290), 0, 4000, false]), { value: 4000 })
    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([user0.address, toUsd(290), 0, 4000, false]), { value: 4000 })
    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([user0.address, toUsd(290), 0, 4000, false]), { value: 4000 })
    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([user0.address, toUsd(290), 0, 4000, false]), { value: 4000 })
    await positionRouter.connect(user0).createDecreasePosition(...decreasePositionParams.concat([user0.address, toUsd(290), 0, 4000, false]), { value: 4000 })

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(10) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(7) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(12) // decreasePositionRequestKeys.length

    await fastPriceFeed.setMaxTimeDeviation(1000)
    await positionRouter.setPositionKeeper(fastPriceFeed.address, true)
    await swapRouter.setRequestKeeper(fastPriceFeed.address, true)
    await liquidityRouter.setRequestKeeper(fastPriceFeed.address, true)

    const blockTime = await getBlockTime(provider)

    await expect(fastPriceFeed.connect(user0).setPricesWithBitsAndExecute(
      0, // _priceBits
      blockTime, // _timestamp
      9, // _endIndexForIncreasePositions
      10, // _endIndexForDecreasePositions
      0, // _endIndexForSwaps
      0, // _endIndexForAddLiquidities
      0 // _endIndexForRemoeLiquidities
    )).to.be.revertedWith("FastPriceFeed: forbidden")

    await fastPriceFeed.connect(updater0).setPricesWithBitsAndExecute(
      0, // _priceBits
      blockTime, // _timestamp
      9, // _endIndexForIncreasePositions
      10, // _endIndexForDecreasePositions
      0, // _endIndexForSwaps
      0, // _endIndexForAddLiquidities
      0 // _endIndexForRemoeLiquidities
    )

    queueLengths = await positionRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(9) // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(10) // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(10) // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(12) // decreasePositionRequestKeys.length
  })
})
