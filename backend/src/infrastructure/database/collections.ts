import { getFirestore } from './firebase.js'

export { getFirestore }

export const COLLECTIONS = {
  ORGANIZATIONS: 'organizations',
  SPECIALISTS: 'specialists',
  CHILDREN: 'children',
  INVITES: 'invites',
  ORG_INVITES: 'orgInvites',
  PARENT_INVITES: 'parentInvites',
  PARENTS: 'parents',
} as const

export function getOrganizationRef(orgId: string) {
  return getFirestore().doc(`${COLLECTIONS.ORGANIZATIONS}/${orgId}`)
}

export function getOrgChildrenRef(orgId: string) {
  return getFirestore().collection(`${COLLECTIONS.ORGANIZATIONS}/${orgId}/children`)
}

export function getSpecialistRef(uid: string) {
  return getFirestore().doc(`${COLLECTIONS.SPECIALISTS}/${uid}`)
}

export function getChildRef(childId: string) {
  return getFirestore().doc(`${COLLECTIONS.CHILDREN}/${childId}`)
}

export function getChildNotesRef(childId: string) {
  return getFirestore().collection(`${COLLECTIONS.CHILDREN}/${childId}/specialistNotes`)
}

export function getParentRef(parentUid: string) {
  return getFirestore().doc(`${COLLECTIONS.PARENTS}/${parentUid}`)
}
