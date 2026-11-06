const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const projectId = process.env.FIREBASE_PROJECT_ID;
const email = process.env.CASH_ADMIN_EMAIL;
const password = process.env.CASH_ADMIN_PASSWORD;
const displayName = process.env.CASH_ADMIN_NAME || 'C.A.S.H. Administrator';
if (!projectId || !email || !password) {
  console.error(
    'Set FIREBASE_PROJECT_ID, CASH_ADMIN_EMAIL, and CASH_ADMIN_PASSWORD before running this script.'
  );
  process.exit(1);
}
initializeApp({ projectId });
async function main() {
  const auth = getAuth();
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({ email, password, displayName });
  }
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    admin: true,
    approved: true,
  });
  await getFirestore().collection('users').doc(user.uid).set(
    {
      email,
      displayName,
      status: 'approved',
      role: 'admin',
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`Administrator ready: ${email} (${user.uid})`);
  console.log('Sign in to C.A.S.H. with this email and the password supplied in your environment.');
}
main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
