const { setGlobalOptions } = require('firebase-functions/v2');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
initializeApp();
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 5 });
function requireAdmin(request) {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
}
exports.approveAccount = onCall(async (request) => {
  requireAdmin(request);
  const uid = String(request.data?.uid || '');
  if (!uid || uid === request.auth.uid) {
    throw new HttpsError('invalid-argument', 'Choose a valid pending account.');
  }
  const db = getFirestore();
  const userRef = db.collection('users').doc(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists || snapshot.data().status !== 'pending') {
    throw new HttpsError('not-found', 'That account is no longer waiting for approval.');
  }
  const authUser = await getAuth().getUser(uid);
  if (authUser.customClaims?.admin === true) {
    throw new HttpsError(
      'failed-precondition',
      'Administrator accounts cannot be approved as shop accounts.'
    );
  }
  await getAuth().setCustomUserClaims(uid, { ...(authUser.customClaims || {}), approved: true });
  await userRef.update({ status: 'approved', approvedAt: FieldValue.serverTimestamp() });
  return { approved: true };
});
exports.deleteAccount = onCall(async (request) => {
  requireAdmin(request);
  const uid = String(request.data?.uid || '');
  if (!uid || uid === request.auth.uid) {
    throw new HttpsError('invalid-argument', 'You cannot delete your own administrator profile.');
  }
  const auth = getAuth();
  const authUser = await auth.getUser(uid).catch((error) => {
    if (error.code === 'auth/user-not-found') return null;
    throw error;
  });
  const targetProfile = await getFirestore().collection('users').doc(uid).get();
  if (authUser?.customClaims?.admin === true || targetProfile.data()?.role === 'admin') {
    throw new HttpsError('failed-precondition', 'Administrator profiles are protected.');
  }
  const bucket = getStorage().bucket();
  await bucket.deleteFiles({ prefix: `users/${uid}/` }).catch((error) => {
    if (error.code !== 404) throw error;
  });
  const db = getFirestore();
  await db.doc(`shops/${uid}`).delete();
  await db.doc(`users/${uid}`).delete();
  if (authUser) await auth.deleteUser(uid);
  return { deleted: true };
});
