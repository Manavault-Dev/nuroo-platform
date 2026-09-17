/**
 * One-off script: creates a throwaway "connected parent" test account for manually
 * verifying the nuroo-app homework/grades screens end-to-end in the iOS Simulator.
 *
 * Creates: a Firebase Auth user, a child linked to that parent inside the given org,
 * and two homework tasks (one graded, one pending) directly assigned to the child
 * (no groupAssignmentId — this specifically exercises the individually-assigned-task
 * fix in HomeworkService.getHomeworkTasks()).
 *
 * Usage:
 *   npx tsx scripts/seedTestParent.ts <orgId>
 */

import admin from 'firebase-admin'
import {
  initializeFirebaseAdmin,
  getFirestore,
  getAuth,
} from '../src/infrastructure/database/firebase.js'

async function main() {
  const orgId = process.argv[2]
  if (!orgId) {
    console.error('Usage: npx tsx scripts/seedTestParent.ts <orgId>')
    process.exit(1)
  }

  initializeFirebaseAdmin()
  const db = getFirestore()
  const auth = getAuth()

  const email = `test.parent+${Date.now()}@usenuroo.com`
  const password = 'TestParent12345!'

  const orgSnap = await db.doc(`organizations/${orgId}`).get()
  if (!orgSnap.exists) {
    console.error(`Org ${orgId} not found`)
    process.exit(1)
  }
  const orgName = (orgSnap.data()?.name as string) ?? 'Test Org'

  const userRecord = await auth.createUser({
    email,
    password,
    displayName: 'Test Parent',
  })
  const uid = userRecord.uid
  console.log(`Created auth user: ${uid} (${email})`)

  const now = admin.firestore.Timestamp.now()
  const childId = db.collection('children').doc().id
  const childName = 'Тест Ребёнок'

  await db.doc(`users/${uid}`).set({
    uid,
    email,
    name: 'Test Parent',
    activeOrgId: orgId,
    activeOrgName: orgName,
    parent_mode: 'connected',
    createdAt: now,
    updatedAt: now,
  })

  await db.doc(`children/${childId}`).set({
    id: childId,
    name: childName,
    childName,
    parentUserId: uid,
    organizationId: orgId,
    createdAt: now,
    updatedAt: now,
  })

  await db.doc(`organizations/${orgId}/children/${childId}`).set({
    childId,
    childName,
    parentUserId: uid,
    assigned: true,
    assignedAt: now,
    branchId: null,
  })

  const gradedTaskId = db.collection('_').doc().id
  await db.doc(`children/${childId}/tasks/${gradedTaskId}`).set({
    title: 'Тестовое задание — Артикуляция звука Р',
    description: 'Проговорить слова со звуком Р 3 раза в день.',
    category: 'speech',
    estimatedDuration: 15,
    difficulty: 'medium',
    instructions: ['Сядьте перед зеркалом', 'Повторяйте слова медленно', 'Записывайте видео'],
    videoUrl: null,
    imageUrl: null,
    mediaType: 'none',
    ageRange: null,
    status: 'completed',
    submissionStatus: 'graded',
    grade: 'approved',
    feedback: 'Отличная работа! Звук Р стал чище. Продолжайте в том же духе.',
    submissionText: 'Занимались каждый день, ребёнку нравится.',
    fileUrl: null,
    groupId: null,
    groupAssignmentId: null,
    contentTaskId: null,
    contentRoadmapId: null,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
  })

  const pendingTaskId = db.collection('_').doc().id
  await db.doc(`children/${childId}/tasks/${pendingTaskId}`).set({
    title: 'Тестовое задание — Пальчиковая гимнастика',
    description: 'Выполнить комплекс упражнений для мелкой моторики.',
    category: 'motor',
    estimatedDuration: 10,
    difficulty: 'easy',
    instructions: ['Разминка пальцев', 'Упражнение "Замок"', 'Упражнение "Ножницы"'],
    videoUrl: null,
    imageUrl: null,
    mediaType: 'none',
    ageRange: null,
    status: 'pending',
    submissionStatus: 'pending',
    grade: null,
    feedback: null,
    submissionText: null,
    fileUrl: null,
    groupId: null,
    groupAssignmentId: null,
    contentTaskId: null,
    contentRoadmapId: null,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
  })

  console.log('\nDone. Test parent account:')
  console.log(`  email:    ${email}`)
  console.log(`  password: ${password}`)
  console.log(`  uid:      ${uid}`)
  console.log(`  childId:  ${childId}`)
  console.log(`  org:      ${orgName} (${orgId})`)
  console.log(
    `  tasks:    1 graded (approved) + 1 pending, both individually-assigned (no groupAssignmentId)`
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
