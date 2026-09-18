import { getAuth } from '../database/firebase.js'

export async function getUserByEmail(email: string) {
  const auth = getAuth()
  return auth.getUserByEmail(email)
}
