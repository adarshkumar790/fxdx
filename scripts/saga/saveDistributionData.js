const { ArgumentParser } = require('argparse');
const { saveDistributionData } = require("./distributionData")

async function main() {
  const parser = new ArgumentParser({
    description: 'Get Saga rewards distribution data'
  });
  parser.add_argument('-n', '--network', {
    help: 'Network: optimismGoerli, optimism',
    required: true
  });
  parser.add_argument('-a', '--account', { help: 'Account address' })

  const args = parser.parse_args()

  console.log("Running script to get Saga rewards distribution data")
  console.log("Network: %s", args.network)
  if (args.account) {
    console.log("Account: %s", args.account)
  }

  await saveDistributionData(
    args.network,
    args.account
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
