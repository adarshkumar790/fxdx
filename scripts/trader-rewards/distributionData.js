const fs = require('fs')

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const ethers = require('ethers')

const OPTIMISM_GOERLI_SUBGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/danielsmith0630/fxdx-optimism-goerli-rewards2'
const OPTIMISM_SUGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/danielsmith0630/fxdx-optimism-rewards'

const BigNumber = ethers.BigNumber
const { formatUnits, parseUnits } = ethers.utils
const SHARE_DIVISOR = BigNumber.from("1000000000") // 1e9
const USD_DECIMALS = 30
const FXDX_DECIMALS = 18
const BASIS_POINT_DIVISOR = 10000
const REWARD_RATE_BPS = 20000

function stringToFixed(s, n) {
  return Number(s).toFixed(n)
}

function bigNumberify(n) {
  return ethers.BigNumber.from(n)
}

function expandDecimals(n, decimals) {
  return bigNumberify(n).mul(bigNumberify(10).pow(decimals))
}

function getSubgraphEndpoint(network) {
  return {
    optimismGoerli: OPTIMISM_GOERLI_SUBGRAPH_ENDPOINT,
    optimism: OPTIMISM_SUGRAPH_ENDPOINT,
  }[network]
}

async function requestSubgraph(network, query) {
  const subgraphEndpoint = getSubgraphEndpoint(network)

  if (!subgraphEndpoint) {
    throw new Error("Unknown network " + network)
  }

  const payload = JSON.stringify({query})
  const res = await fetch(subgraphEndpoint, {
    method: 'POST',
    body: payload,
    headers: {'Content-Type': 'application/json'}
  })

  const j = await res.json()
  if (j.errors) {
    throw new Error(JSON.stringify(j))
  }

  return j.data
}

async function saveDistributionData(network, fromTimestamp, toTimestamp, account, esfxdxRewards) {
  if (esfxdxRewards) {
    esfxdxRewards = parseUnits(esfxdxRewards, FXDX_DECIMALS)
  }
  let traderCondition = ""
  if (account) {
    traderCondition = `,account: "${account.toLowerCase()}"`
  }

  const getUserFeesStatsQuery = (skip) => `userFeesStats(first: 1000, skip: ${skip}, where: {
    period: daily,
    totalTradeFees_gt: 0,
    timestamp_gte: ${fromTimestamp},
    timestamp_lt: ${toTimestamp},
    ${traderCondition}
  }) {
    id
    account
    totalTradeFees
  }`

  const query = `{
    userFeesStats0: ${getUserFeesStatsQuery(0)}
    userFeesStats1: ${getUserFeesStatsQuery(1000)}
    userFeesStats2: ${getUserFeesStatsQuery(2000)}
    userFeesStats3: ${getUserFeesStatsQuery(3000)}
    userFeesStats4: ${getUserFeesStatsQuery(4000)}
    userFeesStats5: ${getUserFeesStatsQuery(5000)}
  }`

  const data = await requestSubgraph(network, query)

  const userFeesStats = [
    ...data.userFeesStats0,
    ...data.userFeesStats1,
    ...data.userFeesStats2,
    ...data.userFeesStats3,
    ...data.userFeesStats4,
    ...data.userFeesStats5,
  ]

  if (userFeesStats.length === 6000) {
    throw new Error("Traders stats should be paginated")
  }

  let allTradeFees = BigNumber.from(0)
  const tradersRewardData = userFeesStats.reduce((memo, item) => {
    memo[item.account] = memo[item.account] || {
      tradeFees: BigNumber.from(0)
    }
    allTradeFees = allTradeFees.add(BigNumber.from(item.totalTradeFees))
    memo[item.account].tradeFees = memo[item.account].tradeFees.add(BigNumber.from(item.totalTradeFees))
    return memo
  }, {})

  if (allTradeFees.eq(0)) {
    console.warn("No trade fees on %s", network)
    return
  }

  let esfxdxRewardsTotal = BigNumber.from(0)

  Object.entries(tradersRewardData).forEach(([account, data]) => {
    data.allTradeFees = allTradeFees
    data.account = account
    data.share = data.tradeFees.mul(SHARE_DIVISOR).div(allTradeFees)

    data.expectedEsfxdxRewards = data.tradeFees
      .mul(REWARD_RATE_BPS)
      .mul(expandDecimals(1, FXDX_DECIMALS))
      .div(BASIS_POINT_DIVISOR)
      .div(expandDecimals(1, USD_DECIMALS))

    data.actualEsfxdxRewards = esfxdxRewards && esfxdxRewards.gt(0)
      ? data.expectedEsfxdxRewards
      : BigNumber.from(0)

    esfxdxRewardsTotal = esfxdxRewardsTotal.add(data.expectedEsfxdxRewards)
  })

  if (esfxdxRewards && esfxdxRewards.gt(0) && esfxdxRewardsTotal.gt(esfxdxRewards)) {
    const denominator = esfxdxRewardsTotal.mul(expandDecimals(1, USD_DECIMALS)).div(esfxdxRewards)
    Object.values(tradersRewardData).forEach(data => {
      data.actualEsfxdxRewards = data.expectedEsfxdxRewards.mul(expandDecimals(1, USD_DECIMALS)).div(denominator)
    })
  }

  const actualTotalEsFxdxRewards = !esfxdxRewards || esfxdxRewards.eq(0)
    ? BigNumber.from(0)
    : esfxdxRewards.gt(esfxdxRewardsTotal)
      ? esfxdxRewardsTotal
      : esfxdxRewards

  const output = {
    fromTimestamp,
    toTimestamp,
    network,
    totalTradeFees: allTradeFees.toString(),
    esfxdxRewardsLimit: esfxdxRewards.toString(),
    expectedTotalEsFxdxRewards: esfxdxRewardsTotal.toString(),
    actualTotalEsFxdxRewards: actualTotalEsFxdxRewards.toString(),
    shareDivisor: SHARE_DIVISOR.toString(),
    traders: [],
  }
  console.log("\nTotal trade fees: %s ($%s)",
    allTradeFees.toString(),
    Number(formatUnits(allTradeFees, USD_DECIMALS)).toFixed(4)
  )
  console.log("\nEsFXDX rewards limit: %s (%s esFXDX)",
    esfxdxRewards.toString(),
    Number(formatUnits(esfxdxRewards, FXDX_DECIMALS)).toFixed(4)
  )
  console.log("\nExpected total EsFXDX rewards: %s (%s esFXDX)",
    esfxdxRewardsTotal.toString(),
    Number(formatUnits(esfxdxRewardsTotal, FXDX_DECIMALS)).toFixed(4)
  )
  console.log("\nActual total EsFXDX rewards: %s (%s esFXDX)",
  actualTotalEsFxdxRewards.toString(),
    Number(formatUnits(actualTotalEsFxdxRewards, FXDX_DECIMALS)).toFixed(4)
  )

  console.log("\nTraders:")
  let consoleData = []
  for (const data of Object.values(tradersRewardData)) {
    if (data.share.eq(0)) {
      continue
    }
    consoleData.push({
      trader: data.account,
      "trade fees share, %": stringToFixed(formatUnits(data.share, 7), 4),
      "trade fees, $": stringToFixed(formatUnits(data.tradeFees, USD_DECIMALS), 4),
      "expected esfxdxRewards, esFXDX": stringToFixed(formatUnits(data.expectedEsfxdxRewards, FXDX_DECIMALS), 4),
      "actual esfxdxRewards, esFXDX": stringToFixed(formatUnits(data.actualEsfxdxRewards, FXDX_DECIMALS), 4),
    })
    output.traders.push({
      account: data.account,
      share: data.share.toString(),
      tradeFees: data.tradeFees.toString(),
      expectedEsfxdxRewards: data.expectedEsfxdxRewards.toString(),
      actualEsfxdxRewards: data.actualEsfxdxRewards.toString(),
    })
  }
  console.table(consoleData)

  const filename = `./trader-rewards-data-${network}.json`
  fs.writeFileSync(filename, JSON.stringify(output, null, 4))
  console.log("Data saved to: %s", filename)
}

module.exports = {
  saveDistributionData
}
