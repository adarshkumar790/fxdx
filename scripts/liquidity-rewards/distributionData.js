const fs = require('fs')

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const ethers = require('ethers')

const OPTIMISM_GOERLI_SUBGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/danielsmith0630/fxdx-optimism-goerli-boost1'
const OPTIMISM_SUGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/danielsmith0630/fxdx-optimism-boost1'

const BigNumber = ethers.BigNumber
const { formatUnits } = ethers.utils
const SHARE_DIVISOR = BigNumber.from("1000000000") // 1e9
const FXDX_DECIMALS = 18
const FLP_DECIMALS = 18

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

async function getTotalStat(network) {
  const data = await requestSubgraph(network, `{
    totalStat(id: "total") {
      startTimestamp
      endTimestamp
      totalSupply
      cumulativeRewardsPerToken
      lastCalculatedAt
    }
  }`)

  const totalStat = data.totalStat
  return {
    ...totalStat,
    totalSupply: bigNumberify(totalStat.totalSupply),
    cumulativeRewardsPerToken: bigNumberify(totalStat.cumulativeRewardsPerToken),
  }
}

const REWARDS_PER_SECOND = bigNumberify('192901234567901234')
const PRECISION = expandDecimals(1, 30)
const TOTAL_REWARDS = expandDecimals(250000, 18)

async function saveDistributionData(network, account) {
  let userCondition = ""
  if (account) {
    userCondition = `,account: "${account.toLowerCase()}"`
  }

  const getUserStatsQuery = (skip) => `userStats(first: 1000, skip: ${skip}, where: {
    ${userCondition}
  }) {
    account
    flpBalance
    cumulativeRewards
    prevCumulativeRewardsPerToken
  }`

  const query = `{
    userStats0: ${getUserStatsQuery(0)}
    userStats1: ${getUserStatsQuery(1000)}
    userStats2: ${getUserStatsQuery(2000)}
    userStats3: ${getUserStatsQuery(3000)}
    userStats4: ${getUserStatsQuery(4000)}
    userStats5: ${getUserStatsQuery(5000)}
  }`

  const [data, totalStat] = await Promise.all([
    requestSubgraph(network, query),
    getTotalStat(network),
  ])

  const userStats = [
    ...data.userStats0,
    ...data.userStats1,
    ...data.userStats2,
    ...data.userStats3,
    ...data.userStats4,
    ...data.userStats5,
  ]

  if (userStats.length === 6000) {
    throw new Error("Users stats should be paginated")
  }

  const now = Math.floor(Date.now() / 1000)
  if (now <= totalStat.endTimestamp) {
    throw new Error("Liquidity Boost Session 1 rewards are not eligible yet.")
  }

  if (totalStat.lastCalculatedAt < totalStat.endTimestamp) {
    let lastCalculatedAt = totalStat.lastCalculatedAt
    if (lastCalculatedAt < totalStat.startTimestamp) {
      lastCalculatedAt = totalStat.startTimestamp
    }

    const blockRewards = REWARDS_PER_SECOND.mul(totalStat.endTimestamp - lastCalculatedAt)

    totalStat.cumulativeRewardsPerToken = totalStat.cumulativeRewardsPerToken.add(
      blockRewards.mul(PRECISION).div(totalStat.totalSupply)
    )
  }

  let totalDistributedRewards = bigNumberify(0)

  const usersRewardsData = userStats.map(item => {
    let cumulativeRewards = bigNumberify(item.cumulativeRewards)
    let prevCumulativeRewardsPerToken = bigNumberify(item.prevCumulativeRewardsPerToken)
    let flpBalance = bigNumberify(item.flpBalance)

    if (prevCumulativeRewardsPerToken.lt(totalStat.cumulativeRewardsPerToken)) {
      const accountRewards = flpBalance
        .mul(totalStat.cumulativeRewardsPerToken.sub(prevCumulativeRewardsPerToken))
        .div(PRECISION)

      cumulativeRewards = cumulativeRewards.add(accountRewards)
    }

    totalDistributedRewards = totalDistributedRewards.add(cumulativeRewards)

    return {
      account: item.account,
      flpBalance,
      rewards: cumulativeRewards,
      share: cumulativeRewards.mul(SHARE_DIVISOR).div(TOTAL_REWARDS),
    }
  }).filter(item => item.rewards.gt(0))

  const output = {
    network,
    timestamp: now,
    totalRewards: TOTAL_REWARDS.toString(),
    totalFlpSupply: totalStat.totalSupply.toString(),
    shareDivisor: SHARE_DIVISOR.toString(),
    users: [],
  }
  console.log("\nTotal Liquidity Booster Session 1 Rewards: %s (%s esFXDX)",
    TOTAL_REWARDS.toString(),
    Number(formatUnits(TOTAL_REWARDS, FXDX_DECIMALS)).toFixed(4)
  )
  console.log("\nTotal Liquidity Booster Session 1 Distributed Rewards: %s (%s esFXDX)",
    totalDistributedRewards.toString(),
    Number(formatUnits(totalDistributedRewards, FXDX_DECIMALS)).toFixed(4)
  )
  console.log("\nTotal FLP Supply: %s (%s FLP)",
    totalStat.totalSupply.toString(),
    Number(formatUnits(totalStat.totalSupply, FLP_DECIMALS)).toFixed(4)
  )

  console.log("\nUsers:")
  let consoleData = []
  for (const data of usersRewardsData) {
    consoleData.push({
      referrer: data.account,
      "Flp Balance, FLP": stringToFixed(formatUnits(data.flpBalance, FLP_DECIMALS), 4),
      "rewards, esFXDX": stringToFixed(formatUnits(data.rewards, FXDX_DECIMALS), 4),
      "rewards share, %": stringToFixed(formatUnits(data.share, 7), 4),
    })
    output.users.push({
      account: data.account,
      flpBalance: data.flpBalance.toString(),
      rewards: data.rewards.toString(),
      share: data.share.toString(),
    })
  }
  console.table(consoleData)

  const filename = `./booster-session1-rewards-data-${network}.json`
  fs.writeFileSync(filename, JSON.stringify(output, null, 4))
  console.log("Data saved to: %s", filename)
}

module.exports = {
  saveDistributionData
}
