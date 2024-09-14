const fs = require('fs')

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const ethers = require('ethers');

const OPTIMISM_GOERLI_SUBGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/danielsmith0630/fxdx-optimism-goerli-saga2'
const OPTIMISM_SUGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/danielsmith0630/fxdx-optimism-saga'

const BigNumber = ethers.BigNumber
const { formatUnits } = ethers.utils
const FXDX_DECIMALS = 18
const TIER_REWARD_RATES = [
  bigNumberify(200),
  bigNumberify(160),
  bigNumberify(120),
  bigNumberify(80),
  bigNumberify(40),
  bigNumberify(20),
]
const REWARD_RATE_PRECISION = bigNumberify(100)
const SHARE_DIVISOR = BigNumber.from("1000000000") // 1e9

function bigNumberify(n) {
  return ethers.BigNumber.from(n)
}

function stringToFixed(s, n) {
  return Number(s).toFixed(n)
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
      holdEndTime
      rewardPeriodEndTimestamp
      totalBuyAmount
      currentActiveTier
      totalDistributedRewards
      lastRewardDistributionTime
    }
  }`)

  const totalStat = data.totalStat
  return {
    ...totalStat,
    totalBuyAmount: bigNumberify(totalStat.totalBuyAmount),
    totalDistributedRewards: bigNumberify(totalStat.totalDistributedRewards),
  }
}

async function saveDistributionData(network, account) {
  let userCondition = ""
  if (account) {
    userCondition = `,account: "${account.toLowerCase()}"`
  }

  const getUserStatsQuery = (skip) => `
    userStats(first: 1000, skip: ${skip}, where: {
      isQualifiedForRewards: true,
      initialTotalCommitment_gt: 0,
      ${userCondition}
    }) {
      account
      tierCommitments
      distributedRewards
      claimableRewards
      claimableLastUpdatedAt
    }
  `

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
  if (now <= totalStat.holdEndTime) {
    throw new Error("Saga rewards are not eligible yet.")
  }

  let totalRewards = BigNumber.from(0)
  const rewardDuration = totalStat.rewardPeriodEndTimestamp - totalStat.endTimestamp

  const usersRewardsData = userStats.map(item => {
    const distributedRewards = bigNumberify(item.distributedRewards)
    let totalUserRewards = bigNumberify(item.claimableRewards)

    if (now > item.claimableLastUpdatedAt) {
      const timeDiff = now - item.claimableLastUpdatedAt

      for (let i = 0; i < 6; i++) {
        totalUserRewards = totalUserRewards.add(
          bigNumberify(item.tierCommitments[i]).mul(TIER_REWARD_RATES[i]).mul(timeDiff).div(REWARD_RATE_PRECISION).div(rewardDuration)
        )
      }
    }

    totalRewards = totalRewards.add(totalUserRewards)

    return {
      account: item.account,
      totalRewards: totalUserRewards,
      distributedRewards,
      eligibleRewards: totalUserRewards.sub(distributedRewards),
      totalRewardsShare: bigNumberify(0),
      eligibleRewardsShare: bigNumberify(0),
    }
  }).filter(item => item.eligibleRewards.gt(0))

  const totalEligibleRewards = totalRewards.sub(totalStat.totalDistributedRewards)

  if (totalEligibleRewards.eq(0)) {
    console.warn("No Saga rewards on %s", network)
    return
  }

  usersRewardsData.forEach(item => {
    item.eligibleRewardsShare = item.eligibleRewards.mul(SHARE_DIVISOR).div(totalEligibleRewards),
    item.totalRewardsShare = item.totalRewards.mul(SHARE_DIVISOR).div(totalRewards)
  })

  const output = {
    network,
    timestamp: now,
    totalRewards: totalRewards.toString(),
    totalDistributedRewards: totalStat.totalDistributedRewards.toString(),
    totalEligibleRewards: totalEligibleRewards.toString(),
    shareDivisor: SHARE_DIVISOR.toString(),
    users: [],
  }
  console.log("\nTotal Saga Rewards So far: %s (%s esFXDX)",
    totalRewards.toString(),
    Number(formatUnits(totalRewards, FXDX_DECIMALS)).toFixed(4)
  )
  console.log("\nDistributed Saga Rewards: %s (%s esFXDX)",
    totalStat.totalDistributedRewards.toString(),
    Number(formatUnits(totalStat.totalDistributedRewards, FXDX_DECIMALS)).toFixed(4)
  )
  console.log("Eligible Saga Rewards: %s (%s esFXDX)",
    totalEligibleRewards.toString(),
    Number(formatUnits(totalEligibleRewards, FXDX_DECIMALS)).toFixed(4)
  )

  console.log("\nUsers:")
  let consoleData = []
  for (const data of usersRewardsData) {
    consoleData.push({
      referrer: data.account,
      "total rewards share, %": stringToFixed(formatUnits(data.totalRewardsShare, 7), 4),
      "eligible rewards share, %": stringToFixed(formatUnits(data.eligibleRewardsShare, 7), 4),
      "total rewards, esFXDX": stringToFixed(formatUnits(data.totalRewards, FXDX_DECIMALS), 4),
      "distributed rewards, esFXDX": stringToFixed(formatUnits(data.distributedRewards, FXDX_DECIMALS), 4),
      "eligible rewards, esFXDX": stringToFixed(formatUnits(data.eligibleRewards, FXDX_DECIMALS), 4),
    })
    output.users.push({
      account: data.account,
      totalRewardsShare: data.totalRewardsShare.toString(),
      eligibleRewardsShare: data.eligibleRewardsShare.toString(),
      totalRewards: data.totalRewards.toString(),
      distributedRewards: data.distributedRewards.toString(),
      eligibleRewards: data.eligibleRewards.toString(),
    })
  }
  console.table(consoleData)

  const filename = `./saga-distribution-data-${network}.json`
  fs.writeFileSync(filename, JSON.stringify(output, null, 4))
  console.log("Data saved to: %s", filename)
}

module.exports = {
  saveDistributionData
}
