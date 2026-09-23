import { initializeFirebaseAdmin } from '../src/infrastructure/database/firebase.js'
import { getAuth } from 'firebase-admin/auth'

async function main() {
  initializeFirebaseAdmin()
  const akylai = await getAuth().createCustomToken('4wEo91uRV5ZvgP8lgMIie9EhH8c2')
  const aijan = await getAuth().createCustomToken('TAF0q5Bom6flCLHzUsOXnPr4NJi2')
  console.log('AKYLAI_TOKEN=' + akylai)
  console.log('AIJAN_TOKEN=' + aijan)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e)
    process.exit(1)
  })
