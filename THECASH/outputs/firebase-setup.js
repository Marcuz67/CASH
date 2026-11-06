/* Load Firebase only after a real project config is provided. Local mode stays lightweight. */
window.CASH_FIREBASE_READY = (async function () {
  const config = window.CASH_FIREBASE_CONFIG || {};
  const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId'];
  if (!required.some((key) => config[key])) return null;
  if (required.some((key) => !config[key] || String(config[key]).includes('YOUR_')))
    throw new Error('Finish the Firebase web app settings in firebase-config.js.');
  const version = '13.1.0';
  const libraries = [
    'firebase-app-compat',
    'firebase-auth-compat',
    'firebase-firestore-compat',
    'firebase-storage-compat',
    'firebase-functions-compat',
  ];
  for (const library of libraries) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.gstatic.com/firebasejs/${version}/${library}.js`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Firebase library could not load: ${library}`));
      document.head.appendChild(script);
    });
  }
  const firebase = window.firebase;
  const app = firebase.initializeApp(config);
  const auth = app.auth();
  await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  return {
    firebase,
    app,
    auth,
    db: app.firestore(),
    storage: app.storage(),
    functions: app.functions(config.functionsRegion || 'asia-southeast1'),
  };
})();
