// Кто есть кто в базе: общая проверка «этот ученик-пользователь действительно привязан к живой записи».
import type { Firestore } from 'firebase-admin/firestore'
import type { TokenUser } from './types.js'

export function makeAccess(db: Firestore) {
  return {
    /** id записи ученика, если пользователь — ученик, запись не в архиве и всё ещё привязана к его аккаунту; иначе null. */
    async ownStudentId(user: TokenUser): Promise<string | null> {
      if (user.role !== 'student' || !user.studentId) return null
      const d = await db.collection('students').doc(String(user.studentId)).get()
      return d.exists && !d.get('archived') && `tg:${d.get('tgId')}` === user.uid ? d.id : null
    },
  }
}
